'use strict';
// Variações 1-10 da marcha principal (MK3 diagonal 1,25 Hz) para as patas traseiras +8 mm da MK4 (2026-10-30).
// A pata de trás é 22 % mais comprida (joelho→pé 33,8 vs 27,6 mm), então ela deve VOLTAR O PASSO MAIS RÁPIDO
// que a da frente. Cada variação manda, num pacote só, os 5 parâmetros + a fase das 4 patas + o "duty extra"
// das traseiras (firmware das pernas 1.1.0, UDP "R"). Tudo fica só na RAM da placa: o botão "Marcha" (gait5)
// ou reiniciar volta exatamente à marcha principal. Nunca começa a andar sozinho.
(function () {
  const DIAG = Object.freeze([0, 180, 180, 0]);          // diagonal, igual à marcha principal
  const ADIANT = Object.freeze([0, 180, 200, 20]);       // traseiras adiantadas 20°: a volta delas começa junto com a da frente
  const CAMINHADA = Object.freeze([0, 180, 270, 90]);    // uma pata volta por vez, na ordem FL → RR → FR → RL (sempre 3 apoiadas com duty >= .75)
  // values = [freq, passo, duty, postura, proporção]; rear = duty extra só nas traseiras
  const VARIACOES = Object.freeze([
    { id: '1', nome: 'Piso Firme (Padrão)', values: [1.25, 51, .66, -6, 1.00], phase: DIAG, rear: .06,
      rotulo: 'Firme', dica: 'Aprovada no chão! Traseira duty 0,72 (455°/s). Para pisos secos e regulares.' },
    { id: '2', nome: 'Carpete / Tapete', values: [1.25, 50, .66, -5, 1.00], phase: DIAG, rear: .08,
      rotulo: 'Tapete', dica: 'Retorno veloz (480°/s) e postura mais alta para não prender nas fibras do tapete.' },
    { id: '3', nome: 'Asfalto / Calçada', values: [1.30, 50, .65, -6, 1.00], phase: ADIANT, rear: .06,
      rotulo: 'Asfalto', dica: 'Piso áspero com muita tração: passada contínua a 1,30 Hz e traseiras adiantadas.' },
    { id: '4', nome: 'Piso Liso / Azulejo', values: [1.15, 44, .70, -7, 1.00], phase: DIAG, rear: .05,
      rotulo: 'Liso', dica: 'Passo curto (44°), centro baixo e 70% de apoio no chão para não derrapar nem deslizar.' },
    { id: '5', nome: 'Terra / Irregular', values: [1.15, 48, .67, -3, 1.00], phase: ADIANT, rear: .06,
      rotulo: 'Terra', dica: 'Chassi alto (-3° de vão livre), torque forte a 1,15 Hz e traseira ágil para desníveis.' },
    // 6-10 (2026-10-30/31): testes para piso liso e molhado. 7 (rastejo) e 10 (tração dianteira) vêm do modelo do Blender; 6, 8 e 9 são as três melhores do
    // experimento de simulação (sim/dados_marchas.csv: 191 marchas x 4 pisos), ainda NÃO validadas no robô real.
    // Pé de perna rígida: empurra e arrasta a mesma distância (27 mm), então o avanço vem só da assimetria de atrito/carga. Cada teste mexe numa coisa só.
    { id: '6', nome: 'Simulada A · Rápida', values: [1.56, 51, .59, 2.3, .97], phase: DIAG, rear: 0,
      rotulo: 'Sim A', dica: 'Escolhida pela simulação (31/10): duty .59, postura +2,3° e sem duty extra na traseira. Previu ~2x a principal em todos os pisos. 1,56 Hz: mais reversões por segundo, vigie a bateria.' },
    { id: '7', nome: 'Rastejo (3 apoios)', values: [0.9, 40, .75, -4, 1.00], phase: CAMINHADA, rear: 0,
      rotulo: 'Rastejo', dica: 'Uma pata volta por vez e três ficam sempre apoiadas: mais peso empurrando e menos pata arrastando. Lento, para piso liso.' },
    { id: '8', nome: 'Simulada D · Passo Longo 1,63 Hz', values: [1.63, 48, .58, 3.3, 1.17], phase: [0, 180, 210, 30], rear: 0,
      rotulo: 'Sim D', dica: 'Da busca de 31/10 só com comandos que o hub já envia: frente com passo um pouco maior (proporção 1,17), postura +3,3° e traseiras adiantadas 30°. Foi a melhor das 70 candidatas na simulação (~48% acima da Sim A). Retorno do servo ~87% do teto a 100%.' },
    { id: '9', nome: 'Simulada C · Traseira Adiantada', values: [1.43, 46, .58, -0.9, .82], phase: ADIANT, rear: 0,
      rotulo: 'Sim C', dica: 'Da simulação: traseira adiantada 20°, proporção 0,82 (traseira varre mais) e duty .58.' },
    { id: '10', nome: 'Simulada E · Passo Longo 1,52 Hz', values: [1.52, 49, .63, 2.6, 1.13], phase: [0, 180, 210, 30], rear: .02,
      rotulo: 'Sim E', dica: 'Parente mais lenta da Sim D (1,52 Hz, duty .63, duty extra traseiro +0,02): menos reversões por segundo e resultado parecido na simulação.' }
  ].map(v => Object.freeze({ ...v, values: Object.freeze(v.values) })));

  const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) < tol;
  const nearArr = (a, b, tol) => Array.isArray(a) && a.length === b.length && a.every((v, i) => near(v, b[i], tol));
  // Qual variação a placa está rodando (pela telemetria), ou null.
  function match(t) {
    if (!t || t.gait !== 7 || !Number.isFinite(t.rearDuty)) return null;
    return VARIACOES.find(v => nearArr(t.gaitParams, v.values, .005) && near(t.rearDuty, v.rear, .005)
      && nearArr(t.phase, v.phase, 1)) || null;
  }

  function createController(hub, render, timers = { setTimeout: (fn,ms) => setTimeout(fn,ms), clearTimeout: id => clearTimeout(id) }) {
    let telemetry = {}, pending = null, timer = null, serial = 0;
    let message = 'Aguardando as pernas.';
    const online = () => !!(hub.socket.connected && telemetry.online && telemetry.controlsVersion >= 2);
    const ready = () => online() && Number.isFinite(telemetry.rearDuty);   // firmware 1.1.0+ manda rearDuty
    function draw() { render({ ready: ready(), pending: pending && pending.id, active: match(telemetry)?.id, message }); }
    function cancel() { timers.clearTimeout(timer); timer = null; pending = null; serial++; }
    function receive(data) {
      telemetry = data || {};
      const act = match(telemetry);
      if (!ready()) {
        cancel();
        message = online() ? 'Atualize o firmware das pernas (OTA) para usar as variações 1-10.' : 'Pernas offline.';
      } else if (pending && act?.id === pending.id) {
        cancel(); message = `Variação ${act.id} ativa: ${act.nome}. Use o controle para andar.`;
      } else if (!pending) {
        message = act ? `Variação ${act.id} ativa: ${act.nome}.` : 'Marcha principal. Toque 1-10 para testar uma variação.';
      }
      draw();
    }
    function select(id) {
      const v = VARIACOES.find(p => p.id === id);
      if (!v || !ready() || pending) return false;
      hub.stopAll();                                     // para o que estiver andando; nunca começa a andar aqui
      pending = v; const request = ++serial;
      message = `Variação ${id}…`; draw();
      timer = timers.setTimeout(() => {
        if (request !== serial) return;
        cancel(); message = 'A placa não confirmou a variação. Confira a conexão e tente de novo.'; draw();
      }, 4500);
      hub.socket.emit('k9:gait_params', [...v.values, ...v.phase, v.rear], result => {
        if (request !== serial) return;
        if (!result?.ok) { cancel(); message = 'O hub recusou a variação.'; draw(); }
      });
      return true;
    }
    hub.socket.on('k9:telemetry', receive);
    hub.socket.on('k9:status', st => { if (st?.online === false) receive({ ...telemetry, online: false }); });
    hub.socket.on('disconnect', () => receive({ online: false }));
    draw();
    return { select, receive };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { VARIACOES, match, createController };
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  window.K9MarchaVar = { VARIACOES, match };
  window.addEventListener('DOMContentLoaded', () => {
    if (typeof K9Hub === 'undefined' || !K9Hub.socket) return;
    const buttons = [...document.querySelectorAll('[data-marcha-var]')];
    const T = (k) => (window.K9I18n ? window.K9I18n.t(k) : k);
    const rotular = () => { for (const b of buttons) {
      const v = VARIACOES.find(p => p.id === b.dataset.marchaVar);
      if (v) { b.title = `${v.id} · ${T(v.nome)}: ${T(v.dica)}`; b.setAttribute('aria-label', `${T('Variação {0}: {1}').replace('{0}', v.id).replace('{1}', T(v.nome))}`); }
    } };
    rotular(); document.addEventListener('k9:lang', rotular);
    const status = document.getElementById('marchaVarStatus');
    const badge = document.getElementById('gaitBadge');
    const badgeBtn = document.getElementById('gaitBadgeBtn');
    const controller = createController(K9Hub, state => {
      for (const b of buttons) {
        b.disabled = !state.ready || !!state.pending;
        b.setAttribute('aria-pressed', String(b.dataset.marchaVar === state.active));
        b.classList.toggle('pending', b.dataset.marchaVar === state.pending);
      }
      if (status) status.textContent = state.message;
      if (badge) {
        if (state.active) {
          const v = VARIACOES.find(p => p.id === state.active);
          badge.textContent = v ? `VAR ${v.id} · ${v.rotulo}` : 'VAR ' + state.active;
        } else {
          badge.textContent = 'MK3';
        }
      }
      if (badgeBtn) badgeBtn.setAttribute('aria-pressed', String(!state.active));
    });
    buttons.forEach(b => b.addEventListener('click', () => controller.select(b.dataset.marchaVar)));
    // Depois de trocar de marcha (variação, botão de marcha ou formulário), pede o estado da placa de novo: o que o F5 fazia à mão.
    const snapshot = () => { try { K9Hub.socket.emit('k9:snapshot'); } catch (e) { /* sem conexão */ } };
    const refreshSoon = () => [350, 1200, 2800, 5000].forEach(ms => setTimeout(snapshot, ms));
    buttons.forEach(b => b.addEventListener('click', refreshSoon));
    document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-cmd^="gait"]')) refreshSoon(); });
    const gaitForm = document.getElementById('gaitForm');
    if (gaitForm) gaitForm.addEventListener('submit', refreshSoon);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) snapshot(); });
    window.addEventListener('focus', snapshot);
    K9Hub.socket.on('connect', snapshot);
  });
})();
