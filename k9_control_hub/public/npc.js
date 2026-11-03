/* Modo NPC do K9: o robô fica no lugar vivendo como um cachorro de verdade (senta, levanta, deita, dorme, olha para os lados,
   gira, se espreguiça) sem receber comando de voz. Substitui o antigo modo aleatório.
   A "inteligência" é um pequeno motor de comportamento: três necessidades (energia, sono, curiosidade) que mudam com o tempo e
   com o que o robô faz, e uma máquina de posturas (em pé / sentado / deitado) que só deixa fazer o que é possível dali.
   Cada decisão é um sorteio com pesos calculados pelo estado, com memória das últimas ações para não ficar repetitivo.
   Roda no navegador e reaproveita K9Hub (sendCmd / setSource): herda a validação do hub, o limite de velocidade do painel e o
   watchdog de 400 ms. Qualquer toque seu (joystick, D-pad, tecla, pose, Parar) desliga. */
(() => {
  'use strict';
  const KEY = 'k9.npc.v1';
  const ESQUERDA = -1, DIREITA = 1;                                   // sinal do giro no hub (igual ao teclado A / D)

  // ---- motor de comportamento (funções puras: o teste roda em Node) ------------------------------------------------------
  const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const entre = (rnd, a, b) => a + rnd() * (b - a);

  const PADRAO = Object.freeze({
    ritmo: 'normal',        // calmo | normal | agitado: escala todas as pausas
    girar: true,            // girar para um lado e para o outro
    olhar: true,            // olhar ao redor (esquerda, direita)
    gestos: true,           // abanar o rabo, pata, alongar, cavar, dançar
    dormir: true,           // deitar e dormir um tempo, acordando com um alongamento
    passeios: false,        // passinhos para a frente: desligado, o robô fica no lugar
    velocidade: 80,         // % do limite de velocidade do painel ao girar
    limiteMin: 30           // desliga sozinho; 0 = sem limite
  });
  const RITMOS = { calmo: 1.5, normal: 1, agitado: 0.6 };

  function normalizar(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const bool = (k) => (r[k] === undefined ? PADRAO[k] : !!r[k]);
    return {
      ritmo: RITMOS[r.ritmo] ? r.ritmo : PADRAO.ritmo,
      girar: bool('girar'), olhar: bool('olhar'), gestos: bool('gestos'), dormir: bool('dormir'), passeios: bool('passeios'),
      velocidade: Math.round(clamp(r.velocidade, 20, 100, PADRAO.velocidade)),
      limiteMin: Math.round(clamp(r.limiteMin, 0, 240, PADRAO.limiteMin))
    };
  }

  // Passos: { k:'pose', cmd, label, ms } manda um comando ao hub; { k:'walk', f, g, ms } move (f frente, g giro); { k:'wait', ms }.
  const pose = (cmd, label, ms) => ({ k: 'pose', cmd, label, ms });
  const gira = (lado, v, ms) => ({ k: 'walk', f: 0, g: lado * v, ms: Math.round(ms) });
  const espera = (ms) => ({ k: 'wait', ms: Math.round(ms) });

  // peso(e, ctx): e = estado { energia, sono, tedio, ... }, ctx = { n: segundos na postura atual }. de/para = posturas.
  const ACOES = {
    dormir_idle: { label:'Dormir', de:['stand'], para:'lie', grupo:'base', cmds:['sleep'], peso:()=>0,
      passos:()=>[pose('sleep','Dormir',15000)] },
    acomodar: { label:'Acomodar', de:['stand'], para:'stand', grupo:'base', cmds:['wiggle'], peso:()=>0,
      passos:()=>[pose('wiggle','Acomodar',6000)] },
    curioso_idle: { label:'Curioso', de:['stand'], para:'stand', grupo:'base', cmds:['emotion_curious'], peso:()=>0,
      passos:()=>[pose('emotion_curious','Curioso',6500)] },
    acordar_idle: { label:'Acordar', de:['stand'], para:'stand', grupo:'base', cmds:['wake'], peso:()=>0,
      passos:()=>[pose('wake','Acordar',8500)] },
    sentar:   { label: 'Sentar',               de: ['stand'],        para: 'sit',   grupo: 'base',   cmds: ['sit'],
                peso: (e) => 0.6 + 1.5 * (1 - e.energia) + 1.0 * e.sono,
                passos: () => [pose('sit', 'Sentar', 1800)] },
    levantar: { label: 'Ficar em pé',          de: ['sit', 'lie'],   para: 'stand', grupo: 'base',   cmds: ['stand'],
                peso: (e, c) => 0.3 + 0.1 * c.n + 1.5 * e.energia * e.tedio + (e.sono < 0.35 ? 1.2 : 0),
                passos: () => [pose('stand', 'Ficar em pé', 2200)] },
    deitar:   { label: 'Deitar',               de: ['stand'],        para: 'lie',   grupo: 'base',   cmds: ['lie'],
                peso: (e) => 0.12 + 2.4 * e.sono * (1.2 - e.energia),
                passos: () => [pose('lie', 'Deitar', 2500)] },
    dormir:   { label: 'Dormir',               de: ['lie'],          para: 'lie',   grupo: 'dormir', cmds: ['sleep'],
                peso: (e) => (e.sono > 0.4 ? 1.5 + 6 * (e.sono - 0.4) : 0.05),
                passos: (rnd) => [pose('sleep', 'Dormir', entre(rnd, 30000, 80000))] },
    girar_esq: { label: 'Girar para a esquerda', de: ['stand'],       para: 'stand', grupo: 'girar',  cmds: [], lado: ESQUERDA,
                peso: (e) => 0.5 + 1.2 * e.tedio,
                passos: (rnd, cfg) => [gira(ESQUERDA, cfg.velocidade / 100, entre(rnd, 1000, 2000)), espera(entre(rnd, 500, 1000))] },
    girar_dir: { label: 'Girar para a direita', de: ['stand'],       para: 'stand', grupo: 'girar',  cmds: [], lado: DIREITA,
                peso: (e) => 0.5 + 1.2 * e.tedio,
                passos: (rnd, cfg) => [gira(DIREITA, cfg.velocidade / 100, entre(rnd, 1000, 2000)), espera(entre(rnd, 500, 1000))] },
    olhar:    { label: 'Olhar ao redor',       de: ['stand'],        para: 'stand', grupo: 'olhar',  cmds: [],
                peso: (e) => 0.7 + 2.2 * e.tedio,
                passos: (rnd, cfg) => {
                  const v = cfg.velocidade / 100, primeiro = rnd() < 0.5 ? ESQUERDA : DIREITA;
                  const lista = [gira(primeiro, v, entre(rnd, 800, 1300)), espera(entre(rnd, 700, 1500)),
                                 gira(-primeiro, v, entre(rnd, 1700, 2600)), espera(entre(rnd, 600, 1200))];
                  if (rnd() < 0.5) lista.push(gira(primeiro, v, entre(rnd, 800, 1300)), espera(entre(rnd, 400, 900)));
                  return lista;
                } },
    passeio:  { label: 'Passinhos',            de: ['stand'],        para: 'stand', grupo: 'passeio', cmds: [],
                peso: (e) => 0.4 + 1.2 * e.tedio,
                passos: (rnd, cfg) => [{ k: 'walk', f: cfg.velocidade / 100, g: 0, ms: Math.round(entre(rnd, 900, 1600)) }, espera(entre(rnd, 700, 1400))] },
    abanar:   { label: 'Abanar o rabo',        de: ['stand'],        para: 'stand', grupo: 'gestos', cmds: ['wag'],
                peso: (e) => 0.3 + 1.3 * e.energia,
                passos: () => [pose('wag', 'Abanar o rabo', 4500)] },
    pata:     { label: 'Dar a pata',           de: ['stand'],        para: 'stand', grupo: 'gestos', cmds: ['wave', 'waveleft'],
                peso: (e) => 0.12 + 0.5 * e.energia,
                passos: (rnd, cfg) => (cfg.pataEsquerda && rnd() < 0.5 ? [pose('waveleft', 'Pata esquerda', 5000)] : [pose('wave', 'Pata direita', 5000)]) },
    alongar:  { label: 'Alongar',              de: ['stand'],        para: 'stand', grupo: 'gestos', cmds: ['wake'],
                peso: (e, c) => 0.2 + 0.8 * e.sono + (c.acordou ? 9 : 0),
                passos: () => [pose('wake', 'Acordar', 8500)] },
    cocar:    { label: 'Coçar a barriga',     de: ['stand', 'sit'], para: 'stand', grupo: 'gestos', cmds: ['scratch'],
                peso: (e) => 0.1 + 0.6 * e.tedio * (1.1 - e.sono),
                passos: () => [pose('scratch', 'Coçar a barriga', 15000)] },
    cavar:    { label: 'Cavar',                de: ['stand'],        para: 'stand', grupo: 'gestos', cmds: ['dig'],
                peso: (e) => 0.08 + 1.0 * e.tedio * e.energia,
                passos: () => [pose('dig', 'Cavar', 5500)] },
    dancar:   { label: 'Dançar',               de: ['stand'],        para: 'stand', grupo: 'gestos', cmds: ['dance'],
                peso: (e) => 0.03 + 1.2 * e.energia * e.energia,
                passos: () => [pose('dance', 'Dançar', 7000)] }
  };

  // Efeito de cada ação nas necessidades (somado uma vez, quando ela termina).
  const EFEITO = {
    girar_esq: { tedio: -0.25 }, girar_dir: { tedio: -0.25 }, olhar: { tedio: -0.3 }, passeio: { tedio: -0.4, energia: -0.05 },
    abanar: { tedio: -0.05 }, pata: { tedio: -0.1 }, alongar: { sono: -0.12, tedio: -0.1 }, cavar: { tedio: -0.3, energia: -0.06 },
    dancar: { tedio: -0.3, energia: -0.12 }, cocar: { tedio: -0.25, energia: -0.03 }
  };
  // Variação por segundo em cada postura (dormir, dentro de deitado, recupera mais rápido).
  const POR_SEGUNDO = {
    stand: { energia: -0.0015, sono: 0.0035, tedio: 0.010 },
    sit:   { energia: 0.0040,  sono: 0.0015, tedio: 0.006 },
    lie:   { energia: 0.0100,  sono: -0.0040, tedio: 0.002 },
    dormindo: { energia: 0.0200, sono: -0.0200, tedio: 0.001 }
  };

  function criarEstado() {
    return { postura: 'stand', energia: 0.7, sono: 0.15, tedio: 0.3, segNaPostura: 0, dormindo: false, acordou: false, ultimas: [], ultimoGiro: 0 };
  }

  function humor(e) {
    if (e.dormindo) return 'dormindo';
    if (e.sono > 0.7) return 'sonolento';
    if (e.energia < 0.3) return 'cansado';
    if (e.energia > 0.75) return 'animado';
    return 'tranquilo';
  }

  // Quais ações o usuário deixou ligadas (as de base nunca se desligam).
  function permitida(a, cfg) {
    const g = a.grupo;
    return g === 'base' || (g === 'dormir' && cfg.dormir) || (g === 'girar' && cfg.girar) || (g === 'olhar' && cfg.olhar)
      || (g === 'gestos' && cfg.gestos) || (g === 'passeio' && cfg.passeios);
  }

  // Escolhe a próxima ação: só as possíveis na postura atual, com peso do estado, penalizando o que acabou de ser feito.
  function escolher(e, cfg, rnd = Math.random, disponivel = () => true) {
    const ctx = { n: e.segNaPostura, acordou: e.acordou };
    if (e.acordou && permitida(ACOES.alongar, cfg) && disponivel(ACOES.alongar)) return 'alongar';   // acabou de acordar: se espreguiça sempre
    const itens = [];
    for (const [id, a] of Object.entries(ACOES)) {
      if (!a.de.includes(e.postura) || !permitida(a, cfg) || !disponivel(a)) continue;
      if (id === 'dormir' && e.dormindo) continue;
      let w = Math.max(0.01, a.peso(e, ctx));
      const pos = e.ultimas.indexOf(id);                               // 0 = a mais recente
      if (pos > 0) w *= 0.6;                                          // fez há pouco: menos provável
      if (a.lado && e.ultimoGiro === a.lado) w *= 0.5;                 // gira para um lado e depois para o outro
      itens.push([id, w]);
    }
    if (!itens.length) return null;
    const outras = itens.filter(([id]) => id !== e.ultimas[0]);                   // nunca a mesma ação duas vezes seguidas, se houver outra
    if (outras.length) itens.splice(0, itens.length, ...outras);
    let x = rnd() * itens.reduce((s, [, w]) => s + w, 0);
    for (const [id, w] of itens) { x -= w; if (x < 0) return id; }
    return itens[itens.length - 1][0];
  }

  // Aplica o resultado de uma ação ao estado e devolve o novo estado (sem mudar o antigo).
  function aplicar(e, id, segundos) {
    const a = ACOES[id], n = { ...e, ultimas: [id, ...e.ultimas.filter((x) => x !== id)].slice(0, 4) };
    const dormindo = id === 'dormir';
    const taxa = POR_SEGUNDO[dormindo ? 'dormindo' : e.postura];
    const ef = EFEITO[id] || {};
    for (const k of ['energia', 'sono', 'tedio']) n[k] = clamp(e[k] + taxa[k] * segundos + (ef[k] || 0), 0, 1, e[k]);
    n.segNaPostura = a.para === e.postura ? e.segNaPostura + segundos : 0;
    n.postura = a.para;
    if (id === 'dormir') n.dormindo = true;                                      // dorme até se levantar
    else if (id === 'levantar') { n.dormindo = false; n.acordou = e.dormindo; }   // acordou? então o próximo gesto é se espreguiçar
    else if (id === 'alongar') n.acordou = false;
    if (a.lado) n.ultimoGiro = a.lado;
    if (id === 'olhar') n.ultimoGiro = 0;
    return n;
  }

  // Pausa (ms) depois de uma ação: em pé é curta, sentado e deitado ficam mais tempo; o ritmo escala tudo.
  function pausa(e, cfg, rnd = Math.random) {
    const base = e.dormindo ? [2000, 4000] : e.postura === 'lie' ? [12000, 30000] : e.postura === 'sit' ? [7000, 18000] : [3000, 9000];
    return Math.round(entre(rnd, base[0], base[1]) * RITMOS[cfg.ritmo]);
  }

  function duracao(passos) { return passos.reduce((s, p) => s + p.ms, 0); }

  globalThis.K9NPC = { PADRAO, ACOES, EFEITO, normalizar, criarEstado, humor, permitida, escolher, aplicar, pausa, duracao };
  if (typeof document === 'undefined' || typeof K9Hub === 'undefined') return;   // testes em Node só usam o motor acima

  // ---- execução no painel ------------------------------------------------------------------------------------------------
  let cfg = normalizar(null);
  try { cfg = normalizar(JSON.parse(localStorage.getItem(KEY))); } catch (e) { /* sem armazenamento: usa o padrão */ }
  let ligado = false, testando = false, andando = false, inicio = 0, proximaEm = 0, atual = '', estado = criarEstado();
  let timer = null, ticker = null;
  const $ = (id) => document.getElementById(id);
  const t = (k, ...a) => (window.K9I18n ? window.K9I18n.t(k, ...a) : k.replace(/\{(\d+)\}/g, (m, i) => (a[i] === undefined ? m : a[i])));
  // frase dentro da linha de status: minúscula nos idiomas que usam (em alemão os substantivos ficam com inicial maiúscula)
  const minus = (k) => { const r = t(k), c = window.K9I18n ? window.K9I18n.lang() : 'pt'; return c === 'de' || c === 'zh' ? r : r.toLocaleLowerCase(); };
  const salvar = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* ignora */ } };
  const esperar = (ms, fn) => { clearTimeout(timer); timer = setTimeout(fn, ms); };
  const POSTURA = { stand: 'em pé', sit: 'sentado', lie: 'deitado' };
  const cfgComFirmware = () => ({ ...cfg, pataEsquerda: K9Hub.controlsVersion >= 2 });   // pata esquerda só com firmware novo

  function render() {
    const btn = $('npcBtn'); if (!btn) return;
    btn.classList.toggle('on', ligado);
    btn.setAttribute('aria-pressed', String(ligado));
    $('npcLabel').textContent = ligado ? 'Parar NPC' : 'NPC';
    let txt = '';
    if (ligado) {
      const falta = Math.max(0, Math.ceil((proximaEm - Date.now()) / 1000));
      const onde = estado.dormindo ? 'dormindo' : POSTURA[estado.postura];
      txt = atual ? t('{0} · agora: {1}', t(humor(estado)), minus(atual)) : t('{0} · {1}, próxima ação em {2} s', t(humor(estado)), t(onde), falta);
    }
    for (const id of ['npcStatus', 'npcDlgStatus']) { const el = $(id); if (el) { el.textContent = txt || 'Desligado'; if (id === 'npcStatus') el.hidden = !ligado; } }
    const dlgBtn = $('npcDlgToggle'); if (dlgBtn) dlgBtn.textContent = ligado ? 'Parar NPC' : 'Ligar NPC';
    const voz = $('vozBtn'); if (voz) { voz.disabled = ligado; voz.title = ligado ? 'O modo NPC não recebe comandos de voz' : ''; }
  }

  function parar(motivo) {
    const estava = ligado || testando;
    if (estava && K9Hub.socket?.connected) {
      K9Hub.socket.emit('k9:cmd', {cmd:'stop'});
      K9Hub.socket.emit('k9:cmd', {cmd:'sound_stop'});
    }
    clearTimeout(timer); clearInterval(ticker); timer = ticker = null;
    if (andando) { K9Hub.setSource('npc', 0, 0); andando = false; }
    ligado = false; testando = false; atual = ''; proximaEm = 0;
    render();
    document.dispatchEvent(new CustomEvent('k9:npc-state', {detail:false}));
    if (estava && motivo) K9Hub.toast(motivo, 'info');
  }

  function problema() {
    if (!K9Hub.socket || !K9Hub.socket.connected) return 'Hub desconectado: NPC desligado.';
    if (!K9Hub.link.robot) return 'Robô offline: NPC desligado.';
    if (cfg.limiteMin > 0 && Date.now() - inicio > cfg.limiteMin * 60000) return `NPC desligado (limite de ${cfg.limiteMin} min).`;
    return '';
  }

  // Executa os passos em sequência; fim() é chamado quando acabam (ou quando o modo é interrompido).
  function rodar(passos, fim, i = 0) {
    if (i > 0 && andando) { K9Hub.setSource('npc', 0, 0); andando = false; }
    if (i >= passos.length) { fim(); return; }
    const p = passos[i];
    if (p.k === 'pose') K9Hub.sendCmd(p.cmd, p.label, 'npc');
    else if (p.k === 'walk') { K9Hub.setSource('npc', p.f, p.g); andando = true; }
    esperar(p.ms, () => { if (ligado || testando) rodar(passos, fim, i + 1); });
  }

  function executar(id, depois) {
    const a = ACOES[id];
    const passos = a.passos(Math.random, cfgComFirmware());
    atual = a.label; render();
    rodar(passos, () => { atual = ''; depois(passos); });
  }

  let idleProfile = false;
  function proximo() {
    if (!ligado) return;
    const p = problema(); if (p) { parar(p); return; }
    const id = idleProfile
      ? (estado.postura === 'lie' ? 'levantar' : ['acomodar','curioso_idle','acordar_idle','dormir_idle'][Math.floor(Math.random()*4)])
      : escolher(estado, cfg, Math.random);
    if (!id) { parar('NPC sem ações possíveis: desligado.'); return; }
    executar(id, (passos) => {
      if (!ligado) return;
      const seg = duracao(passos) / 1000;
      estado = aplicar(estado, id, seg);
      const espera = idleProfile ? 12000 + Math.random()*12000 : pausa(estado, cfg);
      proximaEm = Date.now() + espera; render();
      esperar(espera, proximo);
    });
  }

  function ligar() {
    if (!K9Hub.link.robot) { K9Hub.toast('Robô offline.', 'warn'); return; }
    if (!K9Hub.socket || !K9Hub.socket.connected) { K9Hub.toast('Hub desconectado: NPC não ligou.', 'error'); return; }
    document.dispatchEvent(new CustomEvent('k9:npc'));                                  // a voz desliga: o NPC não recebe comandos de voz
    estado = criarEstado();
    document.dispatchEvent(new CustomEvent('k9:npc-state', {detail:true}));
    ligado = true; inicio = Date.now(); proximaEm = Date.now() + 1500; render();
    clearInterval(ticker); ticker = setInterval(render, 500);
    K9Hub.sendCmd('stand', 'Em pé', 'npc');                                                    // começa em pé, para o estado do motor bater com o robô
    esperar(2500, proximo);
  }

  Object.assign(globalThis.K9NPC, {
    isActive:()=>ligado || testando,
    stop:()=>parar(''),
    startIdle:()=>{ parar(''); idleProfile=true; ligar(); }
  });
  document.addEventListener('k9:manual-command', () => parar(''));
  function testarUma() {
    if (ligado || testando) return;
    if (!K9Hub.socket || !K9Hub.socket.connected) { K9Hub.toast('Hub desconectado: teste não enviado.', 'error'); return; }
    const id = escolher(estado, cfg, Math.random); if (!id) return;
    testando = true; executar(id, () => { testando = false; render(); });
  }

  // ---- você assumiu o controle: desliga -----------------------------------------------------------------------------------
  const wrap = (nome) => {
    const orig = K9Hub[nome]; if (typeof orig !== 'function') return;
    K9Hub[nome] = function (...args) { parar('Parada acionada: NPC desligado.'); return orig.apply(this, args); };
  };
  wrap('stopAll'); wrap('emergencyStop');
  const dentro = (e) => e.target && e.target.closest && e.target.closest('#npcBtn, #npcCfgBtn, #npcDialog');
  document.addEventListener('pointerdown', (e) => {
    if ((!ligado && !testando) || dentro(e)) return;
    if (e.target.closest && e.target.closest('#joyZone, [data-dir], [data-cmd], #stopBtn')) parar('Você assumiu o controle: NPC desligado.');
  }, true);
  document.addEventListener('keydown', (e) => {
    if ((!ligado && !testando) || ($('npcDialog') && $('npcDialog').open)) return;
    if (String(e.key).toLowerCase() === 'c' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target.closest && e.target.closest('input,textarea,select,[contenteditable]'))) parar('Você assumiu o controle: NPC desligado.');
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'escape'].includes(String(e.key).toLowerCase())) parar('Você assumiu o controle: NPC desligado.');
  }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) parar('Aba em segundo plano: NPC desligado.'); });

  // ---- configurações (modal) ----------------------------------------------------------------------------------------------
  const CHECKS = [
    ['npcGirar', 'girar', 'Girar para um lado e para o outro'],
    ['npcOlhar', 'olhar', 'Olhar ao redor'],
    ['npcGestos', 'gestos', 'Gestos: abanar o rabo, dar a pata, alongar, cavar e dançar'],
    ['npcDormir', 'dormir', 'Deitar e dormir um tempo, acordando com um alongamento'],
    ['npcPasseios', 'passeios', 'Passinhos para a frente (o robô sai do lugar)']
  ];

  function construirDialog() {
    const d = document.createElement('dialog');
    d.id = 'npcDialog'; d.setAttribute('aria-labelledby', 'npcTitle');
    d.innerHTML = `
      <div class="settings-heading"><h2 id="npcTitle">Modo NPC</h2><button type="button" class="settings-button" id="npcClose" aria-label="Fechar">×</button></div>
      <div class="npc-body">
        <p class="npc-lead">O robô fica no lugar e vive como um cachorro: senta, levanta, deita, dorme, olha para os lados, gira e se espreguiça. Ele decide pelo que sente (energia, sono e curiosidade), sem receber comando de voz. Mexer no joystick, nas teclas, em qualquer pose ou no Parar desliga na hora.</p>
        <section><h3>O que ele pode fazer</h3>
          ${CHECKS.map(([id, , txt]) => `<label class="npc-check"><input type="checkbox" id="${id}"><span>${txt}</span></label>`).join('')}
        </section>
        <section><h3>Ritmo</h3>
          <div class="npc-campos">
            <label>Jeito<select id="npcRitmo"><option value="calmo">Calmo (pausas longas)</option><option value="normal">Normal</option><option value="agitado">Agitado (pausas curtas)</option></select></label>
            <label>Velocidade ao girar (% do limite do painel)<input type="number" id="npcVel" min="20" max="100" step="5" inputmode="numeric"></label>
            <label>Desligar sozinho depois de (min, 0 = nunca)<input type="number" id="npcLimite" min="0" max="240" step="5" inputmode="numeric"></label>
          </div></section>
        <p class="npc-aviso">Deixe o robô numa superfície firme e longe de bordas: ele gira sozinho. Se o robô ou o hub ficarem offline, ou a aba for para segundo plano, o modo desliga.</p>
      </div>
      <div class="npc-rodape">
        <span id="npcDlgStatus" class="npc-status" role="status">Desligado</span>
        <button type="button" class="btn" id="npcPadrao">Restaurar padrão</button>
        <button type="button" class="btn" id="npcTeste">Testar uma ação</button>
        <button type="button" class="btn btn-pose npc-ligar" id="npcDlgToggle">Ligar NPC</button>
      </div>`;
    document.body.append(d);
    return d;
  }

  function preencher() {
    for (const [id, k] of CHECKS) $(id).checked = cfg[k];
    $('npcRitmo').value = cfg.ritmo; $('npcVel').value = cfg.velocidade; $('npcLimite').value = cfg.limiteMin;
  }

  function ler() {
    cfg = normalizar({
      ...Object.fromEntries(CHECKS.map(([id, k]) => [k, $(id).checked])),
      ritmo: $('npcRitmo').value, velocidade: $('npcVel').value, limiteMin: $('npcLimite').value
    });
    salvar(); preencher();
  }

  function abrirDialog() { preencher(); render(); $('npcDialog').showModal(); }

  function init() {
    if (!$('npcBtn')) return;
    construirDialog();
    $('npcBtn').addEventListener('click', () => (ligado ? parar('NPC desligado.') : (idleProfile=false, ligar())));
    $('npcCfgBtn').addEventListener('click', abrirDialog);
    $('npcClose').addEventListener('click', () => $('npcDialog').close());
    $('npcDialog').addEventListener('change', ler);
    $('npcPadrao').addEventListener('click', () => { cfg = normalizar(null); salvar(); preencher(); });
    $('npcTeste').addEventListener('click', testarUma);
    $('npcDlgToggle').addEventListener('click', () => (ligado ? parar('NPC desligado.') : (idleProfile=false, ligar())));
    render();
    document.addEventListener('k9:lang', render);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
