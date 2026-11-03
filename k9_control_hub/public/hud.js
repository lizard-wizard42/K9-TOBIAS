/* HUD da câmera: espelha, a 4 Hz, o que o painel já calcula (ping, Wi-Fi, comando de andar).
   Só lê o DOM; não envia nada ao robô. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  function set(el, txt, q) { if (el.textContent !== txt) el.textContent = txt; if (q !== undefined) el.setAttribute('data-q', q || ''); }
  function bar(el, v) { v = Math.max(-1, Math.min(1, v || 0)); el.style.left = (v >= 0 ? 50 : 50 + v * 50) + '%'; el.style.width = Math.abs(v) * 50 + '%'; }
  function tick() {
    var pill = $('connPill'); if (!pill) return;
    var st = pill.getAttribute('data-state') || 'wait';
    $('hudLink').setAttribute('data-state', st);
    var T = function (k) { return window.K9I18n ? window.K9I18n.t(k) : k; };
    set($('hudLinkTxt'), T(st === 'online' ? 'ROBÔ' : st === 'off' ? 'SEM ROBÔ' : 'HUB…'));
    var p = $('pingVal'), ping = $('pingPill'), r = $('rssiVal'), rp = $('rssiPill');
    var pv = p ? p.textContent.trim() : '-', rv = r ? r.textContent.trim() : '-';
    set($('hudPing'), pv === '-' ? '— ms' : pv, ping ? ping.getAttribute('data-q') : '');
    set($('hudRssi'), rv === '-' ? '— dBm' : rv, rp ? rp.getAttribute('data-q') : '');
    var m = /F\s*([+-]?\d*\.?\d+)\s*\|\s*T\s*([+-]?\d*\.?\d+)/.exec(($('hudDrive') || {}).textContent || '');
    var f = m ? parseFloat(m[1]) : 0, t = m ? parseFloat(m[2]) : 0;
    bar($('hudBarF'), f); bar($('hudBarT'), t);
    set($('hudFT'), 'F ' + (f >= 0 ? '+' : '') + f.toFixed(2) + ' T ' + (t >= 0 ? '+' : '') + t.toFixed(2));
  }
  tick(); setInterval(tick, 250);
})();
