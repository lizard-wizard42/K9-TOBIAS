'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { probe, summarize, run } = require('../scripts/diagnose-camera');
async function fixture(t, handler) {
  const server=http.createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  return `http://127.0.0.1:${server.address().port}`;
}
test('separates firmware capture time from HTTP timing and performs exactly ten requests per route',async t=>{
  const counts={status:0,capture:0};
  const base=await fixture(t,(req,res)=>{
    const route=req.url.slice(1);counts[route]++;
    if(route==='status') {res.setHeader('X-Handler-Us','120');res.end(JSON.stringify({profile:'radio-survival-v1',rssi:-44,last_fb_get_us:2300}));}
    else {res.setHeader('X-Fb-Get-Us','2300');res.setHeader('X-Frame-Age-Us','14000');res.setHeader('X-RSSI','-44');res.end(Buffer.from([255,216,1,2,255,217]));}
  });
  const report=await run(base);
  assert.deepEqual(counts,{status:10,capture:10});
  assert.equal(report.captureSummary.fb_get_ms.median,2.3);
  assert.equal(report.capture[0].frame_age_ms,14);
  assert.equal(report.status[0].handler_ms,.12);
  assert.equal(report.capture[0].rssi,-44);
});
test('rejects busy responses, incomplete JPEGs and old firmware',async t=>{
  const base=await fixture(t,(req,res)=>{
    if(req.url==='/status')res.end('{"rssi":-40}');
    else if(req.url==='/capture')res.end(Buffer.from([255,216,0]));
    else {res.statusCode=503;res.end('busy');}
  });
  assert.equal((await probe(new URL('/status',base))).ok,false);
  assert.equal((await probe(new URL('/capture',base))).ok,false);
  assert.equal((await probe(new URL('/busy',base))).httpStatus,503);
});
test('bounds hung requests and excludes failures from timing percentiles',async t=>{
  const base=await fixture(t,()=>{});
  const result=await probe(new URL('/capture',base),{timeoutMs:50});
  assert.equal(result.ok,false);assert.match(result.error,/timeout/);
  assert.deepEqual(summarize([{ok:true,total_ms:10},{ok:false,total_ms:8000},{ok:true,total_ms:30}]),
    {samples:2,min:10,median:20,mean:20,p95:30,max:30});
  assert.equal(summarize([result]),null);
});
