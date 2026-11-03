/* K9 i18n: motor de idiomas do painel (pt, en, es, fr, de, zh).
   O português é o idioma-fonte: cada texto em português é a chave do dicionário (window.K9Strings, linhas
   [pt, en, es, fr, de, zh]). Texto sem tradução cai no português, então nada some da tela.
   - K9I18n.t(chave, ...args)  traduz; "{0}", "{1}" são substituídos pelos args (que, se forem frases conhecidas, também são traduzidos).
   - Tradução automática do DOM: textos, title, aria-label, placeholder e alt são trocados sozinhos, inclusive o que o JS escreve
     depois (MutationObserver). Chaves com "{n}" funcionam como modelo (regex) para frases com número/nome.
   - Marque com data-no-i18n o que NÃO deve ser traduzido (nome do robô, log, nomes de idioma).
   Documentação: docs/INTERFACE-IDIOMAS.md */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root); else root.K9I18n = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const LANGS = Object.freeze([
    { code: 'pt', tag: 'pt-BR', name: 'Português' },
    { code: 'en', tag: 'en-US', name: 'English' },
    { code: 'es', tag: 'es-ES', name: 'Español' },
    { code: 'fr', tag: 'fr-FR', name: 'Français' },
    { code: 'de', tag: 'de-DE', name: 'Deutsch' },
    { code: 'zh', tag: 'zh-CN', name: '中文（普通话）' }
  ]);
  const CODES = LANGS.map((l) => l.code);
  const STORE = 'k9.lang';
  const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
  const SKIP_SEL = '[data-no-i18n], script, style, pre, textarea, code';

  let lang = 'pt';
  const exact = new Map();         // pt -> [pt, en, es, fr, de, zh]
  const models = [];               // chaves com {n}: { re, row, n }
  const listeners = new Set();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const squash = (s) => s.replace(/\s+/g, ' ').trim();

  function add(rows) {
    for (const row of rows) {
      const key = squash(row[0]);
      exact.set(key, row);
      if (/\{\d+\}/.test(key)) {
        const parts = key.split(/\{(\d+)\}/);                        // [lit, idx, lit, idx, ..., lit]
        const idx = []; let src = '^';
        for (let i = 0; i < parts.length; i++) {
          if (i % 2 === 0) src += esc(parts[i]); else { idx.push(Number(parts[i])); src += '([\\s\\S]*?)'; }
        }
        models.push({ re: new RegExp(src + '$'), row, idx, lit: parts.filter((_, i) => i % 2 === 0).join('').length });
      }
    }
    models.sort((a, b) => b.lit - a.lit);                            // o modelo mais específico primeiro
  }
  if (root && Array.isArray(root.K9Strings)) add(root.K9Strings);

  const col = (row) => (lang === 'pt' ? row[0] : (row[CODES.indexOf(lang)] || row[0]));
  const fill = (tpl, args) => tpl.replace(/\{(\d+)\}/g, (m, i) => (args[i] === undefined ? m : args[i]));

  // Traduz uma frase; devolve null se não conhecer (para o DOM não mexer).
  function lookup(text) {
    const key = squash(text);
    if (!key) return null;
    const row = exact.get(key);
    if (row) return col(row);
    for (const m of models) {
      const hit = m.re.exec(key);
      if (!hit) continue;
      const args = [];
      m.idx.forEach((n, k) => { const raw = hit[k + 1]; const sub = lookup(raw); args[n] = sub === null ? raw : sub; });
      return fill(col(m.row), args);
    }
    return null;
  }

  function t(key, ...args) {
    if (key == null) return '';
    const s = String(key);
    if (lang === 'pt' && !args.length) return s;
    const a = args.map((x) => { const r = typeof x === 'string' ? lookup(x) : null; return r === null ? x : r; });
    const base = lookup(s);
    return fill(base === null ? s : base, a);
  }

  // ---- DOM ---------------------------------------------------------------------------------------------------------------
  const textOrig = new WeakMap(), textShown = new WeakMap();           // nó de texto -> pt original / último valor escrito por nós
  const attrOrig = new WeakMap();                                       // elemento -> { attr: { o, s } }
  let applying = false, observer = null;

  const skipped = (el) => !!(el && el.closest && el.closest(SKIP_SEL));

  function doText(node) {
    if (skipped(node.parentElement)) return;
    const cur = node.data;
    let src = textOrig.has(node) && textShown.get(node) === cur ? textOrig.get(node) : cur;
    if (!/\S/.test(src)) return;
    const tr = lang === 'pt' ? null : lookup(src);
    const want = tr === null ? src : src.replace(squash(src), () => tr);   // preserva espaços nas pontas
    textOrig.set(node, src); textShown.set(node, want);
    if (node.data !== want) node.data = want;
  }

  function doAttrs(el) {
    if (skipped(el)) return;
    let rec = attrOrig.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a);
      const prev = rec && rec[a];
      const src = prev && prev.s === cur ? prev.o : cur;
      const tr = lang === 'pt' ? null : lookup(src);
      const want = tr === null ? src : tr;
      if (!rec) { rec = {}; attrOrig.set(el, rec); }
      rec[a] = { o: src, s: want };
      if (cur !== want) el.setAttribute(a, want);
    }
  }

  function walk(n) {
    if (n.nodeType === 3) { doText(n); return; }
    if (n.nodeType !== 1) return;
    if (skipped(n)) return;
    doAttrs(n);
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  }

  function run(fn) { applying = true; try { fn(); } finally { applying = false; if (observer) observer.takeRecords(); } }

  function translateAll() { if (typeof document === 'undefined') return; run(() => { walk(document.documentElement); }); }

  function startObserver() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver((list) => {
      if (applying) return;
      run(() => {
        for (const m of list) {
          if (m.type === 'characterData') doText(m.target);
          else if (m.type === 'attributes') doAttrs(m.target);
          else m.addedNodes.forEach((n) => walk(n));
        }
      });
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  // ---- idioma ------------------------------------------------------------------------------------------------------------
  function detect() {
    try { const s = localStorage.getItem(STORE); if (CODES.includes(s)) return s; } catch (e) { /* sem armazenamento */ }
    const prefs = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || [];
    for (const p of prefs) { const c = String(p || '').toLowerCase().slice(0, 2); if (CODES.includes(c)) return c; }
    return 'pt';
  }

  function setLang(code, save) {
    if (!CODES.includes(code)) code = 'pt';
    lang = code;
    if (save) { try { localStorage.setItem(STORE, code); } catch (e) { /* vale só nesta sessão */ } }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = tag();
      document.documentElement.dataset.lang = code;
      translateAll();
      document.dispatchEvent(new CustomEvent('k9:lang', { detail: { lang: code, tag: tag() } }));
    }
    listeners.forEach((fn) => { try { fn(code); } catch (e) { /* um ouvinte ruim não derruba os outros */ } });
    return lang;
  }

  const tag = () => LANGS.find((l) => l.code === lang).tag;
  const api = { LANGS, t, add, lookup, lang: () => lang, tag, setLang, detect, onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, translateAll };

  // Seletor de idioma: <select id="langSelect"> (preenchido aqui).
  function buildPicker() {
    const sel = document.getElementById('langSelect');
    if (!sel || sel.options.length) return;
    for (const l of LANGS) { const o = document.createElement('option'); o.value = l.code; o.textContent = l.name; o.lang = l.tag; sel.append(o); }
    sel.value = lang;
    sel.addEventListener('change', () => setLang(sel.value, true));
    api.onChange((c) => { sel.value = c; });
  }

  if (typeof document !== 'undefined') {
    lang = detect();
    document.documentElement.lang = tag();
    const boot = () => { buildPicker(); setLang(lang, false); startObserver(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
  return api;
});
