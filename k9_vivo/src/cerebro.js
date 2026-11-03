'use strict';
const { isStopPhrase, norm } = require('./safety');
const { removerNome } = require('../../k9_control_hub/public/voice-nlu.js');
const lexicon = require('../../k9_control_hub/public/i18n/voice-lexicon.js');   // en, es, fr, de, zh
const { interpretar } = require('./nlu-local');

const ARMAR = /\b(ativar|ativa|ligar|liga|iniciar|modo)\b.*\bvivo\b|\bvivo\b.*\b(ativar|ativa|ligar)\b/;
const DESARMAR = /\b(desativar|desativa|desligar|desliga|sair|encerrar|encerra)\b.*\bvivo\b/;
// Armar/desarmar nos outros idiomas (a frase já vem sem acento e em minúsculas, ou em caracteres chineses)
const ARMAR_I18N = /\b(activate|enable|turn on|start|activar|activa|enciende|activer|active|aktiviere|aktivieren|einschalten)\b.*\bvivo\b|\bvivo\b.*\b(aktivieren|aktiviere|einschalten|activate|enable)\b|(启用|开启|打开|激活).{0,2}vivo/;
const DESARMAR_I18N = /\b(deactivate|disable|turn off|quit|desactivar|desactiva|apaga|desactiver|desactive|deaktiviere|deaktivieren|ausschalten)\b.*\bvivo\b|\bvivo\b.*\b(deaktivieren|deaktiviere|ausschalten|deactivate|disable)\b|(关闭|停用|关掉|关).{0,2}vivo/;
const IDIOMAS = new Set(['pt', 'en', 'es', 'fr', 'de', 'zh']);

/* Cérebro: decide, para cada frase ouvida, o que acontece. Ordem fixa e deliberada:
   1) parar  2) armar/desarmar  3) desarmado = não faz nada  4) IA (Claude)  5) interpretador local. */
class Cerebro {
  constructor({ safety, robot, ferramentas, agente = null, falar, avisar = () => {}, nome = () => 'K9' }) {
    this.nome = nome; this.safety = safety; this.robot = robot; this.agente = agente; this.falar = falar; this.avisar = avisar;
    this.porNome = Object.fromEntries(ferramentas.map((t) => [t.name, t]));
    this.ocupado = false;
  }

  async parar() { await this.robot.stop().catch(() => {}); }

  // continuo = escuta contínua: só obedece se a frase citar o nome do robô (parar nunca exige o nome).
  async tratar(texto, { continuo = false, lang = 'pt' } = {}) {
    if (!IDIOMAS.has(lang)) lang = 'pt';
    const nome = this.nome();
    if (lang === 'pt' ? !norm(texto) : !lexicon.norm(texto)) return;
    const citado = lang === 'pt' ? removerNome(texto, nome) : lexicon.removerNome(texto, nome, lang);
    const t = citado.resto;                                                            // frase sem o nome, normalizada
    const parar = lang === 'pt' ? isStopPhrase(texto, nome) : lexicon.isStopPhrase(texto, nome, lang);
    if (parar) { await this.parar(); this.avisar(); return this.falar('Parei.'); }          // nunca passa pela IA
    if (continuo && !citado.citou) return;                                              // escuta contínua: tudo (inclusive armar) exige o nome; só PARAR dispensa
    if ((lang === 'pt' ? DESARMAR : DESARMAR_I18N).test(t)) { await this.parar(); this.safety.disarm(); this.avisar(); return this.falar('Vivo desligado.'); }
    if ((lang === 'pt' ? ARMAR : ARMAR_I18N).test(t)) { this.safety.arm(); this.avisar(); return this.falar('Vivo ativado. Pode falar.'); }
    if (!this.safety.armed) {                                                           // desarmado: pode conversar e consultar, mas nada de mexer o corpo
      if (this.agente && !interpretar(t, lang)) {
        try { const fala = await this.agente.responder(texto, { fisico: false, lang }); if (fala) return this.falar(fala); } catch (e) { /* cai na resposta padrão */ }
      }
      return this.falar('Estou desarmado. Diga ativar vivo para eu obedecer.');
    }
    if (this.ocupado) return this.falar('Só um momento.');
    this.ocupado = true; this.safety.touch();
    try {
      if (this.agente) {
        try { const fala = await this.agente.responder(texto, { lang }); if (fala) return await this.falar(fala); }
        catch (e) { await this.parar(); this.avisar(`IA indisponível: ${e.message}`); }                       // falha da IA: para e cai no plano B
      }
      const acao = interpretar(t, lang);
      if (!acao) return await this.falar(this.agente ? 'Não consegui pensar agora. Tente um comando simples.' : 'Não entendi. Sem a IA eu só conheço comandos simples, como senta, deita, anda, gira ou dança.');
      const res = await this.porNome[acao.tool].handler(acao.args);
      return await this.falar(/^(Feito|Andei|Parei)/.test(res) ? acao.fala : res);
    } finally { this.ocupado = false; }
  }
}
module.exports = { Cerebro };
