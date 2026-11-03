const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.self = global;
const rows = [].concat(require('../public/i18n/strings-ui.js'), require('../public/i18n/strings-dyn.js'), require('../public/i18n/strings-extra.js'));
global.K9Strings = rows;
const I = require('../public/i18n/i18n.js');
const CODES = I.LANGS.map((l) => l.code);

test('seis idiomas: pt, en, es, fr, de, zh', () => {
  assert.deepEqual(CODES, ['pt', 'en', 'es', 'fr', 'de', 'zh']);
  assert.deepEqual(I.LANGS.map((l) => l.tag), ['pt-BR', 'en-US', 'es-ES', 'fr-FR', 'de-DE', 'zh-CN']);
});

test('todo texto tem as 6 colunas preenchidas e os mesmos {n} em todas', () => {
  const vistos = new Set();
  for (const r of rows) {
    assert.equal(r.length, 6, r[0]);
    for (const c of r) assert.ok(typeof c === 'string' && c.trim(), `coluna vazia em: ${r[0]}`);
    const ph = (s) => (s.match(/\{\d+\}/g) || []).sort().join();
    for (let i = 1; i < 6; i++) assert.equal(ph(r[i]), ph(r[0]), `{n} diferente (${CODES[i]}) em: ${r[0]}`);
    assert.ok(!vistos.has(r[0]) || r[0] === 'Normal', `chave repetida: ${r[0]}`);
    vistos.add(r[0]);
  }
});

test('só o idioma-fonte pode ficar igual ao português; texto longo traduzido não pode repetir o pt', () => {
  for (const r of rows) if (r[0].length > 60) for (let i = 1; i < 6; i++) assert.notEqual(r[i], r[0], `${CODES[i]} sem tradução: ${r[0].slice(0, 40)}`);
});

test('t() traduz, substitui {n} e traduz os argumentos que são frases conhecidas', () => {
  I.setLang('en');
  assert.equal(I.t('Sentar'), 'Sit');
  assert.equal(I.t('Enviado: {0}', 'Sentar'), 'Sent: Sit');
  assert.equal(I.t('Texto que não existe'), 'Texto que não existe');
  I.setLang('zh'); assert.equal(I.t('Parar'), '停止');
  I.setLang('de'); assert.equal(I.t('Sentar'), 'Sitz');
  I.setLang('pt'); assert.equal(I.t('Sentar'), 'Sentar'); assert.equal(I.t('Enviado: {0}', 'x'), 'Enviado: x');
});

test('lookup casa frases com número/nome por modelo, e o modelo mais específico ganha', () => {
  I.setLang('es');
  assert.equal(I.lookup('Enviado: Sentar'), 'Enviado: Sentarse');
  assert.equal(I.lookup('Conectando ao IP 192.168.0.5…'), 'Conectando a la IP 192.168.0.5…');
  assert.equal(I.lookup('Variação 3 ativa: Asfalto / Calçada.'), 'Variación 3 activa: Asfalto / Acera.');
  assert.equal(I.lookup('texto desconhecido'), null);
  I.setLang('pt');
});

test('idioma inválido volta para o português', () => { assert.equal(I.setLang('xx'), 'pt'); });

test('todo texto fixo do index.html está no dicionário', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<kbd[\s\S]*?<\/kbd>/g, '');
  const exato = new Set(rows.map((r) => r[0].replace(/\s+/g, ' ').trim()));
  const ignorar = new Set(['K9', '-MK3', 'K9 OFF', 'CAM OFF', 'HUB', '— ms', '— dBm', 'F +0.00 T +0.00', '8 Hz', 'MK3', 'K9 · MK3', 'F +0.00 | T +0.00', '×', '60%', '-', '192.168.0.x', 'Lizard_Wizard // Creative Lab', 'K9-MK3 · est. 2026', '01', '02', '03', 'CÂMERA K9']);
  I.setLang('pt');
  const faltando = new Set();
  const textos = [...html.matchAll(/>([^<>]+)</g)].map((m) => m[1].replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim());
  const attrs = [...html.matchAll(/\s(?:aria-label|title|placeholder|alt)="([^"]+)"/g)].map((m) => m[1].trim());
  for (const x of [...textos, ...attrs]) {
    if (!x || !/[A-Za-zÀ-ÿ]/.test(x) || ignorar.has(x) || exato.has(x) || I.lookup(x) !== null) continue;
    if (/^\d+: /.test(x)) continue;                                    // dicas 1..10 das marchas: montadas por marcha-variacoes.js com t()
    if (/^[\d.,\s%°µ|+\-·/]+$/.test(x)) continue;
    faltando.add(x);
  }
  assert.deepEqual([...faltando], []);
});

test('o seletor de idioma e o formulário de Wi-Fi existem no painel', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(html, /id="langSelect"/); assert.match(html, /id="wifiForm"/); assert.match(html, /i18n\/i18n\.js/);
});
