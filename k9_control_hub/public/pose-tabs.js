/* Abas do painel de poses (Poses / Ações / Animações). A aba escolhida fica lembrada neste navegador.
   Padrão de abas do WAI-ARIA: setas esquerda/direita, Home e End trocam de aba. */
(() => {
  'use strict';
  const KEY = 'k9.poseTab';
  const abas = [...document.querySelectorAll('.pose-tab')];
  if (!abas.length) return;
  const mostrar = (aba, foco) => {
    for (const a of abas) {
      const on = a === aba;
      a.setAttribute('aria-selected', String(on)); a.tabIndex = on ? 0 : -1;
      const g = document.getElementById(a.dataset.grid); if (g) g.hidden = !on;
    }
    try { localStorage.setItem(KEY, aba.id); } catch (e) { /* sem armazenamento: vale só nesta sessão */ }
    if (foco) aba.focus();
  };
  abas.forEach((a, i) => {
    a.addEventListener('click', () => mostrar(a));
    a.addEventListener('keydown', (e) => {
      const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: abas.length - 1 }[e.key];
      if (k === undefined) return;
      e.preventDefault(); mostrar(abas[(k + abas.length) % abas.length], true);
    });
  });
  let ultima = null;
  try { ultima = localStorage.getItem(KEY); } catch (e) { /* usa a primeira aba */ }
  mostrar(abas.find((a) => a.id === ultima) || abas[0]);
})();
