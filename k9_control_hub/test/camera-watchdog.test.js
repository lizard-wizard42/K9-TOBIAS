const test = require('node:test');
const assert = require('node:assert/strict');
const create = require('../public/camera-watchdog');
function fixture(status) {
 let t=20000, calls=0, reads=0;
 const state={ip:'192.168.0.240',openedAt:1000,viewer:'a',suspended:false};
 const check=create({getState:()=>state,getStatus:async()=>{reads++;return status;},reconnect:()=>calls++,now:()=>t});
 return {check,state,setTime:v=>t=v,calls:()=>calls,reads:()=>reads};
}
test('silent closed viewer reconnects even while another viewer receives frames',async()=>{
 const f=fixture({viewerConnected:false,upstreamActive:true,lastFrameAt:19999});await f.check();assert.equal(f.calls(),1);
 await f.check();assert.equal(f.calls(),1);f.setTime(33000);await f.check();assert.equal(f.calls(),2);
});
test('healthy stream is not periodically reopened',async()=>{
 const f=fixture({viewerConnected:true,upstreamActive:true,lastFrameAt:19999});await f.check();assert.equal(f.calls(),0);
});
test('paused page and initial connection do not poll',async()=>{
 const f=fixture({viewerConnected:false});f.state.suspended=true;await f.check();f.state.suspended=false;f.state.openedAt=19000;await f.check();assert.equal(f.reads(),0);
});
test('relay cooldown is respected and stalled frames recover',async()=>{
 const status={viewerConnected:true,upstreamActive:true,lastFrameAt:1000,retryInMs:2000};const f=fixture(status);await f.check();assert.equal(f.calls(),0);
 status.retryInMs=0;await f.check();assert.equal(f.calls(),1);
});
test('late status from a previous viewer cannot reset a newer connection',async()=>{
 let resolve,calls=0;const state={ip:'camera',openedAt:1,viewer:'a'};
 const check=create({getState:()=>({...state}),getStatus:()=>new Promise(r=>resolve=r),reconnect:()=>calls++,now:()=>20000});
 const pending=check();state.viewer='b';resolve({viewerConnected:false});await pending;assert.equal(calls,0);
});
