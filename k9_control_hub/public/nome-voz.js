/* Nome do robô e comandos de voz no painel. O nome vem do hub (/api/nome) e vale para o painel, o Vivo e o celular.
   Voz: comandos simples ("Tobias, senta"), sem IA, pelo mesmo caminho dos botões (K9Hub.sendCmd / setSource). */
(() => {
  'use strict';
  const POSES = { sentar: ['sit', 'Sentar'], deitar: ['lie', 'Deitar'], em_pe: ['stand', 'Em pé'], pata_direita: ['wave', 'Pata direita'], pata_esquerda: ['waveleft', 'Pata esquerda'],
    dancar: ['dance', 'Dançar'], alongar: ['stretch', 'Alongar'], abanar_rabo: ['wag', 'Abanar o rabo'], cavar: ['dig', 'Cavar'] };
  const VEL_VOZ = 0.5;                         // andar por voz usa metade do limite de velocidade do painel
  const K_EXIGIR = 'k9.voz.exigirNome', K_IA = 'k9.voz.usarIA';
  const $ = (id) => document.getElementById(id);
  const t = (k, ...a) => (window.K9I18n ? window.K9I18n.t(k, ...a) : k.replace(/\{(\d+)\}/g, (m, i) => (a[i] === undefined ? m : a[i])));
  const lang = () => (window.K9I18n ? window.K9I18n.lang() : 'pt');
  const VL = () => window.K9VozL || K9Voz;   // idiomas além do português (i18n/voice-lexicon.js); sem ele, só português
  const langTag = () => (window.K9I18n ? window.K9I18n.tag() : 'pt-BR');
  const token = new URLSearchParams(location.search).get('token');
  const headers = { 'content-type': 'application/json', ...(token ? { 'x-hub-token': token } : {}) };
  let nome = 'K9', exigirNome = true, ouvindo = false, quer = false, rec = null, timerAndar = null;
  let usarIA = false;                                              // a IA (nuvem) só entra se você ligar aqui; desligada por padrão
  try { exigirNome = localStorage.getItem(K_EXIGIR) !== '0'; usarIA = localStorage.getItem(K_IA) === '1'; } catch (e) { /* sem armazenamento */ }

  function aplicarNome(n) {
    nome = n || 'K9';
    const h = document.querySelector('.brand h1'); if (h) h.textContent = nome;
    const s = document.querySelector('.brand small'); if (s) s.textContent = 'K9-MK3 · Painel de comando';
    document.title = t('{0} — Controle · Lizard Wizard', nome);
    const campo = $('nomeCampo'); if (campo && document.activeElement !== campo) campo.value = nome;
    status();
  }

  let vivo = null;                              // último estado do Vivo (só no app)
  function status() {
    const el = $('vozStatus'); if (!el) return;
    el.hidden = !quer;
    const ia = !window.K9App ? '' : !usarIA ? t('IA desligada (só comandos simples).') : (vivo && vivo.ia ? t('IA ligada: {0}.', vivo.modelo || t('nuvem')) : (vivo && vivo.offline ? t('IA: Vivo fora do ar (só comandos simples).') : t('IA ligada.')));
    el.textContent = quer ? (exigirNome ? t('Ouvindo. Diga: “{0}, senta”. “Para” sempre para.', nome) : t('Ouvindo. Diga um comando. “Para” sempre para.')) + (ia ? ' ' + ia : '') : '';
    const b = $('vozBtn'); if (b) { b.classList.toggle('on', quer); b.setAttribute('aria-pressed', String(quer)); $('vozLabel').textContent = t(quer ? 'Parar voz' : 'Voz'); }
  }

  let timerSentar = null;
  function pararAndar() { clearTimeout(timerSentar); timerSentar = null; if (timerAndar) { clearTimeout(timerAndar); timerAndar = null; K9Hub.setSource('voz', 0, 0); } }

  // Limite de andar por voz (o mesmo do Vivo: 10 s por minuto), para "anda anda anda" não virar passeio sem fim.
  const ANDAR_SEG_POR_MIN = 10; let andou = [];
  function orcamentoAndar(seg) {
    const t = Date.now(); andou = andou.filter(([q]) => t - q < 60000);
    const resta = ANDAR_SEG_POR_MIN - andou.reduce((x, [, y]) => x + y, 0);
    if (resta <= 0.4) return 0;
    const usar = Math.min(seg, resta); andou.push([t, usar]); return usar;
  }

  let ultimoUso = Date.now(), idleTimer = null;
  const IDLE_MIN = 10;                                           // sem comando por 10 min: a voz desliga sozinha
  function tocouUso() { ultimoUso = Date.now(); }

  function agir(a) {
    document.dispatchEvent(new CustomEvent('k9:manual'));          // (o modo NPC não escuta: a voz fica desligada enquanto ele roda)
    pararAndar(); tocouUso();
    if (a.acao === 'pose') { const p = POSES[a.pose]; if (p) K9Hub.sendCmd(p[0], p[1]); return; }
    if (a.acao === 'luz') { K9Hub.sendCmd(a.ligar ? 'flashon' : 'flashoff', a.ligar ? 'Lanterna ligada' : 'Lanterna desligada'); return; }   // a lanterna é da câmera; só o painel mexe nela
    // "vem aqui" (a.passos): a duração vem da marcha ativa (passos / frequência) e anda no limite de velocidade do painel inteiro, porque
    // precisa chegar; os outros pedidos de andar seguem com 3 s no máximo e metade do limite.
    const alvo = a.passos ? K9Voz.segundosParaPassos(a.passos, K9Hub.gaitParams && K9Hub.gaitParams[0]) : a.segundos;
    const seg = orcamentoAndar(Math.min(a.passos ? 9 : 3, alvo));
    if (!seg) { K9Hub.toast('Voz: já andei bastante no último minuto; espere um pouco.', 'info'); return; }
    const vel = a.passos ? 1 : VEL_VOZ;
    K9Hub.setSource('voz', a.frente * vel, a.giro * vel);
    timerAndar = setTimeout(() => {
      timerAndar = null; K9Hub.setSource('voz', 0, 0);
      if (a.depois === 'sentar') timerSentar = setTimeout(() => { timerSentar = null; K9Hub.sendCmd('sit', 'Sentar'); }, 700);   // chegou: senta (parar/outro comando antes cancela, pois pararAndar limpa o timer)
    }, seg * 1000);
  }

  let ultimoAviso = 0, atencaoAte = 0; const JANELA_NOME_MS = 7000;
  // Roteador único da voz: 1) parar  2) o nome (escuta contínua)  3) regras locais (grátis, instantâneas)  4) IA, só se nada servir.
  function tratar(texto, { continuo = true } = {}) {
    if (VL().isStopPhrase(texto, nome, lang())) { pararAndar(); K9Hub.stopAll(); K9Hub.toast('Voz: parar.', 'warn'); return; }   // parar nunca exige o nome nem passa pela IA
    const r = VL().removerNome(texto, nome, lang());
    if (r.citou && !r.resto.trim()) {                                                                                  // só o nome: o reconhecedor corta a frase; a próxima fala (até 7 s) vale sem repetir o nome
      atencaoAte = Date.now() + JANELA_NOME_MS; tocouUso(); K9Hub.toast(`${nome}: pode falar…`, 'info'); return;
    }
    if (!r.citou && Date.now() < atencaoAte) { r.citou = true; r.resto = texto; atencaoAte = 0; }                      // fala logo depois de ouvir o nome
    else if (r.citou) atencaoAte = 0;
    if (exigirNome && continuo && !r.citou) {                                                                          // ouviu outra conversa: ignora (com aviso raro, para não parecer surdo)
      if (Date.now() - ultimoAviso > 8000) { ultimoAviso = Date.now(); K9Hub.toast(`Voz: ouvi “${texto}”, mas só obedeço se disser “${nome}” antes.`, 'info'); }
      return;
    }
    const a = VL().interpretar(r.resto, lang());
    if (a) { agir(a); return; }
    tocouUso();
    if (window.K9App && K9App.perguntarIA && usarIA) { K9Hub.toast('Voz: não era um comando simples; perguntando à IA (a frase vai para a nuvem)…', 'info'); K9App.perguntarIA(texto); return; }
    K9Hub.toast(t('Voz: não entendi “{0}”.', texto) + (window.K9App && !usarIA ? ' ' + t('(A IA está desligada em Configurações → Nome e voz.)') : ''), 'info');
  }

  function iniciar() {                                           // só no navegador (no app a escuta é nativa)
    const RC = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!RC || !window.isSecureContext) {
      K9Hub.toast('No navegador a voz só funciona em localhost no Chrome (no PC: http://localhost:3080). No celular, use o app K9.', 'warn');
      quer = false; status(); return;
    }
    if (ouvindo) return;
    rec = new RC(); rec.lang = langTag(); rec.interimResults = false; rec.continuous = false; rec.maxAlternatives = 1;
    rec.onstart = () => { ouvindo = true; };
    rec.onresult = (e) => { const t = e.results[0][0].transcript.trim(); if (t) tratar(t); };
    rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { K9Hub.toast('Microfone bloqueado: permita nas configurações do site.', 'error'); quer = false; status(); } };
    rec.onend = () => { ouvindo = false; if (quer) setTimeout(iniciar, 250); };
    try { rec.start(); } catch (e) { /* já iniciado */ }
  }

  function ligar() {
    document.dispatchEvent(new CustomEvent('k9:manual'));          // a voz assume
    quer = true; tocouUso(); status();
    clearInterval(idleTimer); idleTimer = setInterval(() => { if (quer && Date.now() - ultimoUso > IDLE_MIN * 60000) { desligar(); K9Hub.toast(`Voz desligada: ${IDLE_MIN} min sem comandos.`, 'info'); } }, 15000);
    if (window.K9App) { if (usarIA) K9App.armarVivo(true); K9App.ouvir(true); } else iniciar();
  }
  function desligar() {
    quer = false; clearInterval(idleTimer); pararAndar(); status();
    if (window.K9App) { K9App.ouvir(false); K9App.armarVivo(false); } else if (rec) { try { rec.stop(); } catch (e) { /* ok */ } }
  }
  function alternar() { if (quer) desligar(); else ligar(); }

  // Entrada de voz de fora do navegador (o app Android escuta nativamente e entrega a frase aqui).
  window.K9VozEntrada = (texto, continuo) => { if (typeof texto === 'string' && texto.trim()) tratar(texto.trim().slice(0, 300), { continuo: continuo !== false }); };
  // O app avisa o estado real da escuta (para o botão nunca mentir), a resposta da IA e o estado do Vivo.
  window.K9VozEstado = (e) => {
    if (e === 'ouvindo') { quer = true; } else { quer = false; if (typeof e === 'string' && e.startsWith('erro')) K9Hub.toast('Voz: ' + e.replace(/^erro:?\s*/, ''), 'error'); else if (typeof e === 'string' && e.startsWith('parado:')) K9Hub.toast('Voz ' + e, 'info'); }
    status();
  };
  window.K9VozResposta = (texto) => { if (typeof texto === 'string' && texto) K9Hub.toast('IA: ' + texto.slice(0, 160), 'info'); };
  window.K9VozVivo = (json) => { try { vivo = JSON.parse(json); } catch (e) { return; } status(); };

  // você assumiu o controle: cancela o passeio por voz em curso; o PARAR do painel também para e desarma o Vivo
  const stopOrig = K9Hub.stopAll; K9Hub.stopAll = function (...a) { pararAndar(); if (window.K9App) K9App.pararVivo(); return stopOrig.apply(this, a); };
  document.addEventListener('pointerdown', (e) => { if (timerAndar && e.target.closest && e.target.closest('#joyZone, [data-dir]')) pararAndar(); }, true);
  document.addEventListener('keydown', (e) => { if (timerAndar && ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(String(e.key).toLowerCase())) pararAndar(); }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden && quer && !window.K9App) desligar(); });
  document.addEventListener('k9:npc', () => { if (quer) desligar(); });             // o NPC ligou: a voz desliga (o NPC não recebe comando de voz)

  async function salvarNome() {
    const v = $('nomeCampo').value; $('nomeMsg').textContent = '';
    try {
      const r = await fetch('/api/nome', { method: 'POST', headers, body: JSON.stringify({ nome: v }) });
      let d = {}; try { d = await r.json(); } catch (e) { /* resposta sem JSON (ex.: erro do servidor) */ }
      $('nomeMsg').textContent = r.ok ? `Pronto: agora ele se chama ${d.nome}.` : (d.error || `Não deu para salvar (erro ${r.status}).`);
      if (r.ok) aplicarNome(d.nome);
    } catch (e) { $('nomeMsg').textContent = 'Sem conexão com o hub.'; }
  }

  function construirConfig() {
    const dest = $('settingsContent'); if (!dest) return;
    const sec = document.createElement('section'); sec.className = 'nome-config';
    sec.innerHTML = `<h3>Nome e voz</h3>
      <label class="nome-linha">Nome do robô<input id="nomeCampo" type="text" maxlength="24" autocomplete="off" spellcheck="false"><button type="button" class="btn" id="nomeSalvar">Salvar</button></label>
      <p class="nome-msg" id="nomeMsg" role="status"></p>
      <label class="rand-check"><input type="checkbox" id="vozExigir"><span>Comandos por voz só valem se eu disser o nome (“Tobias, senta”)</span></label>
      <label class="rand-check"><input type="checkbox" id="vozIA"><span>Usar IA na nuvem quando nenhuma regra servir (a frase falada é enviada ao provedor da IA; só vale com a Voz ligada no app)</span></label>
      <p class="nome-msg">“Para”, “pare” e “chega” sempre param, com ou sem o nome. No app K9 a voz usa o microfone do celular e, se nenhuma regra servir, pergunta à IA. No navegador do PC, a voz só funciona em localhost (Chrome).</p>`;
    dest.prepend(sec);
    $('nomeCampo').value = nome; $('vozExigir').checked = exigirNome; $('vozIA').checked = usarIA;
    $('nomeSalvar').addEventListener('click', salvarNome);
    $('nomeCampo').addEventListener('keydown', (e) => { if (e.key === 'Enter') salvarNome(); });
    $('vozIA').addEventListener('change', () => {
      usarIA = $('vozIA').checked; try { localStorage.setItem(K_IA, usarIA ? '1' : '0'); } catch (e) { /* ok */ }
      if (window.K9App && quer) K9App.armarVivo(usarIA);                                      // ligar/desligar a IA com a voz já ligada arma/desarma o Vivo
      K9Hub.toast(usarIA ? 'IA ligada: frases que não são comandos simples vão para a nuvem.' : 'IA desligada: só comandos simples; nada sai do PC.', usarIA ? 'warn' : 'info'); status();
    });
    $('vozExigir').addEventListener('change', () => { exigirNome = $('vozExigir').checked; try { localStorage.setItem(K_EXIGIR, exigirNome ? '1' : '0'); } catch (e) { /* ok */ } status(); });
  }

  function init() {
    construirConfig();
    const avisarApp = () => { try { if (window.K9App && K9App.idioma) K9App.idioma(langTag()); } catch (e) { /* app antigo sem a ponte de idioma */ } };
    avisarApp();
    document.addEventListener('k9:lang', () => { avisarApp(); status(); aplicarNome(nome); if (rec && ouvindo) { try { rec.stop(); } catch (e) { /* reinicia sozinho com o idioma novo */ } } });
    if ($('vozBtn')) $('vozBtn').addEventListener('click', alternar);
    if (window.K9App && $('stopBtn')) { $('stopBtn').setAttribute('aria-label', 'Parar movimento'); $('stopBtn').title = 'Parar'; }   // no app não há tecla Espaço
    K9Hub.socket.on('k9:nome', (d) => aplicarNome(d && d.nome));
    fetch('/api/nome', { headers }).then((r) => r.json()).then((d) => d.ok && aplicarNome(d.nome)).catch(() => {});
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init); else init();
})();
