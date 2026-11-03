'use strict';
/* Adaptador do robô: fala só com o hub (REST). O hub valida, aplica rampa e para sozinho em 0,4 s sem comando. */

function createRobot({ hubUrl, token = '', fetchImpl = fetch, tickMs = 100, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const headers = { 'content-type': 'application/json', ...(token ? { 'x-hub-token': token } : {}) };
  let walkId = 0;

  async function call(path, body) {
    const r = await fetchImpl(hubUrl + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`hub respondeu ${r.status}`);
    return r.json();
  }

  async function status() {
    const s = await call('/api/status');
    const t = s.telemetry || {};
    return { online: !!s.online, ip: s.ip || null, camOnline: !!s.camOnline, rssi: t.rssi ?? null, marcha: t.gait ?? null, fwd: t.fwd ?? 0, turn: t.turn ?? 0, uptime: t.uptime ?? null };
  }

  async function stop() {
    walkId++;                                           // cancela qualquer caminhada em curso
    await call('/api/cmd', { cmd: 'drive', fwd: 0, turn: 0 }).catch(() => {});
    return call('/api/cmd', { cmd: 'stop' });
  }

  async function pose(cmd) { walkId++; return call('/api/cmd', { cmd }); }

  // Manda "andar" a cada tick até acabar o tempo; termina sempre com drive 0. Qualquer erro seguido interrompe.
  async function walk(f, t, seconds) {
    const id = ++walkId; let falhas = 0; const fim = Date.now() + seconds * 1000;
    try {
      while (Date.now() < fim && id === walkId) {
        try { await call('/api/cmd', { cmd: 'drive', fwd: f, turn: t }); falhas = 0; }
        catch (e) { if (++falhas >= 3) throw e; }
        await sleep(tickMs);
      }
    } finally {
      if (id === walkId) await call('/api/cmd', { cmd: 'drive', fwd: 0, turn: 0 }).catch(() => {});
    }
    return id === walkId ? 'terminou' : 'interrompido';
  }

  async function nome() { const r = await call('/api/nome'); return typeof r.nome === 'string' ? r.nome : 'K9'; }

  return { status, stop, pose, walk, nome };
}

module.exports = { createRobot };
