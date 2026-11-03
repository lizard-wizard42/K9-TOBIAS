const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { paraOpenAI, deOpenAI, criarClienteOpenAI } = require('../src/openai');
const { chaveOpenAI } = require('../src/segredos');
const { criarClienteIa } = require('../src/agent');

const FERR = [{ name: 'robo_pose', description: 'faz pose', input_schema: { type: 'object', properties: { pose: { type: 'string' } } } }];

test('pedido: system vira mensagem, ferramentas viram functions, tool_use/tool_result viram tool_calls/tool', () => {
  const corpo = paraOpenAI({ model: 'm', max_tokens: 123, system: 'SYS', tools: FERR, messages: [
    { role: 'user', content: 'senta' },
    { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'c1', name: 'robo_pose', input: { pose: 'sentar' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'Feito: senta.' }] }
  ] });
  assert.equal(corpo.max_completion_tokens, 123);
  assert.deepEqual(corpo.messages[0], { role: 'system', content: 'SYS' });
  assert.deepEqual(corpo.tools[0], { type: 'function', function: { name: 'robo_pose', description: 'faz pose', parameters: FERR[0].input_schema } });
  assert.equal(corpo.messages[2].tool_calls[0].function.arguments, '{"pose":"sentar"}');
  assert.deepEqual(corpo.messages[3], { role: 'tool', tool_call_id: 'c1', content: 'Feito: senta.' });
});

test('resposta: tool_calls viram tool_use; texto vira end_turn; argumentos quebrados não derrubam', () => {
  const r = deOpenAI({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'robo_pose', arguments: '{"pose":"deitar"}' } }, { id: 'c2', function: { name: 'x', arguments: '{lixo' } }] } }] });
  assert.equal(r.stop_reason, 'tool_use'); assert.deepEqual(r.content[0], { type: 'tool_use', id: 'c1', name: 'robo_pose', input: { pose: 'deitar' } }); assert.deepEqual(r.content[1].input, {});
  assert.deepEqual(deOpenAI({ choices: [{ message: { content: 'Oi!' } }] }), { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Oi!' }] });
  assert.throws(() => deOpenAI({ choices: [] }));
});

test('cliente: manda a chave só no cabeçalho e o erro da API nunca vaza a chave', async () => {
  const chave = 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let visto;
  const ok = criarClienteOpenAI({ apiKey: chave, fetchImpl: async (url, o) => { visto = { url, o }; return { ok: true, json: async () => ({ choices: [{ message: { content: 'Oi' } }] }) }; } });
  assert.equal((await ok.messages.create({ model: 'm', messages: [{ role: 'user', content: 'oi' }], system: 's' })).content[0].text, 'Oi');
  assert.equal(visto.o.headers.authorization, `Bearer ${chave}`); assert.ok(!visto.o.body.includes(chave));
  const ruim = criarClienteOpenAI({ apiKey: chave, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: `Incorrect API key provided: ${chave}` } }) }) });
  await assert.rejects(ruim.messages.create({ model: 'm', messages: [], system: '' }), (e) => /401/.test(e.message) && !e.message.includes(chave));
});

test('chave: vem do ambiente ou de secret.md; sem nenhuma, o Vivo fica sem IA; Anthropic tem prioridade', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seg-'));
  assert.equal(chaveOpenAI({}, dir), null); assert.equal(criarClienteIa({}, dir), null);
  fs.writeFileSync(path.join(dir, 'secret.md'), 'open ia api:\n\nsk-proj-ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ\n');
  assert.match(chaveOpenAI({}, dir), /^sk-proj-Z+$/);
  const c = criarClienteIa({}, dir); assert.equal(c.provedor, 'openai'); assert.equal(c.modelo, 'gpt-4.1-mini');
  assert.equal(criarClienteIa({ VIVO_MODEL: 'gpt-5' }, dir).modelo, 'gpt-5');
  assert.equal(chaveOpenAI({ OPENAI_API_KEY: 'sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAA' }, dir), 'sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(criarClienteIa({ ANTHROPIC_API_KEY: 'x' }, dir).provedor, 'anthropic');
});

test('VIVO_SEM_IA=1 desliga a IA mesmo havendo chave', () => {
  assert.equal(criarClienteIa({ VIVO_SEM_IA: '1', ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAA' }), null);
});

test('modelo local sem id na chamada de ferramenta: o adaptador inventa um id estável', () => {
  const r = deOpenAI({ choices: [{ message: { content: null, tool_calls: [{ function: { name: 'robo_pose', arguments: { pose: 'sentar' } } }] } }] });
  assert.ok(r.content[0].id.startsWith('call_')); assert.deepEqual(r.content[0].input, { pose: 'sentar' });
});
