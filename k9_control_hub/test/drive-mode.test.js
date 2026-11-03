const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

test('o direcional com setas tem as 4 direções e o centro é o Parar', () => {
  const pad = html.match(/<div class="dpad" id="dpadZone"[\s\S]*?<\/button>\s*<div><\/div>\s*<\/div>/)[0];
  const dirs = [...pad.matchAll(/data-dir="(-?\d),(-?\d)"/g)].map((m) => `${m[1]},${m[2]}`).sort();
  assert.deepEqual(dirs, ['-1,0', '0,-1', '0,1', '1,0']);                       // frente, trás, esquerda (giro -1) e direita (giro +1)
  assert.match(pad, /id="dpadStop"/);
  assert.match(pad, /hidden/);                                                   // começa escondido: o padrão continua sendo o joystick redondo
});

test('há um botão pequeno para trocar entre joystick e setas, lembrado no navegador', () => {
  assert.match(html, /id="driveModeBtn"[^>]*aria-label="Trocar para o direcional com setas"/);
  assert.match(html, /localStorage\.getItem\('k9\.driveMode'\)/);
  assert.match(html, /initDriveMode\(\)/);
  assert.match(html, /\.joy\[hidden\], \.dpad\[hidden\] \{ display: none !important; \}/);
});

test('trocar de modo solta o movimento (joystick e direcional) antes de esconder um deles', () => {
  const bloco = html.slice(html.indexOf('initDriveMode() {'), html.indexOf('initKeyboard() {'));
  assert.ok(bloco.indexOf("setSource('joy', 0, 0)") > -1 && bloco.indexOf("setSource('dpad', 0, 0)") > -1);
  assert.ok(bloco.indexOf("setSource('joy', 0, 0)") < bloco.indexOf('aplicar(modo, true)'));
});
