'use strict';
/* Lê a chave de IA do ambiente ou de um arquivo local fora do git (secret.md na raiz do repositório).
   Nunca imprime nem devolve a chave em mensagens de erro. */
const fs = require('node:fs');
const path = require('node:path');

const PADRAO_OPENAI = /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/;

function chaveOpenAI(env = process.env, repo = path.join(__dirname, '..', '..')) {
  if (env.OPENAI_API_KEY && PADRAO_OPENAI.test(env.OPENAI_API_KEY)) return env.OPENAI_API_KEY.trim();
  for (const nome of ['secret.md', 'secrets.md']) {
    try { const m = fs.readFileSync(path.join(repo, nome), 'utf8').match(PADRAO_OPENAI); if (m) return m[0]; } catch (e) { /* arquivo não existe */ }
  }
  return null;
}
module.exports = { chaveOpenAI };
