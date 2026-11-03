    /* tema claro/escuro: guarda a escolha; sem escolha, segue o sistema */
    (function () {
      var root = document.documentElement, btn = document.getElementById('themeBtn');
      var metaTheme = document.querySelector('meta[name="theme-color"]'), metaScheme = document.querySelector('meta[name="color-scheme"]');
      function apply(t, save) {
        root.setAttribute('data-theme', t);
        btn.setAttribute('aria-pressed', String(t === 'dark'));
        btn.setAttribute('title', t === 'dark' ? 'Tema escuro (clique para o claro)' : 'Tema claro (clique para o escuro)');
        if (metaTheme) metaTheme.setAttribute('content', t === 'dark' ? '#151614' : '#e8e7e3');
        if (metaScheme) metaScheme.setAttribute('content', t === 'dark' ? 'dark light' : 'light dark');
        if (save) { try { localStorage.setItem('k9-theme', t); } catch (e) {} }
      }
      apply(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light', false);
      var opts = document.getElementById('driveOpts'); if (opts && window.matchMedia('(max-width: 599px), (orientation: landscape) and (max-height: 540px)').matches) opts.open = false;
      btn.addEventListener('click', function () { apply(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true); });
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var follow = function (e) { var saved = null; try { saved = localStorage.getItem('k9-theme'); } catch (x) {} if (!saved) apply(e.matches ? 'dark' : 'light', false); };
      if (mq.addEventListener) mq.addEventListener('change', follow);
    })();


/* ester egg: toque 7 vezes no ✦ do cabeçalho (ou abra o console) */
(function () {
  try { console.log('%c✦ K9-MK3 %c// feito com código + café + magia', 'font:700 14px monospace;color:#789353', 'font:12px monospace;color:#ef593f'); } catch (e) {}
  var mark = document.querySelector('.brand-mark'); if (!mark) return;
  var n = 0, timer = null;
  mark.addEventListener('click', function () {
    n++; clearTimeout(timer); timer = setTimeout(function () { n = 0; }, 1500);
    if (n >= 7) { n = 0; if (typeof K9Hub !== 'undefined' && K9Hub.toast) K9Hub.toast('✦ feito com código + café + magia', 'ok'); }
  });
})();
