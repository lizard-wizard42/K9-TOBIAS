/* Pure catalogue and cancellable sequence player. No robot commands during load. */
(function(root) {
  'use strict';
  const catalogue = Object.freeze({
    stand:['Padrão',1500], sit:['Sentar',2200], lie:['Deitar',2500],
    wave:['Pata direita',5000], waveleft:['Pata esquerda',5000], wag:['Abanar o rabo',4500], dig:['Cavar',5500],
    wake:['Acordar',8500], sleep:['Dormir',10000], stretch:['Alongar',7000], scratch:['Coçar',15000], dance:['Dançar',11000],
    emotion_happy:['Feliz',5000], emotion_sad:['Triste',4000], emotion_confused:['Confuso',5000],
    emotion_angry:['Bravo',5500], emotion_curious:['Curioso',6500], emotion_laugh:['Risada',2500],
    emotion_shy:['Vergonha',6500], emotion_celebrate:['Comemorar',6500],
    emotion_greet:['Cumprimentar',6500], emotion_glitch:['Robô com defeito',6500],
    sound_whistle:['Assobio',1500], sound_hello:['Olá',1500], sound_beep:['Bipe',1000],
    wait:['Esperar',1000]
  });
  const activityNames = {
    '-1':'Centralizado',0:'Pronto',1:'Voltando ao padrão',2:'Sentado',3:'Deitado',
    4:'Pata direita',5:'Pata esquerda',6:'Levantando',7:'Dançando',8:'Reverência',
    9:'Alongando',10:'Abanando',11:'Cavando',12:'Balançando',13:'Coçando',
    14:'Pedir',15:'Levantando',16:'Risada',17:'Acordando',18:'Dormindo',19:'Curioso',
    20:'Bravo',21:'Vergonha',22:'Comemorando',23:'Cumprimentando',24:'Robô com defeito',25:'Parado'
  };
  function normalizeSteps(value) {
    if(!Array.isArray(value) || !value.length || value.length>16) throw Error('Use de 1 a 16 passos.');
    let total=0;
    const steps=value.map(s=>{
      if(!s || !Object.hasOwn(catalogue,s.cmd) || !Number.isFinite(s.ms) || s.ms<500 || s.ms>30000) throw Error('Passo inválido.');
      const ms=Math.round(s.ms); total+=ms; return {cmd:s.cmd,ms};
    });
    if(total>180000) throw Error('A sequência pode durar até 3 minutos.');
    return steps;
  }
  class Player {
    constructor({send,stop,ready,onState=()=>{},setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}) {
      Object.assign(this,{send,stop,ready,onState,setTimer,clearTimer});
      this.token=0;this.timer=null;this.active=false;
    }
    cancel(halt=true) {
      this.token++;this.clearTimer(this.timer);this.timer=null;
      const was=this.active;this.active=false;
      if(was && halt) this.stop();
      if(was) this.onState({active:false});
    }
    start(raw) {
      const steps=normalizeSteps(raw);
      this.cancel();
      if(!this.ready()) throw Error('Robô offline.');
      const token=++this.token;this.active=true;
      const next=i=>{
        if(token!==this.token || !this.active) return;
        if(!this.ready()) { this.cancel();return; }
        if(i===steps.length) { this.cancel();return; }
        const step=steps[i];
        this.onState({active:true,index:i,total:steps.length,step});
        if(step.cmd!=='wait') this.send(step.cmd,catalogue[step.cmd][0]);
        this.timer=this.setTimer(()=>next(i+1),step.ms);
      };
      next(0);
    }
  }
  const api={catalogue,activityNames,normalizeSteps,Player};
  if(typeof module!=='undefined') module.exports=api;else root.K9ExperienceCore=api;
})(globalThis);
