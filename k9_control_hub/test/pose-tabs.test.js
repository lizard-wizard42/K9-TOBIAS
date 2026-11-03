const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const painel = html.match(/<section class="panel a-poses"[\s\S]*?<\/section>/)[0];
const cmdsDe = (id) => [...painel.match(new RegExp(`<div class="poses" id="${id}"[\\s\\S]*?\\n      </div>\\n`))[0].matchAll(/data-cmd="(\w+)"/g)].map((m) => m[1]);

test('o painel de poses tem cinco abas e não tem mais o "Mais poses +"', () => {
  assert.deepEqual([...painel.matchAll(/class="pose-tab"[^>]*>([^<]+)</g)].map((m) => m[1]), ['Poses', 'Ações', 'Animações', 'Sons', 'Emoções']);
  assert.ok(!painel.includes('more-poses') && !painel.includes('Mais poses'));
  assert.match(painel, /role="tablist"/);
  assert.equal([...painel.matchAll(/role="tabpanel"/g)].length, 5);
});

test('cada comando está em exatamente uma aba e nenhum botão se perdeu', () => {
  const grupos = { gridPoses: cmdsDe('gridPoses'), gridAcoes: cmdsDe('gridAcoes'), gridAnim: cmdsDe('gridAnim'), gridSons: cmdsDe('gridSons'), gridEmocoes: cmdsDe('gridEmocoes') };
  assert.deepEqual(grupos.gridPoses, ['stand', 'sit', 'lie']);
  assert.match(painel, /data-cmd="stand" data-label="Padrão">[^\n]*<span>Padrão<\/span>/);   // o botão que era "Em pé" agora se chama Padrão
  assert.deepEqual(grupos.gridAcoes, ['wave', 'waveleft', 'wag', 'dig']);
  assert.deepEqual(grupos.gridAnim, ['wake', 'sleep', 'dance', 'stretch', 'scratch']);
  assert.deepEqual(grupos.gridSons, ['sound_wake', 'sound_spell', 'sound_sad', 'sound_laugh', 'sound_crazy', 'sound_beep', 'sound_hello', 'sound_alert', 'sound_robot', 'sound_whistle', 'sound_pulse', 'sound_march', 'sound_arcade', 'sound_cosmos', 'sound_alarm', 'sound_stop']);
  assert.deepEqual(grupos.gridEmocoes, ['emotion_shy', 'emotion_celebrate', 'emotion_greet', 'emotion_glitch', 'emotion_happy', 'emotion_sad', 'emotion_confused', 'emotion_angry', 'emotion_curious', 'emotion_laugh']);
  const todos = Object.values(grupos).flat();
  assert.equal(new Set(todos).size, todos.length);
  assert.ok(cmdsDe('gridAcoes').length === 4 && /<div class="poses" id="gridAcoes"[\s\S]*?id="npcBtn"[\s\S]*?\n      <\/div>\n/.test(painel), 'o NPC está dentro da aba Ações');
  const cab = painel.match(/<div class="panel-head">[\s\S]*?<\/div>/)[0];
  assert.ok(cab.includes('id="vozBtn"') && !cab.includes('Ações rápidas'), 'a Voz fica no cabeçalho, no lugar de "Ações rápidas"');
});

test('só a primeira aba começa visível e a grade tem 3 colunas com botões menores', () => {
  assert.match(painel, /<div class="poses" id="gridPoses"[^>]*>/);
  assert.ok(!/<div class="poses" id="gridPoses"[^>]*hidden/.test(painel));
  assert.ok(/<div class="poses" id="gridAcoes"[^>]*hidden/.test(painel) && /<div class="poses" id="gridAnim"[^>]*hidden/.test(painel));
  assert.match(html, /\.a-poses \.poses \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important;/);
  assert.match(html, /\.a-poses \.btn-pose \{ min-height: 76px !important;/);
  assert.match(html, /<script src="\/pose-tabs\.js"><\/script>/);
});

test('no celular em retrato o painel de poses fica abaixo do joystick, em largura total', () => {
  assert.match(html, /grid-template-areas: "cam" "drive" "poses" "adv"; gap: 10px; \}/);
});
