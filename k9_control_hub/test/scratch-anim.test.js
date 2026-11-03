const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

test('o comando "scratch" é aceito pelo hub e existe o botão Coçar com ícone', () => {
  assert.match(read('../server.js').match(/const CMDS = new Set\(\[([\s\S]*?)\]\)/)[1], /'scratch'/);
  const html = read('../public/index.html');
  assert.match(html, /data-cmd="scratch"[^>]*data-label="Coçar a barriga"[^>]*><img class="pose-icon" src="\/assets\/poses\/scratch\.svg"/);
  assert.ok(fs.existsSync(path.join(__dirname, '../public/assets/poses/scratch.svg')));
});

test('o firmware das pernas conhece a animação 13 e o comando scratch', () => {
  const fw = fs.readFileSync(path.join(__dirname, '../../k9v2-1_firmware/src/web_cam_server.h'), 'utf8');
  assert.match(fw, /c == "scratch"[\s\S]{0,80}webOnAnim\(13\)/);
  const core = fs.readFileSync(path.join(__dirname, '../../k9v2-1_firmware/src/gait_core.h'), 'utf8');
  assert.match(core, /GC_ANIM_SCRATCH,/);
  assert.match(core, /case GC_ANIM_SCRATCH: return gc_kf_run_then\(GC_KF_SCRATCH/);
});
