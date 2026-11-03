const test = require('node:test');
const assert = require('node:assert/strict');
const { PRESETS, createController } = require('../public/gait-tests');
const { gaitPacket } = require('../gait-params');
function setup() {
  const handlers = {}, events = []; let state, stops = 0, timeout;
  const hub = { socket: { connected: true, on: (k, cb) => handlers[k] = cb,
    emit: (...args) => events.push(args) }, stopAll: () => { stops++; } };
  const ctl = createController(hub, s => state = s,
    { setTimeout: cb => { timeout = cb; return 1; }, clearTimeout() {} });
  const receive = (overrides = {}) => ctl.receive({ online: true, controlsVersion: 2, gait: 5,
    gaitParams: [1.25, 51, .66, -6, 1], ...overrides });
  return { ctl, hub, receive, handlers, events, state: () => state, stops: () => stops, expire: () => timeout() };
}
test('all four experiments pass server limits and differ from the baseline', () => {
  const base = [1.5, 51, .66, -6, 1];
  assert.equal(PRESETS.length, 4);
  for (const p of PRESETS) {
    assert.ok(gaitPacket(p.values));
    assert.ok(p.values.some((v, i) => v !== base[i]));
  }
});
test('selection stops existing activity, sends only adjustment, and waits for board confirmation', () => {
  const s = setup(); s.receive();
  assert.equal(s.events.length, 0);
  assert.equal(s.ctl.select('I'), true); assert.equal(s.stops(), 1);
  assert.deepEqual(s.events[0][0], 'k9:gait_params'); assert.deepEqual(s.events[0][1], [...PRESETS[0].values, 0, 180, 0, 180]);
  s.events[0][2]({ ok: true }); assert.equal(s.state().pending, 'I');
  s.receive(); assert.equal(s.state().pending, 'I');
  s.receive({ gait: 7, gaitParams: PRESETS[0].values });
  assert.equal(s.state().active, 'I'); assert.equal(s.state().pending, null);
  s.receive(); assert.equal(s.state().active, undefined);
});
test('offline, legacy, invalid and repeated selections never enqueue adjustments', () => {
  const s = setup();
  assert.equal(s.ctl.select('I'), false);
  s.receive({ controlsVersion: 1 }); assert.equal(s.ctl.select('I'), false);
  s.receive(); assert.equal(s.ctl.select('unknown'), false);
  s.hub.socket.connected = false; assert.equal(s.ctl.select('I'), false);
  s.hub.socket.connected = true; s.ctl.select('J');
  assert.equal(s.ctl.select('K'), false); assert.equal(s.events.length, 1);
  s.handlers.disconnect(); assert.equal(s.state().ready, false); assert.equal(s.state().pending, null);
});
test('rejection and timeout do not claim success or automatically retry', () => {
  const s = setup(); s.receive(); s.ctl.select('K'); s.events[0][2]({ ok: false });
  assert.equal(s.state().pending, null); assert.match(s.state().message, /recusou/);
  s.ctl.select('L'); s.expire(); assert.match(s.state().message, /não confirmou/);
  assert.equal(s.events.length, 2); assert.equal(s.state().pending, null);
  s.events[1][2]({ ok: true }); assert.match(s.state().message, /não confirmou/);
});
