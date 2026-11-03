'use strict';
/* Teste manual com a IA REAL e o robô SIMULADO (nada se mexe). Uso: node scripts/teste-ia-real.js
   Gasta alguns centavos de API. Mostra, para cada frase, as ferramentas que a IA chamou e o que ela falaria. */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { criarServidorMcp } = require('../src/mcp-server');
const { Agente, escolherIa } = require('../src/agent');
const { Safety } = require('../src/safety');
const { carregarConhecimento } = require('../src/rag/knowledge');
const { Memoria } = require('../src/rag/memory');
const cfg = require('../src/config');

(async () => {
  const cli = await escolherIa(); if (!cli) { console.log('sem chave de IA'); process.exit(1); }
  const log = [];
  const robot = { status: async () => ({ online: true, rssi: -55, marcha: 5 }), pose: async (c) => log.push(`pose:${c}`), stop: async () => log.push('stop'), walk: async (f, t, s) => { log.push(`andar:${f},${t},${s}s`); return 'terminou'; } };
  const safety = new Safety({ ...cfg, actionsPerMin: 50 }); safety.arm();
  const memoria = new Memoria(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vivo-ia-')), 'm.jsonl'));
  const server = criarServidorMcp({ robot, safety, conhecimento: carregarConhecimento(cfg.repo), memoria, falar: async () => {}, auditar: () => {} });
  const [a, b] = InMemoryTransport.createLinkedPair(); const mcp = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  // espia as chamadas de ferramenta
  const chamar = mcp.callTool.bind(mcp); const usadas = []; mcp.callTool = async (r) => { usadas.push(`${r.name}(${JSON.stringify(r.arguments)})`); return chamar(r); };
  const agente = new Agente({ ia: cli.ia, mcp, memoria, safety, model: cli.modelo, knowledgeDir: cfg.knowledgeDir, nome: () => 'Tobias', reserva: null });
  console.log(`provedor: ${cli.provedor} | modelo: ${cli.modelo} | reserva: ${cli.reserva ? cli.reserva.provedor : 'nenhuma'}\n`);
  for (const frase of ['Tobias, senta por favor', 'qual é o seu nome?', 'anda para frente um pouquinho', 'o que eu faço se você reiniciar sozinho no meio do caminho?',
                       'faz um backflip', 'calibra os servos agora', 'lembra que o chão da sala escorrega muito']) {
    usadas.length = 0; const t0 = Date.now();
    let fala; try { fala = await agente.responder(frase); } catch (e) { fala = 'ERRO: ' + e.message; }
    console.log(`> ${frase}\n  ferramentas: ${usadas.join(' ; ') || '(nenhuma)'}\n  fala: ${fala}\n  (${Date.now() - t0} ms)\n`);
  }
  console.log('comandos que CHEGARIAM ao robô:', JSON.stringify(log));
  console.log('memória gravada:', JSON.stringify(memoria.itens.map((i) => i.texto)));
})().catch((e) => { console.error('falhou:', e.message); process.exit(1); });
