#!/usr/bin/env node
'use strict';
// No dependencies. Usage: node scripts/diagnose-camera.js [http://192.168.0.240] [report.json]
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');

function probe(url, { timeoutMs = 8000, maxBytes = 1024 * 1024 } = {}) {
  return new Promise(resolve => {
    const started = performance.now();
    let finished = false, response, timer, headersAt = null, connectAt = null;
    const chunks = []; let bytes = 0;
    const finish = error => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      const body = Buffer.concat(chunks);
      let status = null;
      if (!error && url.pathname === '/status') {
        try {
          status = JSON.parse(body.toString());
          if (status.profile !== 'radio-survival-v1' || !Number.isFinite(status.last_fb_get_us))
            error = 'firmware de diagnóstico não identificado';
        } catch { error = 'JSON inválido'; }
      }
      if (!error && url.pathname === '/capture' &&
          (body.length < 4 || body.readUInt16BE(0) !== 0xffd8 || body.readUInt16BE(body.length - 2) !== 0xffd9))
        error = 'JPEG inválido/incompleto';
      const numberHeader = name => {
        const raw = response?.headers[name];
        return raw !== undefined && Number.isFinite(Number(raw)) ? Number(raw) : null;
      };
      resolve({ ok: !error, error: error || null, httpStatus: response?.statusCode || null,
        total_ms: performance.now() - started, connect_ms: connectAt,
        ttfb_ms: headersAt, bytes, rssi: status?.rssi ?? numberHeader('x-rssi'),
        fb_get_ms: status ? status.last_fb_get_us / 1000 :
          numberHeader('x-fb-get-us') === null ? null : numberHeader('x-fb-get-us') / 1000,
        frame_age_ms: numberHeader('x-frame-age-us') === null ? null : numberHeader('x-frame-age-us') / 1000,
        handler_ms: numberHeader('x-handler-us') === null ? null : numberHeader('x-handler-us') / 1000,
        status });
    };
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      agent: false, headers: { Connection: 'close', 'Cache-Control': 'no-cache' }
    }, res => {
      response = res; headersAt = performance.now() - started;
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) { finish('resposta excedeu limite'); res.destroy(); request.destroy(); return; }
        chunks.push(chunk);
      });
      res.on('end', () => finish(res.statusCode === 200 ? null : `HTTP ${res.statusCode}`));
      res.on('aborted', () => finish('resposta interrompida'));
      res.on('error', e => finish(e.message));
    });
    request.on('socket', socket => {
      socket.setNoDelay(true);
      socket.once('connect', () => { connectAt = performance.now() - started; });
    });
    request.on('error', e => finish(e.message));
    timer = setTimeout(() => { finish(`timeout ${timeoutMs} ms`); response?.destroy(); request.destroy(); }, timeoutMs);
  });
}
function summarize(rows, key = 'total_ms') {
  const values = rows.filter(r => r.ok && Number.isFinite(r[key])).map(r => r[key]).sort((a,b) => a-b);
  if (!values.length) return null;
  const n = values.length;
  return { samples: n, min: values[0], median: n % 2 ? values[(n-1)/2] : (values[n/2-1]+values[n/2])/2,
    mean: values.reduce((a,b)=>a+b,0)/n, p95: values[Math.ceil(n*.95)-1], max: values[n-1] };
}
function fmt(value) { return Number.isFinite(value) ? value.toFixed(1) : '—'; }
async function run(base, { count = 10, timeoutMs = 8000 } = {}) {
  const root = new URL(base);
  if (!['http:', 'https:'].includes(root.protocol)) throw new Error('Use http:// ou https://');
  const report = { at: new Date().toISOString(), target: root.origin, count, status: [], capture: [] };
  console.log('K9CAM — diagnóstico direto, sem hub/navegador. Feche o vídeo para uma linha de base sem concorrência.');
  for (const route of ['status','capture']) {
    console.log(`\n/${route}: ${count} pedidos sequenciais, conexão TCP nova a cada pedido`);
    for (let i=0; i<count; i++) {
      const row = await probe(new URL('/'+route,root), {timeoutMs}); report[route].push(row);
      console.log(`${i+1}/${count}: ${row.ok?'OK':row.error} | total ${fmt(row.total_ms)} ms | TTFB ${fmt(row.ttfb_ms)} ms | fb_get ${fmt(row.fb_get_ms)} ms | RSSI ${row.rssi ?? '—'} | ${row.bytes} bytes`);
    }
  }
  console.log('\nResumo (tempos em ms; estatísticas só dos pedidos válidos):');
  for (const route of ['status','capture']) {
    const rows=report[route], good=rows.filter(r=>r.ok);
    report[route+'Summary']={valid:good.length, failures:rows.length-good.length,
      total_ms:summarize(rows), fb_get_ms:summarize(rows,'fb_get_ms'),
      effective_fps:route==='capture'?good.length/(rows.reduce((n,r)=>n+r.total_ms,0)/1000):null};
    const s=report[route+'Summary'];
    console.log(`/${route}: ${s.valid}/${rows.length} OK | mediana ${fmt(s.total_ms?.median)} | média ${fmt(s.total_ms?.mean)} | p95 ${fmt(s.total_ms?.p95)} | máximo ${fmt(s.total_ms?.max)}`);
  }
  console.log(`Captura: fb_get mediano ${fmt(report.captureSummary.fb_get_ms?.median)} ms; taxa efetiva ${fmt(report.captureSummary.effective_fps)} fps.`);
  const state=report.status.find(r=>r.ok)?.status;
  if (state) console.log('Estado:', JSON.stringify(state));
  console.log('\nInterpretação: /status também lento aponta para rede/stack/escalonamento, não identifica sozinho antena ou energia.');
  console.log('fb_get alto aponta para espera pelo framebuffer; fb_get baixo com captura lenta aponta para fila/envio/transporte.');
  console.log('fb_get mede espera da API (pode devolver quadro já pronto), não exposição completa. X-Frame-Age mede idade desde o primeiro DMA até preparar a resposta.');
  console.log('total inclui conexão TCP e transferência; não é latência cena→tela. Contadores de falha HTTP não são perda ICMP.');
  return report;
}
if (require.main === module) {
  run(process.argv[2] || 'http://192.168.0.240').then(report=>{
    if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(report,null,2)+'\n');
    if (report.statusSummary.failures || report.captureSummary.failures) process.exitCode=1;
  }).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports = { probe, summarize, run };
