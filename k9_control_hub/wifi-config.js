'use strict';
const http = require('node:http');

/* Troca da rede Wi-Fi das placas pelo painel. O hub valida e repassa para `POST /wifi` da placa (ssid, pass); a placa guarda na
   flash e reinicia. A senha nunca é registrada em log nem devolvida na resposta. */
const ALVOS = new Set(['legs', 'cam']);
const temControle = (s) => /[\u0000-\u001f\u007f]/.test(s);

function validarWifi(entrada) {
  const o = entrada && typeof entrada === 'object' ? entrada : {};
  if (!ALVOS.has(o.alvo)) return { ok: false, erro: 'alvo' };
  if (typeof o.ssid !== 'string' || !o.ssid.trim() || temControle(o.ssid) || Buffer.byteLength(o.ssid, 'utf8') > 32) return { ok: false, erro: 'ssid' };
  const pass = o.pass === undefined || o.pass === null ? '' : o.pass;
  if (typeof pass !== 'string' || temControle(pass) || (pass !== '' && (pass.length < 8 || pass.length > 63))) return { ok: false, erro: 'senha' };
  return { ok: true, alvo: o.alvo, ssid: o.ssid, pass };
}

function enviarWifi(ip, ssid, pass, { port = 80, timeoutMs = 4000 } = {}) {
  return new Promise((resolve) => {
    const corpo = new URLSearchParams({ ssid, pass }).toString();
    let pronto = false;
    const fim = (r) => { if (!pronto) { pronto = true; resolve(r); } };
    const req = http.request({ host: ip, port, path: '/wifi', method: 'POST', timeout: timeoutMs,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(corpo) } }, (res) => {
      res.resume();
      res.on('end', () => fim(res.statusCode >= 200 && res.statusCode < 300 ? { ok: true } : { ok: false, erro: 'placa', status: res.statusCode }));
    });
    req.on('timeout', () => { req.destroy(); fim({ ok: false, erro: 'sem_resposta' }); });
    req.on('error', () => fim({ ok: false, erro: 'sem_resposta' }));
    req.end(corpo);
  });
}

module.exports = { validarWifi, enviarWifi };
