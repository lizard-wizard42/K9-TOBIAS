const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarNome } = require('../robot-name');

const arq = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nome-')), 'sub', 'nome.json');

test('padrão K9, troca, persiste e recarrega', () => {
  const f = arq(); const n = criarNome(f);
  assert.equal(n.get(), 'K9');
  assert.equal(n.set('  Tobias '), 'Tobias');
  assert.equal(criarNome(f).get(), 'Tobias');
});

test('nome inválido é recusado e não muda nada', () => {
  const f = arq(); const n = criarNome(f); n.set('Tobias');
  for (const ruim of ['', 'a'.repeat(30), '<b>', 'x;y', null, undefined, 5]) assert.equal(n.set(ruim), null, String(ruim));
  assert.equal(n.get(), 'Tobias'); assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).nome, 'Tobias');
});

test('arquivo corrompido não derruba: volta ao padrão', () => {
  const f = arq(); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '{{lixo');
  assert.equal(criarNome(f).get(), 'K9');
});
