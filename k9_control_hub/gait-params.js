// Same bounds as webOnTune; never clamp one component of an invalid combination.
'use strict';
function gaitPacket(a) {
  if (!Array.isArray(a) || a.length !== 5 || !a.every(v => typeof v === 'number' && Number.isFinite(v))) return null;
  const v = a.map(n => Math.round(n * 100) / 100);
  const [f, s, d, p, q] = v;
  if (f < .2 || f > 3 || s < 5 || s > 65 || d < .1 || d > .9 || p < -20 || p > 20 || q < .6 || q > 1.4) return null;
  if (2 * s * f * Math.max(1, q) / (1 - d) > 503) return null;
  const r = Math.max(q, 0.05);
  if (Math.abs(p) + s * 2 * Math.max(r, 1) / (1 + r) > 60.01) return null;   // reach |posture| + larger amplitude <= 60 deg, same as the firmware
  return 'G ' + v.map(n => n.toFixed(2)).join(' ');
}
// Rear-return variation (firmware 1.1.0, UDP "R <add>"): the rear legs get duty + add, so they return faster
// than the front. Same bounds as webOnRearDuty: 0..0.15, rear duty <= 0.85, rear return stroke <= 503 deg/s.
function rearPacket(a, add) {
  if (!gaitPacket(a) || typeof add !== 'number' || !Number.isFinite(add)) return null;
  const x = Math.round(add * 100) / 100;
  const [f, s, d, , q] = a.map(n => Math.round(n * 100) / 100);
  const dr = d + x, ampRear = s * 2 / (1 + Math.max(q, 0.05));
  if (x < 0 || x > .15 || dr > .85 || 2 * ampRear * f / (1 - dr) > 503) return null;
  return 'R ' + x.toFixed(2);
}
module.exports = { gaitPacket, rearPacket };
