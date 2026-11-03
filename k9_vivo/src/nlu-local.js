'use strict';
/* Interpretador local (plano B sem chave de IA). As regras vivem em k9_control_hub/public/voice-nlu.js,
   compartilhadas com o painel; aqui só se traduz a ação neutra para as ferramentas do Vivo. */
const { interpretar: ler } = require('../../k9_control_hub/public/voice-nlu.js');
const lexicon = require('../../k9_control_hub/public/i18n/voice-lexicon.js');   // en, es, fr, de, zh

function interpretar(texto, lang = 'pt') {
  const a = lang === 'pt' ? ler(texto) : lexicon.interpretar(texto, lang);
  if (!a) return null;
  if (a.acao === 'luz') return null;                       // o Vivo não mexe na lanterna (fora da lista de segurança)
  if (a.acao === 'pose') return { tool: 'robo_pose', args: { pose: a.pose }, fala: a.fala };
  return { tool: 'robo_andar', args: { frente: a.frente, giro: a.giro, segundos: a.segundos }, fala: a.fala };
}
module.exports = { interpretar };
