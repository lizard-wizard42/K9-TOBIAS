/* Settings come from the board so all open panels share the same mute state. */
window.K9SoundControls = function (hub) {
  const mute = document.getElementById('soundMute');
  const volume = document.getElementById('soundVolume');
  const waves = document.getElementById('soundWaves');
  const slash = document.getElementById('soundSlash');
  let dragging = false, lastAudibleVolume = 50;
  let state = null, pending = null, deadline = 0, lastSent = 0;
  const musicButtons = [...document.querySelectorAll('#gridSons [aria-pressed]')];
  const render = () => {
    musicButtons.forEach(button => button.setAttribute('aria-pressed', String(!!state && state.soundMusic === button.dataset.cmd)));

    const available = state && hub.socket.connected && hub.link.robot;
    mute.disabled = volume.disabled = !available;
    if (!state) return;
    const silent = state.soundMuted || state.soundVolume === 0;
    if (state.soundVolume > 0) lastAudibleVolume = state.soundVolume;
    mute.setAttribute('aria-pressed', String(silent));
    const label = silent ? 'Ativar som' : 'Mudo';
    const translated = window.K9I18n ? K9I18n.t(label) : label;
    mute.setAttribute('aria-label', translated); mute.title = translated;
    waves.style.display = silent ? 'none' : '';
    slash.style.display = silent ? '' : 'none';
    if (!dragging && (!pending || pending.key !== 'soundVolume')) volume.value = state.soundVolume;
    volume.setAttribute('aria-valuetext', volume.value + '%');
  };
  const send = (key, value, cmd) => {
    if (!state || !hub.canSend(cmd)) return;
    pending = {key, value, cmd}; deadline = Date.now() + 4000; lastSent = Date.now();
    hub.socket.emit('k9:cmd', {cmd});
  };
  mute.addEventListener('click', () => {
    if (state && !state.soundMuted && state.soundVolume === 0) { send('soundVolume', lastAudibleVolume, 'sound_volume_' + lastAudibleVolume); return; }
    if (state) send('soundMuted', !state.soundMuted, state.soundMuted ? 'sound_unmute' : 'sound_mute');
  });
  volume.addEventListener('input', () => { dragging = true; volume.setAttribute('aria-valuetext', volume.value + '%'); });
  volume.addEventListener('change', () => { dragging = false; const value = Number(volume.value); send('soundVolume', value, 'sound_volume_' + value); });
  hub.socket.on('k9:telemetry', data => {
    if (typeof data.soundMuted === 'boolean' && typeof data.soundAutomatic === 'boolean' && Number.isInteger(data.soundVolume)) state = data;
    if (pending && state) {
      if (state[pending.key] === pending.value || Date.now() > deadline) pending = null;
      else if (Date.now() - lastSent >= 500) {
        lastSent = Date.now(); hub.socket.emit('k9:cmd', {cmd:pending.cmd});
      }
    }
    render();
  });
  hub.socket.on('disconnect', () => { state = null; pending = null; render(); });
  render();
};
