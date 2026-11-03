'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Bm25 } = require('./bm25');

const MAX = 700;
// Documentos que o Vivo conhece (somente leitura). Segredos nunca entram: secrets.h não está na lista.
const FONTES = ['k9_vivo/knowledge', 'docs', 'README.md', 'MK3/README.md', 'MK4/README.md'];

function pedacos(markdown, fonte) {
  const out = []; let titulo = path.basename(fonte, '.md');
  const blocos = markdown.split(/^(#{1,3} .*)$/m);                 // alterna: texto, título, texto, título...
  const emitir = (texto) => {
    const ps = texto.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean); let atual = '';
    for (const p of ps) { if (atual && (atual + '\n' + p).length > MAX) { out.push({ titulo, texto: atual, fonte }); atual = ''; } atual = atual ? atual + '\n' + p : p; }
    if (atual) out.push({ titulo, texto: atual, fonte });
  };
  for (const b of blocos) { if (/^#{1,3} /.test(b)) titulo = b.replace(/^#+ /, '').trim(); else emitir(b); }
  return out;
}

function arquivos(repo, fontes) {
  const lista = [];
  for (const f of fontes) {
    const abs = path.join(repo, f);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) for (const n of fs.readdirSync(abs).sort()) { if (n.endsWith('.md')) lista.push(path.join(f, n)); }
    else lista.push(f);
  }
  return lista;
}

function carregarConhecimento(repo, fontes = FONTES) {
  const idx = new Bm25(); let n = 0;
  for (const f of arquivos(repo, fontes)) {
    let md; try { md = fs.readFileSync(path.join(repo, f), 'utf8'); } catch (e) { continue; }
    for (const p of pedacos(md, f)) { idx.add({ id: `${f}#${n++}`, ...p }); }
  }
  return idx;
}
module.exports = { carregarConhecimento, pedacos, FONTES };
