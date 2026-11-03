const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

function setup() {
  const els = new Map();
  const get = (id) => { if (!els.has(id)) els.set(id, { value: '60', textContent: '', style: {}, classList: { add() {}, remove() {} }, addEventListener() {} }); return els.get(id); };
  const handlers = {};
  const window = { addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); } };
  const document = { addEventListener() {}, getElementById: get, querySelectorAll: () => [] };
  const ctx = { document, window, location: { search: '' }, URLSearchParams, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, console };
  vm.runInNewContext([...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n') + '\nglobalThis.ui=K9Hub;', ctx);
  const ui = ctx.ui, sent = [];
  ui.socket = { connected: true, emit: (...v) => sent.push(v), volatile: { emit: (...v) => sent.push(v) } };
  ui.speedLimit = 1; ui.toast = () => {};
  const press = (type, key, target = { matches: () => false }, repeat = false) =>
    handlers[type].forEach((fn) => fn({ key, target, repeat, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} }));
  return { ui, sent, press, handlers };
}
const moving = (sent) => sent.filter((e) => e[0] === 'k9:drive' && (e[1].fwd !== 0 || e[1].turn !== 0));

test('held key does not restart the motors after Parar (key repeat)', () => {
  const { ui, sent, press } = setup(); ui.initKeyboard();
  press('keydown', 'w'); assert.ok(moving(sent).length > 0);
  ui.stopAll(); sent.length = 0;
  press('keydown', 'w', undefined, true);             // OS key repeat while W is still held
  assert.equal(moving(sent).length, 0);
  press('keyup', 'w'); press('keydown', 'w');          // released, then pressed again: works
  assert.ok(moving(sent).length > 0);
});

test('Space and WASD still work after touching a slider', () => {
  const { ui, sent, press } = setup(); ui.initKeyboard();
  const rangeTarget = { matches: (sel) => /\binput\b/.test(sel) ? !/:not\(\[type=range\]\)/.test(sel) : false };
  press('keydown', ' ', rangeTarget);
  assert.ok(sent.some((e) => e[0] === 'k9:cmd' && e[1].cmd === 'stop'), 'Espaço deve parar mesmo com o foco num slider');
});

test('joystick gesture is latched after Parar until the finger lifts', () => {
  const { ui } = setup();
  const epochBefore = ui.inputEpoch || 0;
  ui.clearSources();
  assert.equal(ui.inputEpoch, epochBefore + 1);
});

test('joystick: dead zone, curve and axis snap', () => {
  const { ui } = setup();
  const R = 56;
  assert.deepEqual(Array.from(ui.shapeStick(0, 0, R)), [0, 0]);
  assert.deepEqual(Array.from(ui.shapeStick(5, -3, R)), [0, 0]);                      // dentro da zona morta
  const [f, t] = ui.shapeStick(0, -R, R);                                 // todo para frente
  assert.equal(f, 1); assert.equal(t, 0);
  const [f2, t2] = ui.shapeStick(R * 0.08, -R * 0.9, R);                  // ~5° fora do eixo: vira reto
  assert.equal(t2, 0); assert.ok(f2 > 0.7);
  const [f3, t3] = ui.shapeStick(R * 0.5, -R * 0.5, R);                   // diagonal
  assert.ok(f3 > 0 && t3 > 0 && Math.abs(f3 - t3) < 0.02);
  const [fm] = ui.shapeStick(0, -R * 0.5, R);                              // curva: metade do curso < metade da saída
  assert.ok(fm > 0 && fm < 0.5);
  const [fb] = ui.shapeStick(0, R, R); assert.equal(fb, -1);              // ré
});

test('sound shortcuts, C sit and E strobe are single-shot and do not affect drive keys', () => {
  const {ui,press}=setup(), commands=[],strobe=[];
  ui.sendCmd=(...args)=>commands.push(args[0]);ui.setStrobe=hz=>strobe.push(Number(hz));ui.initKeyboard();
  for(const key of ['1','2','3','4','5','6','7','8','9','0']) {press('keydown',key);press('keydown',key,undefined,true);press('keyup',key);}
  assert.deepEqual(commands,['sound_wake','sound_spell','sound_sad','sound_laugh','sound_crazy','sound_beep','sound_hello','sound_alert','sound_robot','sound_alarm']);
  press('keydown','C');press('keydown','C',undefined,true);assert.equal(commands.at(-1),'sit');assert.equal(commands.length,11);
  ui.strobeHz=0;press('keydown','e');press('keydown','e',undefined,true);ui.strobeHz=8;press('keydown','E');assert.deepEqual(strobe,[60,0]);
  assert.deepEqual(Object.keys(ui.keys),[]);
  press('keydown','1',{matches:()=>true});press('keydown','c',{matches:()=>false,closest:()=>({})});assert.equal(commands.length,11);
});
