'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function setup() {
  function target() {
    const attrs = new Map(), listeners = new Map();
    return { classList: { add(){}, remove(){}, toggle(){} },
      addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},
      fire(name){for(const fn of listeners.get(name)||[])fn({});},
      removeAttribute(name){attrs.delete(name);},getAttribute(name){return attrs.get(name)||null;},
      set src(value){attrs.set('src',value);},get src(){return attrs.get('src');}
    };
  }
  const elements=new Map(), document=target(), window=target(), timers=new Map();let next=0;
  document.hidden=false;document.getElementById=id=>{if(!elements.has(id))elements.set(id,target());return elements.get(id);};
  const context={document,window,location:{search:'?token=test-token'},URLSearchParams,console,
    setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id)};
  const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
  vm.runInNewContext(script+'\nglobalThis.ui=K9Hub;',context);
  const ui=context.ui;ui.renderLink=()=>{};ui.clearSources=()=>{};ui.camIp='192.168.0.123';ui.initSafety();
  return {ui,document,window,timers,img:document.getElementById('camStream')};
}
test('hidden tabs cancel queued retries and cannot reopen video',()=>{
 const {ui,document,timers,img}=setup();ui.setStream(ui.camIp,true);
 assert.match(img.src,/^\/api\/camera\/stream\?token=test-token&viewer=[^&]+&v=/);
 img.fire('error');assert.equal(timers.size,1);
 document.hidden=true;document.fire('visibilitychange');assert.equal(timers.size,0);assert.equal(img.src,undefined);
 ui.setStream(ui.camIp,true);img.fire('error');assert.equal(img.src,undefined);assert.equal(timers.size,0);
});
test('pagehide cancels video and pageshow restores the stream',()=>{
 const {ui,window,img}=setup();ui.setStream(ui.camIp);window.fire('pagehide');ui.setStream(ui.camIp,true);
 assert.equal(img.src,undefined);window.fire('pageshow');assert.match(img.src,/^\/api\/camera\/stream/);
});
test('stream load keeps the connection open; errors retry after relay cooldown',()=>{
 const {ui,document,timers,img}=setup();ui.setStream(ui.camIp,true);
 const original=img.src;
 img.fire('load');img.fire('load');
 assert.equal(timers.size,0);assert.equal(img.src,original);
 img.fire('error');assert.equal([...timers.values()][0].ms,3000);
 document.hidden=true;document.fire('visibilitychange');assert.equal(timers.size,0);
 img.fire('load');assert.equal(timers.size,0);
});
