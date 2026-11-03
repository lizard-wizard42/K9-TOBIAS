const test = require('node:test');
const assert = require('node:assert/strict');
const { VARIACOES, match, createController } = require('../public/marcha-variacoes');
const { gaitPacket, rearPacket } = require('../gait-params');

function setup() {
  const handlers = {}, events = []; let state, stops = 0, timeout;
  const hub = { socket: { connected: true, on: (k, cb) => handlers[k] = cb,
    emit: (...args) => events.push(args) }, stopAll: () => { stops++; } };
  const ctl = createController(hub, s => state = s,
    { setTimeout: cb => { timeout = cb; return 1; }, clearTimeout() {} });
  const receive = (overrides = {}) => ctl.receive({ online: true, controlsVersion: 2, gait: 5,
    rearDuty: 0, phase: [0, 180, 180, 0], gaitParams: [1.25, 51, .66, -6, 1], ...overrides });
  return { ctl, hub, receive, handlers, events, state: () => state, stops: () => stops, expire: () => timeout() };
}

test('all 10 variations pass gaitPacket and rearPacket limits', () => {
  assert.equal(VARIACOES.length, 10);
  for (const v of VARIACOES) {
    assert.ok(gaitPacket(v.values), `gaitPacket failed for var ${v.id}`);
    assert.ok(rearPacket(v.values, v.rear), `rearPacket failed for var ${v.id}`);
    assert.ok(v.rear >= 0, `var ${v.id} should have rearDuty >= 0`);
    assert.equal(v.phase.length, 4);
    assert.ok(v.rotulo && v.rotulo.length > 0);
  }
});

test('terrain variations 1 to 5: 1 is the approved baseline, 4 is slippery floor, 5 is rough terrain', () => {
  const v1 = VARIACOES.find(v => v.id === '1');
  assert.deepEqual(Array.from(v1.values), [1.25, 51, .66, -6, 1.00]);
  assert.equal(v1.rear, 0.06);
  assert.match(v1.nome, /Firme/);

  const v4 = VARIACOES.find(v => v.id === '4');
  assert.match(v4.nome, /Liso/);
  assert.equal(v4.values[1], 44);
  assert.equal(v4.values[2], 0.70);
  assert.equal(v4.values[3], -7);

  const v5 = VARIACOES.find(v => v.id === '5');
  assert.match(v5.nome, /Terra/);
  assert.equal(v5.values[3], -3);
  assert.deepEqual(Array.from(v5.phase), [0, 180, 200, 20]);
});

test('selection stops existing activity, emits 10-element packet, and waits for board confirmation', () => {
  const s = setup(); s.receive();
  assert.equal(s.events.length, 0);
  assert.equal(s.ctl.select('1'), true);
  assert.equal(s.stops(), 1);
  assert.equal(s.events[0][0], 'k9:gait_params');
  assert.equal(s.events[0][1].length, 10);
  assert.deepEqual(s.events[0][1], [...VARIACOES[0].values, ...VARIACOES[0].phase, VARIACOES[0].rear]);
  s.events[0][2]({ ok: true });
  assert.equal(s.state().pending, '1');
  s.receive(); // not yet matching (gait still 5)
  assert.equal(s.state().pending, '1');
  s.receive({ gait: 7, gaitParams: VARIACOES[0].values, rearDuty: VARIACOES[0].rear, phase: VARIACOES[0].phase });
  assert.equal(s.state().active, '1');
  assert.equal(s.state().pending, null);
  assert.match(s.state().message, /Variação 1 ativa/);
});

test('match correctly detects each variation from telemetry', () => {
  for (const v of VARIACOES) {
    const matched = match({ gait: 7, gaitParams: v.values, rearDuty: v.rear, phase: v.phase });
    assert.ok(matched, `Should match var ${v.id}`);
    assert.equal(matched.id, v.id);
  }
  assert.equal(match({ gait: 5, gaitParams: [1.25, 51, .66, -6, 1], rearDuty: 0, phase: [0, 180, 180, 0] }), null);
});

test('rejection and timeout do not claim success', () => {
  const s = setup(); s.receive();
  s.ctl.select('2');
  s.events[0][2]({ ok: false });
  assert.equal(s.state().pending, null);
  assert.match(s.state().message, /recusou/);
  s.ctl.select('3');
  s.expire();
  assert.match(s.state().message, /não confirmou/);
  assert.equal(s.state().pending, null);
});

test('variations 6, 8, 9 and 10 are simulation picks; 7 is the Blender-model crawl test', () => {
  const por = id => VARIACOES.find(v => v.id === id);
  assert.deepEqual(Array.from(por('6').values), [1.56, 51, .59, 2.3, .97]);
  assert.deepEqual(Array.from(por('8').values), [1.63, 48, .58, 3.3, 1.17]);
  assert.deepEqual(Array.from(por('8').phase), [0, 180, 210, 30]);
  assert.deepEqual(Array.from(por('9').values), [1.43, 46, .58, -0.9, .82]);
  assert.deepEqual(Array.from(por('7').phase), [0, 180, 270, 90]);     // rastejo: uma pata volta por vez
  assert.deepEqual(Array.from(por('10').values), [1.52, 49, .63, 2.6, 1.13]);   // Sim E
  const sig = v => JSON.stringify([v.values, v.phase, v.rear]);
  assert.equal(new Set(VARIACOES.map(sig)).size, VARIACOES.length, 'duas variações iguais confundiriam o reconhecimento pela telemetria');
});
