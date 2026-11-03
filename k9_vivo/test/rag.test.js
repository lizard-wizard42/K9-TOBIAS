const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tokens } = require('../src/rag/tokenize');
const { pedacos, carregarConhecimento } = require('../src/rag/knowledge');
const { Memoria } = require('../src/rag/memory');
const cfg = require('../src/config');

test('tokenização: sem acento, sem palavras vazias, plural simples', () => {
  assert.deepEqual(tokens('As poses do ROBÔ dançam!'), ['pose', 'robo', 'dancam']);
  assert.deepEqual(tokens(''), []);
});

test('pedaços respeitam títulos e tamanho', () => {
  const md = '# A\n\nprimeiro\n\n## B\n\n' + ('x'.repeat(300) + '\n\n').repeat(4);
  const ps = pedacos(md, 'f.md');
  assert.equal(ps[0].titulo, 'A');
  assert.ok(ps.every((p) => p.texto.length <= 800));
  assert.ok(ps.filter((p) => p.titulo === 'B').length >= 2);
});

test('RAG responde perguntas reais sobre o K9 (consultas em inglês, docs em inglês) com a fonte certa', () => {
  const idx = carregarConhecimento(cfg.repo);
  assert.ok(idx.docs.length > 20, 'conhecimento carregado: ' + idx.docs.length);
  const top = (q) => idx.search(q, 3).map((r) => r.doc.fonte + ' | ' + r.doc.titulo);
  assert.ok(top('what to do if the board reboots brownout').some((f) => /FIELD-USE|TROUBLESHOOTING/.test(f)), top('what to do if the board reboots brownout').join(' ; '));
  assert.ok(top('which UDP port takes the walk commands').some((f) => /PROTOCOL/.test(f)));
  assert.ok(top('field mode access point without wifi').some((f) => /FIELD-USE/.test(f)));
});

test('conhecimento não inclui segredos', () => {
  const idx = carregarConhecimento(cfg.repo);
  assert.ok(!idx.docs.some((d) => /secrets\.h$/.test(d.fonte)));
});

test('memória: salva, acha, não repete e recusa segredos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vivo-'));
  const f = path.join(dir, 'm.jsonl');
  const m = new Memoria(f);
  assert.equal(m.salvar('O chão da sala escorrega muito', 'ambiente').ok, true);
  assert.equal(m.salvar('Meu nome é Alex', 'pessoa').ok, true);
  assert.equal(m.salvar('o chão da sala escorrega muito').repetido, true);
  assert.equal(m.salvar('a senha do wifi é 12345678').ok, false);
  assert.equal(m.salvar('minha api key é sk-abc123').ok, false);
  assert.equal(m.buscar('onde o robô escorrega')[0].texto, 'O chão da sala escorrega muito');
  assert.equal(new Memoria(f).itens.length, 2);                                       // persiste
  fs.appendFileSync(f, 'lixo{{\n'); assert.equal(new Memoria(f).itens.length, 2);     // linha corrompida não derruba
});
