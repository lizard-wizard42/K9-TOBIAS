'use strict';
const { tokens } = require('./tokenize');

/* Índice BM25 em memória (k1=1.5, b=0.75). Sem dependências nativas: o conjunto do K9 é pequeno. */
class Bm25 {
  constructor() { this.docs = []; this.df = new Map(); this.total = 0; }
  add(doc) {
    const tk = tokens(doc.texto + ' ' + (doc.titulo || '') + ' ' + (doc.titulo || ''));      // o título pesa em dobro
    const tf = new Map(); for (const w of tk) tf.set(w, (tf.get(w) || 0) + 1);
    for (const w of tf.keys()) this.df.set(w, (this.df.get(w) || 0) + 1);
    this.docs.push({ ...doc, tf, len: tk.length || 1 }); this.total += tk.length || 1;
  }
  search(consulta, k = 4) {
    const q = [...new Set(tokens(consulta))]; if (!q.length || !this.docs.length) return [];
    const N = this.docs.length, avg = this.total / N;
    const out = [];
    for (const d of this.docs) {
      let s = 0;
      for (const w of q) {
        const f = d.tf.get(w); if (!f) continue;
        const n = this.df.get(w) || 0, idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        s += idf * (f * 2.5) / (f + 1.5 * (1 - 0.75 + 0.75 * d.len / avg));
      }
      if (s > 0) out.push({ doc: d, score: s });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, k);
  }
}
module.exports = { Bm25 };
