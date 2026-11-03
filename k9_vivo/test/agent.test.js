const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { criarServidorMcp } = require('../src/mcp-server');
const { Agente } = require('../src/agent');
const { Safety } = require('../src/safety');
const { Memoria } = require('../src/rag/memory');
const cfg = require('../src/config');

async function montar(respostas) {
  const enviados = [];
  const robot = { status: async () => ({ online: true }), pose: async (c) => enviados.push(c), stop: async () => enviados.push('stop'), walk: async () => 'terminou' };
  const safety = new Safety({ ...cfg, actionsPerMin: 50 }); safety.arm();
  const memoria = new Memoria(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vivo-')), 'm.jsonl'));
  const server = criarServidorMcp({ robot, safety, conhecimento: { search: () => [] }, memoria });
  const [a, b] = InMemoryTransport.createLinkedPair(); const mcp = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  const pedidos = [];
  const ia = { messages: { create: async (req) => { pedidos.push(req); return respostas.shift(); } } };
  return { agente: new Agente({ ia, mcp, memoria, safety, model: 'modelo-x', knowledgeDir: cfg.knowledgeDir }), pedidos, enviados, memoria };
}

test('agente: pede a ferramenta, recebe o resultado e responde; a persona vai no system', async () => {
  const { agente, pedidos, enviados } = await montar([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'robo_pose', input: { pose: 'sentar' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sentei!' }] }
  ]);
  assert.equal(await agente.responder('senta, por favor'), 'Sentei!');
  assert.deepEqual(enviados, ['sit']);
  assert.match(pedidos[0].system, /K9/); assert.match(pedidos[0].system, /ARMADO/);
  assert.ok(pedidos[0].tools.some((t) => t.name === 'robo_andar' && t.input_schema.type === 'object'));
  const volta2 = pedidos[1].messages.at(-1).content[0];
  assert.equal(volta2.type, 'tool_result'); assert.match(volta2.content, /senta/);
});

test('agente: pose proibida pedida pela IA é recusada e a IA é informada', async () => {
  const { agente, pedidos, enviados } = await montar([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'robo_pose', input: { pose: 'cal' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Não posso.' }] }
  ]);
  await agente.responder('calibra os servos');
  assert.deepEqual(enviados, []);
  assert.match(pedidos[1].messages.at(-1).content[0].content, /^Erro/);
});

test('agente: lembranças relevantes entram no contexto e o laço tem limite', async () => {
  const sempre = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'robo_poses', input: {} }] };
  const { agente, pedidos, memoria } = await montar(Array.from({ length: 10 }, () => sempre));
  memoria.salvar('O chão da sala escorrega', 'ambiente');
  const fala = await agente.responder('como está o chão da sala');
  assert.match(pedidos[0].system, /escorrega/);
  assert.equal(pedidos.length, 6); assert.match(fala, /Me enrolei/);
});

test('agente: o nome escolhido pelo dono vai no sistema', async () => {
  const { pedidos, memoria } = await montar([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Oi!' }] }]);
  const { Agente: A } = require('../src/agent');
  const ag = new A({ ia: { messages: { create: async (r) => { pedidos.push(r); return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Oi!' }] }; } } }, mcp: { listTools: async () => ({ tools: [] }) }, memoria, safety: { armed: true }, model: 'm', knowledgeDir: cfg.knowledgeDir, nome: () => 'Tobias' });
  await ag.responder('qual é o seu nome');
  assert.match(pedidos.at(-1).system, /Seu nome é Tobias/);
});
