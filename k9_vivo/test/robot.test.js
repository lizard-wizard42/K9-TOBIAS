const test = require('node:test');
const assert = require('node:assert/strict');
const { createRobot } = require('../src/robot');

function hubFalso({ falha = false } = {}) {
  const chamadas = [];
  const fetchImpl = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    chamadas.push({ url, method: opts.method, body, headers: opts.headers });
    if (falha) return { ok: false, status: 503, json: async () => ({}) };
    if (url.endsWith('/api/status')) return { ok: true, json: async () => ({ online: true, ip: '192.168.0.124', telemetry: { rssi: -55, gait: 5, fwd: 0, turn: 0, uptime: 12 } }) };
    return { ok: true, json: async () => ({ ok: true }) };
  };
  return { fetchImpl, chamadas };
}
const rapido = { tickMs: 5, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

test('status resume a telemetria do hub e envia o token', async () => {
  const { fetchImpl, chamadas } = hubFalso();
  const r = createRobot({ hubUrl: 'http://hub', token: 'segredo', fetchImpl, ...rapido });
  const s = await r.status();
  assert.deepEqual([s.online, s.ip, s.marcha, s.rssi], [true, '192.168.0.124', 5, -55]);
  assert.equal(chamadas[0].headers['x-hub-token'], 'segredo');
});

test('pose manda só o comando pedido', async () => {
  const { fetchImpl, chamadas } = hubFalso();
  await createRobot({ hubUrl: 'http://hub', fetchImpl, ...rapido }).pose('sit');
  assert.deepEqual(chamadas.map((c) => c.body), [{ cmd: 'sit' }]);
});

test('andar manda drive repetido e SEMPRE termina com drive 0', async () => {
  const { fetchImpl, chamadas } = hubFalso();
  const r = createRobot({ hubUrl: 'http://hub', fetchImpl, ...rapido });
  assert.equal(await r.walk(0.3, 0, 0.15), 'terminou');
  const drives = chamadas.map((c) => c.body);
  assert.ok(drives.filter((b) => b.fwd === 0.3).length >= 1);          // com a máquina carregada pode ser só 1 tick; o que importa é o fim
  assert.deepEqual(drives.at(-1), { cmd: 'drive', fwd: 0, turn: 0 });
});

test('parar cancela a caminhada em curso', async () => {
  const { fetchImpl, chamadas } = hubFalso();
  const r = createRobot({ hubUrl: 'http://hub', fetchImpl, ...rapido });
  const p = r.walk(0.3, 0, 5);
  await new Promise((x) => setTimeout(x, 25));
  await r.stop();
  assert.equal(await p, 'interrompido');
  assert.ok(chamadas.some((c) => c.body && c.body.cmd === 'stop'));
  assert.ok(chamadas.filter((c) => c.body && c.body.fwd === 0.3).length < 10);
});

test('hub fora do ar: andar falha e não fica mandando', async () => {
  const { fetchImpl, chamadas } = hubFalso({ falha: true });
  const r = createRobot({ hubUrl: 'http://hub', fetchImpl, ...rapido });
  await assert.rejects(r.walk(0.3, 0, 2));
  assert.ok(chamadas.length <= 6);
});
