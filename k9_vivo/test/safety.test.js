const test = require('node:test');
const assert = require('node:assert/strict');
const { Safety, POSES, isStopPhrase } = require('../src/safety');

const cfg = { maxSpeed: 0.5, maxWalkSec: 3, walkSecPerMin: 10, actionsPerMin: 3, idleDisarmMin: 10 };
const relogio = (t0 = 1_000_000) => { let t = t0; const f = () => t; f.avanca = (ms) => { t += ms; }; return f; };

test('frases de parada: curtas e sem confundir "para" preposição', () => {
  for (const s of ['para', 'Para!', 'pare', 'pare agora', 'K9 para', 'para tudo', 'para de andar', 'chega', 'stop', 'quero que pare', 'por favor, pare', 'socorro']) assert.ok(isStopPhrase(s), s);
  for (const s of ['anda para frente', 'vai para a esquerda', 'gira para a direita', 'olá k9', 'senta', 'faz uma dança para mim', '']) assert.ok(!isStopPhrase(s), s);
});

test('nada passa enquanto estiver desarmado', () => {
  const s = new Safety(cfg, relogio());
  assert.equal(s.gate().ok, false);
  s.arm(); assert.equal(s.gate().ok, true);
  s.disarm(); assert.equal(s.gate().ok, false);
});

test('limite de ações por minuto e liberação depois', () => {
  const now = relogio(); const s = new Safety(cfg, now); s.arm();
  assert.ok(s.gate().ok && s.gate().ok && s.gate().ok);
  assert.equal(s.gate().ok, false);
  now.avanca(61_000); assert.equal(s.gate().ok, true);
});

test('só poses da lista permitida chegam ao robô', () => {
  const s = new Safety(cfg, relogio());
  assert.equal(s.poseCmd('sentar'), 'sit');
  for (const ruim of ['cal', 'test0', 'trim', 'gait3', 'flash', 'wifi', 'ota', '__proto__', 'constructor', 'toString', '', undefined]) assert.equal(s.poseCmd(ruim), null, String(ruim));
  assert.ok(Object.values(POSES).every((c) => !/^(cal|test\d|gait\d?|flash.*)$/.test(c)));
});

test('andar: velocidade e tempo cortados, orçamento por minuto', () => {
  const now = relogio(); const s = new Safety(cfg, now); s.arm();
  const a = s.clampWalk({ frente: 5, giro: -9, segundos: 99 });
  assert.equal(a.ok, true); assert.equal(a.f, 0.5); assert.equal(a.t, -0.5); assert.equal(a.sec, 3);
  assert.ok(a.notes.length >= 2);
  s.clampWalk({ frente: 1, segundos: 3 }); s.clampWalk({ frente: 1, segundos: 3 });          // 9 s gastos
  const d = s.clampWalk({ frente: 1, segundos: 3 });
  assert.equal(d.ok, true); assert.equal(d.sec, 1);                                          // sobrou 1 s
  assert.equal(s.clampWalk({ frente: 1, segundos: 1 }).ok, false);                           // acabou o orçamento
  now.avanca(61_000); assert.equal(s.clampWalk({ frente: 1, segundos: 1 }).ok, true);
});

test('andar: entradas inválidas não andam', () => {
  const s = new Safety(cfg, relogio()); s.arm();
  assert.equal(s.clampWalk({}).ok, false);
  assert.equal(s.clampWalk({ frente: 'abc', giro: NaN }).ok, false);
  assert.equal(s.clampWalk({ frente: 1, segundos: -2 }).sec, 1);
});

test('desarma por inatividade', () => {
  const now = relogio(); const s = new Safety(cfg, now); s.arm();
  now.avanca(9 * 60_000); assert.equal(s.idleExpired(), false);
  now.avanca(2 * 60_000); assert.equal(s.idleExpired(), true);
});
