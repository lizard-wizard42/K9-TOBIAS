'use strict';
(function () {
  // Same MK3 baseline, one variable changed per experiment. No new firmware protocol.
  const PRESETS = Object.freeze([
    { id: 'I', name: 'Postura 0°', values: Object.freeze([1.5, 51, .66, 0, 1]) },
    { id: 'J', name: 'Postura -10°', values: Object.freeze([1.5, 50, .66, -10, 1]) },
    { id: 'K', name: 'Impulso 0,60', values: Object.freeze([1.5, 51, .60, -6, 1]) },
    { id: 'L', name: 'Impulso 0,72 · 1,3 Hz', values: Object.freeze([1.3, 51, .72, -6, 1]) }
  ].map(Object.freeze));
  // Todos os testes usam a fase da marcha 6 (cada lado junto): FL, FR, RL, RR.
  const FASE = Object.freeze([0, 180, 0, 180]);
  const matches = (a, b) => Array.isArray(a) && a.length === 5 &&
    a.every((v, i) => Number.isFinite(v) && Math.abs(v - b[i]) < .005);

  function createController(hub, render, timers = { setTimeout, clearTimeout }) {
    let telemetry = {}, pending = null, timer = null, serial = 0;
    let message = 'Aguardando conexão com as pernas.';
    const ready = () => !!(hub.socket.connected && telemetry.online && telemetry.controlsVersion >= 2);
    const active = () => ready() && telemetry.gait === 7
      ? PRESETS.find(p => matches(telemetry.gaitParams, p.values)) : null;
    function draw() { render({ ready: ready(), pending: pending && pending.id, active: active()?.id, message }); }
    function cancel() { timers.clearTimeout(timer); timer = null; pending = null; serial++; }
    function receive(data) {
      telemetry = data || {};
      if (!ready()) {
        cancel();
        message = telemetry.online && telemetry.controlsVersion < 2
          ? 'Firmware sem suporte a ajuste temporário.' : 'Sem conexão com as pernas. Testes desativados.';
      } else if (pending && active()?.id === pending.id) {
        const id = pending.id; cancel();
        message = `${id} ativo`;
      } else if (!pending) {
        message = active() ? `${active().id} ativo`
          : 'MK3';
      }
      draw();
    }
    function select(id) {
      const preset = PRESETS.find(p => p.id === id);
      if (!preset || !ready() || pending) return false;
      // stopAll also cancels the existing random mode; never start walking here.
      hub.stopAll();
      pending = preset; const request = ++serial;
      message = `${id}…`; draw();
      timer = timers.setTimeout(() => {
        if (request !== serial) return;
        cancel(); message = 'A placa não confirmou o ajuste. Confira a conexão e tente novamente.'; draw();
      }, 4500);
      hub.socket.emit('k9:gait_params', [...preset.values, ...FASE], result => {
        if (request !== serial) return;
        if (!result?.ok) {
          cancel(); message = 'O hub recusou o teste. Nenhuma confirmação da placa.'; draw();
        }
        // A hub ACK is not board confirmation. Only receive() can confirm.
      });
      return true;
    }
    hub.socket.on('k9:telemetry', receive);
    hub.socket.on('k9:status', st => { if (st?.online === false) receive({ ...telemetry, online: false }); });
    hub.socket.on('disconnect', () => receive({ online: false }));
    draw();
    return { select, receive };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { PRESETS, matches, createController };
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  window.addEventListener('DOMContentLoaded', () => {
    if (typeof K9Hub === 'undefined' || !K9Hub.socket) return;
    const buttons = [...document.querySelectorAll('[data-gait-test]')];
    const controller = createController(K9Hub, state => {
      for (const b of buttons) {
        b.disabled = !state.ready || !!state.pending;
        b.setAttribute('aria-pressed', String(b.dataset.gaitTest === state.active));
      }
      document.getElementById('gaitTestStatus').textContent = state.message;
    });
    buttons.forEach(b => b.addEventListener('click', () => controller.select(b.dataset.gaitTest)));
  });
})();
