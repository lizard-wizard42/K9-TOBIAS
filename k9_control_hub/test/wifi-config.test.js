const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { validarWifi, enviarWifi } = require('../wifi-config');

test('aceita rede com senha WPA (8 a 63) e rede aberta', () => {
  assert.deepEqual(validarWifi({ alvo: 'legs', ssid: 'Minha Rede', pass: '12345678' }), { ok: true, alvo: 'legs', ssid: 'Minha Rede', pass: '12345678' });
  assert.equal(validarWifi({ alvo: 'cam', ssid: 'Aberta', pass: '' }).ok, true);
  assert.equal(validarWifi({ alvo: 'cam', ssid: 'x'.repeat(32), pass: 'p'.repeat(63) }).ok, true);
});

test('recusa alvo, ssid e senha inválidos, com motivo', () => {
  const ruim = (o) => validarWifi({ alvo: 'legs', ssid: 'Rede', pass: '12345678', ...o });
  assert.equal(ruim({ alvo: 'outro' }).erro, 'alvo');
  for (const ssid of ['', '   ', 'x'.repeat(33), 'a\nb', 'a\u0000b', 5, null]) assert.equal(ruim({ ssid }).erro, 'ssid', String(ssid));
  for (const pass of ['curta', 'p'.repeat(64), 'a\nb', 5]) assert.equal(ruim({ pass }).erro, 'senha', String(pass));
  assert.equal(validarWifi(null).ok, false);
});

test('ssid de 32 bytes: conta bytes UTF-8, não letras', () => {
  assert.equal(validarWifi({ alvo: 'legs', ssid: 'é'.repeat(17), pass: '' }).erro, 'ssid');   // 34 bytes
  assert.equal(validarWifi({ alvo: 'legs', ssid: 'é'.repeat(16), pass: '' }).ok, true);
});

test('enviarWifi faz POST /wifi em formulário na placa e devolve o resultado', async () => {
  let visto;
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { visto = { m: req.method, u: req.url, t: req.headers['content-type'], b }; res.end('Saved'); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  const r = await enviarWifi('127.0.0.1', 'Casa & Cia', 'se nha=1', { port: porta });
  srv.close();
  assert.equal(r.ok, true);
  assert.equal(visto.m, 'POST'); assert.equal(visto.u, '/wifi'); assert.match(visto.t, /x-www-form-urlencoded/);
  assert.equal(new URLSearchParams(visto.b).get('ssid'), 'Casa & Cia'); assert.equal(new URLSearchParams(visto.b).get('pass'), 'se nha=1');
});

test('enviarWifi: placa fora do ar e erro HTTP viram falha, sem vazar a senha', async () => {
  const off = await enviarWifi('127.0.0.1', 'Rede', 'segredo123', { port: 1, timeoutMs: 500 });
  assert.equal(off.ok, false); assert.ok(!JSON.stringify(off).includes('segredo123'));
  const srv = http.createServer((q, s) => { s.statusCode = 400; s.end('Invalid'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const bad = await enviarWifi('127.0.0.1', 'Rede', 'segredo123', { port: srv.address().port });
  srv.close(); assert.equal(bad.ok, false);
});
