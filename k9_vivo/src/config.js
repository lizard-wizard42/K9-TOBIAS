'use strict';
const path = require('node:path');
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const root = path.join(__dirname, '..');
module.exports = {
  root,
  repo: path.join(root, '..'),
  dataDir: process.env.VIVO_DATA_DIR || path.join(root, 'data'),
  knowledgeDir: path.join(root, 'knowledge'),
  hubUrl: process.env.K9_HUB_URL || 'http://127.0.0.1:3080',
  hubToken: process.env.HUB_TOKEN || '',
  // Só escuta no próprio PC; o celular chega por `adb reverse tcp:3090 tcp:3090`.
  host: process.env.VIVO_HOST || '127.0.0.1',
  port: num(process.env.VIVO_PORT, 3090),
  model: process.env.VIVO_MODEL || 'claude-sonnet-5-5',
  // Limites de segurança (a IA nunca passa disto, mesmo que peça)
  maxSpeed: clamp(num(process.env.VIVO_MAX_SPEED, 0.5), 0.1, 0.8),
  maxWalkSec: 3,
  walkSecPerMin: 10,
  actionsPerMin: 12,
  idleDisarmMin: clamp(num(process.env.VIVO_IDLE_MIN, 10), 1, 120),
  driveTickMs: 100
};
