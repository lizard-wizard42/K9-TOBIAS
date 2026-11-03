'use strict';
/* Camada de segurança do Vivo: lista de comandos permitidos, limites de andar, taxa de ações e armar/desarmar.
   Funções puras e relógio injetável, para testar sem robô. A IA só chega ao robô passando por aqui. */

const { norm, isStopPhrase } = require('../../k9_control_hub/public/voice-nlu.js');   // fonte única das regras de voz (painel e Vivo)

// nome que a IA usa -> comando que o hub aceita. Nada fora desta lista chega ao robô.
const POSES = Object.freeze({
  em_pe: 'stand', sentar: 'sit', deitar: 'lie', pata_direita: 'wave', pata_esquerda: 'waveleft',
  dancar: 'dance', alongar: 'stretch', abanar_rabo: 'wag', cavar: 'dig'
});

class Safety {
  constructor(cfg, now = Date.now) {
    this.cfg = cfg; this.now = now;
    this.armed = false; this.lastUse = now();
    this.actions = [];   // instantes das ações da última janela de 60 s
    this.walks = [];     // [instante, segundos] das caminhadas da última janela
  }
  arm() { this.armed = true; this.lastUse = this.now(); }
  disarm() { this.armed = false; this.actions = []; this.walks = []; }
  touch() { this.lastUse = this.now(); }
  idleExpired() { return this.armed && this.now() - this.lastUse > this.cfg.idleDisarmMin * 60000; }

  _prune() { const t = this.now() - 60000; this.actions = this.actions.filter((x) => x > t); this.walks = this.walks.filter(([x]) => x > t); }

  // Toda ação passa por aqui antes de ir ao robô.
  gate() {
    if (!this.armed) return { ok: false, reason: 'O Vivo está desarmado. Peça para ativar o Vivo antes.' };
    this._prune();
    if (this.actions.length >= this.cfg.actionsPerMin) return { ok: false, reason: 'Muitas ações em um minuto. Espere um pouco.' };
    this.actions.push(this.now()); this.touch();
    return { ok: true };
  }

  poseCmd(nome) { return Object.prototype.hasOwnProperty.call(POSES, nome) ? POSES[nome] : null; }

  // Limita velocidade e tempo; devolve também o que foi cortado, para a IA saber.
  clampWalk({ frente = 0, giro = 0, segundos = 1 } = {}) {
    const notes = [];
    const lim = (v, m, nome) => { const n = Number(v); const x = Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0; const y = x * m; if (Math.abs(n) > 1) notes.push(`${nome} limitado a 1`); return y; };
    let f = lim(frente, this.cfg.maxSpeed, 'frente'), t = lim(giro, this.cfg.maxSpeed, 'giro');
    let sec = Number(segundos); if (!Number.isFinite(sec) || sec <= 0) sec = 1;
    if (sec > this.cfg.maxWalkSec) { sec = this.cfg.maxWalkSec; notes.push(`tempo limitado a ${this.cfg.maxWalkSec} s`); }
    this._prune();
    const usado = this.walks.reduce((s, [, x]) => s + x, 0);
    const resta = this.cfg.walkSecPerMin - usado;
    if (resta <= 0) return { ok: false, reason: `Já andei ${usado.toFixed(0)} s no último minuto; vou esperar.` };
    if (sec > resta) { sec = resta; notes.push(`tempo reduzido para ${resta.toFixed(1)} s (limite por minuto)`); }
    if (f === 0 && t === 0) return { ok: false, reason: 'Sem direção para andar.' };
    this.walks.push([this.now(), sec]);
    return { ok: true, f: +f.toFixed(2), t: +t.toFixed(2), sec: +sec.toFixed(1), notes };
  }
}

module.exports = { Safety, POSES, isStopPhrase, norm };
