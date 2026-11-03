const test = require('node:test');
const assert = require('node:assert/strict');
const { gaitPacket } = require('../gait-params');
test('creator presets inside the reach limit pass the tuning packet', () => {
  for (const [s,d] of [[53,.66],[47,.70]])
    assert.match(gaitPacket([1.6,s,d,-6,1]), /^G 1.60 /);
  assert.match(gaitPacket([1.25,51,.66,-6,1]), /^G 1.25 51.00/);       // MK3 preset
});
test('invalid, malformed and over-speed combinations cannot reach the robot', () => {
  for (const v of [null, {}, [], [1.6,53,.66,-6], ['1.6',53,.66,-6,1],
    [NaN,53,.66,-6,1], [Infinity,53,.66,-6,1], [1.6,60,.66,-6,1],
    [1.6,53,.66,-6,1.4], [.1,53,.66,-6,1], [1,50,1,-6,1], [1,50,.6,30,1]])
    assert.equal(gaitPacket(v), null);
});
test('valid tuning packet is atomic and rounded before validation', () => {
  assert.equal(gaitPacket([1,40,.6,-5,.8]), 'G 1.00 40.00 0.60 -5.00 0.80');
  assert.equal(gaitPacket([1.6,53,.665,-6,1]), null);
});
test('reach (stride + |posture|) is bounded like the firmware', () => {
  assert.equal(gaitPacket([1, 60, .6, 15, 1]), null);       // 75 deg
  assert.equal(gaitPacket([1.6, 65, .58, -6, 1]), null);    // 71 deg: past the 60 deg thigh range
  assert.match(gaitPacket([1.2, 54, .66, -6, 1]), /^G 1.20 54.00/);   // 60 deg: at the limit, allowed
});
