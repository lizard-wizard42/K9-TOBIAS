const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const barra = html.match(/<div class="cam-toolbar camera-tools"[\s\S]*?<output class="sr-only" id="strobeLabel"[^>]*>[^<]*<\/output>\s*<\/div>/)[0];

test('lanterna e strobo ficam numa barra só, na ordem certa', () => {
  const ordem = ['id="flashBtn"', 'id="flashSlider"', 'id="strobeBtn"', 'id="strobeSlider"'].map((s) => barra.indexOf(s));
  assert.ok(ordem.every((i) => i > -1), 'todos os controles estão na barra');
  assert.deepEqual([...ordem].sort((a, b) => a - b), ordem);
});

test('a barra não tem texto visível: botões só com ícone e nomes em aria-label/title', () => {
  const semMenu = barra.replace(/<div class="tool-popover">[\s\S]*?<\/div><\/div>/, '');       // o menu de qualidade (aberto sob demanda) tem texto; a barra não
  const botoes = [...semMenu.matchAll(/<(?:button|summary)[^>]*>([\s\S]*?)<\/(?:button|summary)>/g)];
  assert.equal(botoes.length, 2);
  for (const [, dentro] of botoes) assert.equal(dentro.replace(/<svg[\s\S]*?<\/svg>/g, '').trim(), '', 'sem texto dentro do botão');
  for (const id of ['flashBtn', 'strobeBtn']) assert.match(barra, new RegExp(`id="${id}"[^>]*aria-label="[^"]+"[^>]*title="[^"]+"`));
  assert.ok(!barra.includes("<details"));
  assert.match(barra, /<output class="sr-only" id="flashLabel"/);          // o valor continua para leitores de tela
});

test('perfil fixo não oferece seletor de qualidade e mantém os controles de luz', () => {
  for (const s of ['data-q="0"', 'data-q="1"', 'data-q="2"', 'setQuality(', 'renderQuality(', "emit('k9:cam'"]) assert.ok(!html.includes(s), s);
  for (const id of ['flashBtn', 'flashSlider', 'strobeBtn', 'strobeSlider', 'flashLabel', 'strobeLabel']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(!html.includes('⚡ Strobo') && !html.includes("'⚡ Parar'"));      // o JS não escreve mais texto no botão
});

test('AI enhancement is absent from the camera panel', () => { assert.ok(!html.includes('optSr') && !html.includes('/api/camera/stream-ia')); });
