'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { nomeValido } = require('./public/voice-nlu.js');

const PADRAO = 'K9';
/* Nome do robô: um arquivo pequeno no hub (data/nome.json, fora do git). O painel, o Vivo e o celular leem dele. */
function criarNome(arquivo) {
  let nome = PADRAO;
  try { nome = nomeValido(JSON.parse(fs.readFileSync(arquivo, 'utf8')).nome) || PADRAO; } catch (e) { /* ainda não existe ou corrompido: usa o padrão */ }
  return {
    get: () => nome,
    set(novo) {
      const v = nomeValido(novo); if (!v) return null;
      fs.mkdirSync(path.dirname(arquivo), { recursive: true });
      fs.writeFileSync(arquivo, JSON.stringify({ nome: v }));
      nome = v; return v;
    }
  };
}
module.exports = { criarNome, PADRAO };
