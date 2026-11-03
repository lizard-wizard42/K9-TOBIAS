const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
function setup() {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id,{value:'',textContent:'',addEventListener(){}}); return elements.get(id); };
  const buttons = [1,2,3,4,5].map(i=>({dataset:{cmd:'gait'+i},setAttribute(k,v){this[k]=v;}}));
  const document = {addEventListener(){}, getElementById:get, querySelectorAll:()=>buttons};
  const ctx = {document,window:{addEventListener(){}},location:{search:''},URLSearchParams,setTimeout,clearTimeout,console};
  vm.runInNewContext([...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n')+'\nglobalThis.ui=K9Hub;',ctx);
  const ui = ctx.ui, events=[]; let stops=0;
  ui.socket={connected:true,emit:(...v)=>events.push(v)};
  ui.clearSources=()=>{stops++;};ui.toast=()=>{};
  return {ui,get,buttons,events,stops:()=>stops};
}
test('new actions are blocked for legacy firmware and selection follows board telemetry',()=>{
  const {ui,buttons,events}=setup();
  ui.sendCmd('gait2');assert.equal(events.length,0);
  ui.renderGaits({controlsVersion:2,gait:3,gaitParams:[1.6,65,.58,-6,1]});
  assert.equal(buttons[2]['aria-pressed'],'true');assert.equal(buttons[0].disabled,false);
  ui.sendCmd('waveleft');assert.equal(events[0][1].cmd,'waveleft');
  ui.sendCmd('gait5');assert.equal(events[1][1].cmd,'gait5');
  ui.renderGaits({controlsVersion:2,gait:5});assert.equal(buttons[4]['aria-pressed'],'true');
  ui.renderGaits({gait:1});assert.equal(buttons[0].disabled,true);
});
test('tuning stops local inputs, sends a single atomic packet, and rejects overspeed',()=>{
  const {ui,get,events,stops}=setup();ui.controlsVersion=2;
  [1.6,53,.66,-6,1].forEach((v,i)=>get('gaitParam'+i).value=String(v));
  ui.applyGaitParams();assert.equal(stops(),1);assert.equal(events[0][0],'k9:gait_params');
  assert.deepEqual(Array.from(events[0][1]),[1.6,53,.66,-6,1]);
  get('gaitParam1').value='60';ui.applyGaitParams();assert.equal(events.length,1);
});
test('gait variation buttons 1-5 and badge button are present',()=>{
  assert.match(html, /id="gaitBadgeBtn"/);
  assert.match(html, /data-marcha-var="1"[\s\S]*?data-marcha-var="5"/);
});
