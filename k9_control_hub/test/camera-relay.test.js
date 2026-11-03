'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createCameraRelay } = require('../camera-relay');
const delay = ms => new Promise(r => setTimeout(r, ms));
const jpeg = Buffer.from([255, 216, 1, 2, 3, 255, 217]);
const frame = Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`), jpeg, Buffer.from('\r\n')]);
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }
async function waitUntil(fn) { for(let i=0;i<100;i++) { if(fn()) return; await delay(10); } assert.fail('condition timed out'); }
async function setup(t, serve, options = {}) {
  let opens = 0; let active = 0;
  const camera = http.createServer((req,res) => { opens++; active++; res.on('close',()=>active--); serve(req,res); });
  const port = await listen(camera);
  const relay = createCameraRelay({ getTarget: () => ({hostname:'127.0.0.1',port,path:'/stream'}), ...options });
  const hub = http.createServer(relay.handle); const hubPort = await listen(hub);
  const requests=[];
  t.after(() => { requests.forEach(r=>r.destroy()); relay.close(); hub.closeAllConnections(); camera.closeAllConnections(); hub.close(); camera.close(); });
  async function viewer() {
    const request = http.get(`http://127.0.0.1:${hubPort}/`, {agent:false}); requests.push(request); request.on('error',()=>{});
    const [response] = await once(request,'response'); response.on('error',()=>{});
    let data=Buffer.alloc(0);response.on('data',c=>data=Buffer.concat([data,c]));
    return { request,response,data:()=>data };
  }
  return { relay, viewer, opens:()=>opens, active:()=>active };
}
function stream(req,res) {
  res.writeHead(200,{'Content-Type':'multipart/x-mixed-replace; boundary=frame'});
  // Fragment headers and JPEG across network chunks.
  const timer=setInterval(()=>{res.write(frame.subarray(0,16));res.write(frame.subarray(16));},15);
  res.on('close',()=>clearInterval(timer));
}
test('three viewers share one camera; closing the last viewer releases upstream', async t => {
  const s=await setup(t,stream);const a=await s.viewer();await waitUntil(()=>a.data().includes(jpeg));
  const b=await s.viewer();const c=await s.viewer();await waitUntil(()=>b.data().includes(jpeg)&&c.data().includes(jpeg));
  assert.equal(s.opens(),1);assert.equal(s.relay.status().viewers,3);
  assert.match(b.data().toString('latin1'),/^--k9frame\r\n/);
  a.request.destroy();await delay(30);assert.equal(s.active(),1);
  b.request.destroy();c.request.destroy();await waitUntil(()=>s.active()===0);
  assert.equal(s.relay.status().upstreamActive,false);
});
test('stalled camera is closed; cooldown avoids a reconnect storm',async t=>{
  const s=await setup(t,(q,r)=>{r.writeHead(200,{'Content-Type':'multipart/x-mixed-replace; boundary=frame'});r.flushHeaders();},{timeoutMs:60,cooldownMs:150});
  await s.viewer();await waitUntil(()=>s.relay.status().lastError==='camera_frame_timeout');
  const b=await s.viewer();assert.equal(b.response.statusCode,503);assert.equal(s.opens(),1);
});
test('oversized frames are rejected without retaining a giant buffer',async t=>{
  const s=await setup(t,(q,r)=>{r.writeHead(200,{'Content-Type':'multipart/x-mixed-replace; boundary=frame'});r.write('--frame\r\nContent-Length: 999999999\r\n\r\n');});
  await s.viewer();await waitUntil(()=>s.relay.status().lastError==='camera_invalid_length');assert.equal(s.relay.status().viewers,0);
});
test('viewer limit does not open more camera connections',async t=>{
  const s=await setup(t,stream,{maxViewers:1});await s.viewer();const b=await s.viewer();assert.equal(b.response.statusCode,503);assert.equal(s.opens(),1);
});
test('camera EOF releases viewers and allows recovery after cooldown',async t=>{
  const s=await setup(t,(q,r)=>{r.writeHead(200,{'Content-Type':'multipart/x-mixed-replace; boundary=frame'});r.end(frame);},{cooldownMs:20});
  await s.viewer();await waitUntil(()=>s.relay.status().lastError==='camera_stream_ended');await delay(30);await s.viewer();await waitUntil(()=>s.opens()===2);
});
test('a stalled viewer is dropped without stopping a healthy viewer',async t=>{
  const s=await setup(t,stream);
  // Exercise backpressure deterministically; operating-system TCP buffers differ.
  const {EventEmitter}=require('node:events');
  function sink(blocked){const r=new EventEmitter();Object.assign(r,{destroyed:false,writableNeedDrain:blocked,writableLength:0,writeHead(){},flushHeaders(){},write(){r.writes++;return true;},writes:0,destroy(){r.destroyed=true;r.emit('close');}});return r;}
  const slow=sink(true),fast=sink(false);s.relay.handle({method:'GET'},slow);s.relay.handle({method:'GET'},fast);
  await waitUntil(()=>fast.writes>1);assert.equal(slow.destroyed,true);assert.equal(s.relay.status().viewers,1);assert.equal(s.relay.status().slowViewers,1);fast.destroy();
});
