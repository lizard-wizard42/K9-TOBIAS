const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeSteps,Player,catalogue}=require('../public/experience-core');
function rig() {
 const timers=new Map(),commands=[],states=[];let id=0,online=true;
 const p=new Player({send:c=>commands.push(c),stop:()=>commands.push('STOP'),ready:()=>online,
 onState:s=>states.push(s),setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:i=>timers.delete(i)});
 return {p,commands,states,offline:()=>online=false,advance:()=>{const [key,fn]=timers.entries().next().value||[];timers.delete(key);if(fn)fn();}};
}
test('sequências rejeitam comandos de manutenção, durações inválidas e limites excessivos',()=>{
 for(const cmd of ['store','cal','jog0plus','__proto__','flashon'])assert.throws(()=>normalizeSteps([{cmd,ms:1000}]));
 for(const ms of [0,NaN,Infinity,-1,30001])assert.throws(()=>normalizeSteps([{cmd:'stand',ms}]));
 assert.throws(()=>normalizeSteps(Array(17).fill({cmd:'wait',ms:500})));
 assert.throws(()=>normalizeSteps(Array(7).fill({cmd:'wait',ms:30000})));
 assert.equal(normalizeSteps([{cmd:'sleep',ms:30000}])[0].ms,30000);
});
test('sequência respeita espera e interrompe no fim',()=>{
 const r=rig();r.p.start([{cmd:'sit',ms:2000},{cmd:'wait',ms:1000},{cmd:'sound_whistle',ms:1500}]);
 assert.deepEqual(r.commands,['sit']);r.advance();assert.deepEqual(r.commands,['sit']);
 r.advance();assert.equal(r.commands.at(-1),'sound_whistle');r.advance();assert.equal(r.commands.at(-1),'STOP');
 assert.equal(r.p.active,false);
});
test('cancelamento não deixa passos antigos dispararem',()=>{
 const r=rig();r.p.start([{cmd:'sit',ms:2000},{cmd:'dance',ms:5000}]);r.p.cancel();r.advance();
 assert.deepEqual(r.commands,['sit','STOP']);
});
test('queda de conexão interrompe antes do próximo movimento e impede reinício offline',()=>{
 const r=rig();r.p.start([{cmd:'stand',ms:1000},{cmd:'dance',ms:5000}]);r.offline();r.advance();
 assert.deepEqual(r.commands,['stand','STOP']);assert.throws(()=>r.p.start([{cmd:'stand',ms:1000}]));
});
test('substituir uma sequência cancela a anterior',()=>{
 const r=rig();r.p.start([{cmd:'sit',ms:1000},{cmd:'dance',ms:1000}]);
 r.p.start([{cmd:'wake',ms:8500}]);r.advance();assert.deepEqual(r.commands,['sit','STOP','wake','STOP']);
});
test('catálogo expõe todas as novas personalidades e exclui Guardar',()=>{
 for(const c of ['wake','sleep','emotion_curious','emotion_angry','emotion_shy','emotion_celebrate','emotion_greet','emotion_glitch'])assert.ok(catalogue[c]);
 assert.ok(!catalogue.store);
});
