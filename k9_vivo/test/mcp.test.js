const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { criarServidorMcp } = require('../src/mcp-server');
const { Safety } = require('../src/safety');
const { carregarConhecimento } = require('../src/rag/knowledge');
const { Memoria } = require('../src/rag/memory');
const cfg = require('../src/config');

async function montar({ armado = true } = {}) {
  const enviados = [];
  const robot = {
    status: async () => ({ online: true, rssi: -55, marcha: 5 }),
    pose: async (c) => { enviados.push(['pose', c]); }, stop: async () => { enviados.push(['stop']); },
    walk: async (f, t, s) => { enviados.push(['walk', f, t, s]); return 'terminou'; }
  };
  const falas = [], auditoria = [];
  const safety = new Safety({ ...cfg, actionsPerMin: 50 }); if (armado) safety.arm();
  const memoria = new Memoria(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vivo-')), 'm.jsonl'));
  const server = criarServidorMcp({ robot, safety, conhecimento: carregarConhecimento(cfg.repo), memoria, falar: async (t) => falas.push(t), auditar: (e) => auditoria.push(e) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'teste', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const chamar = async (name, args = {}) => (await client.callTool({ name, arguments: args })).content[0].text;
  return { client, chamar, enviados, falas, auditoria, safety };
}

test('o MCP expõe todas as ferramentas, com esquema JSON', async () => {
  const { client } = await montar();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['conhecimento_buscar', 'falar', 'memoria_buscar', 'memoria_salvar', 'robo_andar', 'robo_parar', 'robo_pose', 'robo_poses', 'robo_status']);
  assert.ok(tools.every((t) => t.inputSchema && t.inputSchema.type === 'object'));
});

test('pose e andar passam pela segurança e chegam ao robô', async () => {
  const { chamar, enviados } = await montar();
  assert.match(await chamar('robo_pose', { pose: 'sentar' }), /senta/);
  assert.match(await chamar('robo_andar', { frente: 1, giro: 0, segundos: 3 }), /Andei 3 s/);
  assert.deepEqual(enviados, [['pose', 'sit'], ['walk', 0.5, 0, 3]]);                  // velocidade cortada para 50%
});

test('desarmado: não anda nem faz pose, mas PARAR sempre funciona', async () => {
  const { chamar, enviados } = await montar({ armado: false });
  assert.match(await chamar('robo_pose', { pose: 'dancar' }), /desarmado/);
  assert.match(await chamar('robo_andar', { frente: 1 }), /desarmado/);
  assert.match(await chamar('robo_parar'), /Parei/);
  assert.deepEqual(enviados, [['stop']]);
});

test('pose fora da lista é recusada pelo esquema (nada chega ao robô)', async () => {
  const { client, enviados } = await montar();
  for (const pose of ['cal', 'test0', 'gait3', 'flash']) {
    const r = await client.callTool({ name: 'robo_pose', arguments: { pose } }).catch((e) => ({ isError: true, e }));
    assert.ok(r.isError, pose);
  }
  assert.deepEqual(enviados, []);
});

test('RAG e memória pelas ferramentas; segredo recusado; ações auditadas', async () => {
  const { chamar, auditoria } = await montar();
  assert.match(await chamar('conhecimento_buscar', { consulta: 'porta UDP dos comandos' }), /PROTOCOLO|4210/);
  assert.match(await chamar('memoria_salvar', { texto: 'O dono se chama Alex', tipo: 'pessoa' }), /Guardei/);
  assert.match(await chamar('memoria_salvar', { texto: 'a senha do wifi é abc12345' }), /Não guardei/);
  assert.match(await chamar('memoria_buscar', { consulta: 'como se chama o dono' }), /Alex/);
  assert.ok(auditoria.some((e) => e.ferramenta === 'memoria_salvar'));
});

test('falar entrega o texto ao gateway', async () => {
  const { chamar, falas } = await montar();
  await chamar('falar', { texto: 'Já vou!' });
  assert.deepEqual(falas, ['Já vou!']);
});

test('robô offline: nada de "feito"; a ferramenta avisa e não manda comando', async () => {
  const { chamar, enviados } = await montar();
  const r = await montarOffline();
  assert.match(await r.chamar('robo_pose', { pose: 'sentar' }), /offline/);
  assert.match(await r.chamar('robo_andar', { frente: 1 }), /offline/);
  assert.deepEqual(r.enviados, []);
});

async function montarOffline() {
  const enviados = [];
  const robot = { status: async () => ({ online: false }), pose: async (c) => enviados.push(c), stop: async () => {}, walk: async () => 'terminou' };
  const safety = new Safety({ ...cfg, actionsPerMin: 50 }); safety.arm();
  const server = criarServidorMcp({ robot, safety, conhecimento: { search: () => [] }, memoria: { buscar: () => [], salvar: () => ({ ok: true }) } });
  const [a, b] = InMemoryTransport.createLinkedPair(); const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { enviados, chamar: async (name, args = {}) => (await client.callTool({ name, arguments: args })).content[0].text };
}
