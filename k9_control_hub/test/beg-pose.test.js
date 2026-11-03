const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

test('Pedir fica arquivado: comando e ícone preservados, sem botão no painel', () => {
  assert.match(read('../server.js').match(/const CMDS = new Set\(\[([\s\S]*?)\]\)/)[1], /'beg'/);
  const html = read('../public/index.html');
  assert.doesNotMatch(html, /data-cmd="beg"/);
  assert.ok(fs.existsSync(path.join(__dirname, '../public/assets/poses/beg.svg')));
});

test('o firmware tem as animações 14 e 15, o comando, o ajuste ao vivo e a saída segura pelo BEGOUT', () => {
  const core = read('../../k9v2-1_firmware/src/gait_core.h'), main = read('../../k9v2-1_firmware/src/main.cpp'), web = read('../../k9v2-1_firmware/src/web_cam_server.h');
  assert.match(core, /GC_ANIM_BEG,/);
  assert.match(core, /GC_ANIM_BEGOUT, GC_ANIM_LAUGH, GC_ANIM_WAKE,/);
  assert.match(core, /case GC_ANIM_BEG: \{/);
  assert.match(web, /c == "beg"[\s\S]{0,60}webOnAnim\(14\)/);
  assert.match(web, /strncmp\(buf, "B ", 2\) == 0/);                                          // ajuste ao vivo pela rede
  assert.match(main, /GA\.anim == GC_ANIM_BEG && animCode == GC_ANIM_STAND\) animCode = GC_ANIM_BEGOUT/);   // Padrão a partir do Pedir
  assert.match(main, /GA\.anim == GC_ANIM_BEG\) animStart\(GC_ANIM_BEGOUT\)/);                          // andar a partir do Pedir também
});
