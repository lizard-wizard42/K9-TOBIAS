const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');

process.env.VIVO_PORT = '39090'; process.env.VIVO_DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'vivo-'));
process.env.K9_HUB_URL = 'http://127.0.0.1:39091';     // hub falso abaixo
delete process.env.ANTHROPIC_API_KEY; process.env.VIVO_SEM_IA = '1';

const hubCmds = [];
const hub = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => { if (req.method === 'POST') hubCmds.push(JSON.parse(b || '{}')); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(req.url.endsWith('status') ? { online: true, telemetry: { gait: 5 } } : { ok: true })); });
});

const get = (path, host = 'localhost:39090') => new Promise((ok) => http.get({ host: '127.0.0.1', port: 39090, path, headers: { host } }, (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => ok({ status: r.statusCode, d })); }));
const abre = (origin) => new Promise((ok, no) => { const w = new WebSocket('ws://127.0.0.1:39090/ws', { origin, headers: { host: 'localhost:39090' } }); w.msgs = []; w.on('message', (m) => w.msgs.push(JSON.parse(m))); w.on('open', () => ok(w)); w.on('error', no); w.on('unexpected-response', () => no(new Error('recusado'))); });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

let servidor;
test.before(async () => { await new Promise((r) => hub.listen(39091, '127.0.0.1', r)); servidor = await require('../src/server').iniciar(); });
test.after(() => { servidor.close(); hub.close(); setTimeout(() => process.exit(0), 50); });

test('serve a página, o /health e recusa host estranho e arquivo fora de web/', async () => {
  assert.equal((await get('/')).status, 200); assert.match((await get('/')).d, /K9/);
  assert.equal(JSON.parse((await get('/health')).d).armed, false);
  assert.equal((await get('/', 'evil.com')).status, 403);
  assert.equal((await get('/../package.json')).status, 404);
  assert.equal((await get('/%2e%2e/package.json')).status, 404);
});

test('WebSocket: recusa origem de outro site; aceita localhost', async () => {
  await assert.rejects(abre('http://evil.example'));
  const w = await abre('http://localhost:39090'); w.close();
});

test('fluxo por voz: desarmado ignora, arma, obedece, para', async () => {
  const w = await abre('http://localhost:39090'); hubCmds.length = 0;
  w.send(JSON.stringify({ type: 'transcript', text: 'senta' })); await espera(300);
  assert.ok(w.msgs.some((m) => m.type === 'say' && /desarmado/.test(m.text))); assert.ok(!hubCmds.some((c) => c.cmd === 'sit'));
  w.send(JSON.stringify({ type: 'transcript', text: 'ativar vivo' })); await espera(300);
  w.send(JSON.stringify({ type: 'transcript', text: 'senta' })); await espera(400);
  assert.ok(hubCmds.some((c) => c.cmd === 'sit'));
  hubCmds.length = 0; w.send(JSON.stringify({ type: 'transcript', text: 'para' })); await espera(300);
  assert.ok(hubCmds.some((c) => c.cmd === 'stop'));
  w.send('lixo não json'); w.send(JSON.stringify({ type: 'transcript', text: 123 })); await espera(100);
  hubCmds.length = 0; w.close(); await espera(400);
  assert.ok(hubCmds.some((c) => c.cmd === 'stop'));                                 // celular sumiu: para
  assert.equal(JSON.parse((await get('/health')).d).armed, false);                  // e desarma
});
