'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Bm25 } = require('./bm25');

const MAX_TEXTO = 400;
// A memória nunca guarda segredos: recusa o que parece senha, chave ou token.
const SEGREDO = /(senha|password|passwd|token|api[_ -]?key|sk-[a-z0-9]|secret|chave\s+(da|de)\s+(api|ia))/i;

class Memoria {
  constructor(arquivo, now = Date.now) {
    this.arquivo = arquivo; this.now = now; this.itens = [];
    try {
      for (const l of fs.readFileSync(arquivo, 'utf8').split('\n')) {
        if (!l.trim()) continue;
        try { const o = JSON.parse(l); if (o && typeof o.texto === 'string') this.itens.push(o); } catch (e) { /* linha corrompida: ignora */ }
      }
    } catch (e) { /* arquivo ainda não existe */ }
  }
  salvar(texto, tipo = 'fato') {
    const t = String(texto || '').trim().replace(/\s+/g, ' ');
    if (t.length < 3) return { ok: false, motivo: 'texto vazio' };
    if (SEGREDO.test(t)) return { ok: false, motivo: 'parece segredo (senha, chave ou token); não guardo isso' };
    if (this.itens.some((i) => i.texto.toLowerCase() === t.toLowerCase())) return { ok: true, repetido: true };
    const item = { id: this.itens.length + 1, quando: new Date(this.now()).toISOString(), tipo: String(tipo).slice(0, 20), texto: t.slice(0, MAX_TEXTO) };
    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    fs.appendFileSync(this.arquivo, JSON.stringify(item) + '\n');
    this.itens.push(item);
    return { ok: true, item };
  }
  buscar(consulta, k = 4) {
    const idx = new Bm25(); this.itens.forEach((i) => idx.add({ id: i.id, titulo: i.tipo, texto: i.texto, item: i }));
    const agora = this.now();
    return idx.search(consulta, k * 2).map(({ doc, score }) => {
      const dias = Math.max(0, (agora - Date.parse(doc.item.quando)) / 86400000);
      return { item: doc.item, score: score * (1 + 0.3 / (1 + dias)) };            // lembranças recentes pesam um pouco mais
    }).sort((a, b) => b.score - a.score).slice(0, k).map((r) => r.item);
  }
  recentes(n = 5) { return this.itens.slice(-n); }
}
module.exports = { Memoria };
