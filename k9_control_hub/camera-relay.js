'use strict';
const http = require('node:http');

// One camera connection, complete JPEG frames shared by all dashboard viewers.
// No camera control commands, transcoding, or unbounded per-viewer queues.
function createCameraRelay({ getTarget, timeoutMs = 8000, cooldownMs = 3000, maxViewers = 8, maxFrameBytes = 1024 * 1024 }) {
  const viewers = new Set();
  let session = null;
  let retryAt = 0;
  let frames = 0;
  let lastFrameAt = null;
  let lastError = null;
  let slowViewers = 0;

  function stop(reason) {
    const old = session;
    session = null;
    if (old) {
      clearTimeout(old.timer);
      old.response?.destroy();
      old.request?.destroy();
    }
    if (reason) {
      lastError = reason;
      retryAt = Date.now() + cooldownMs;
    }
    for (const res of viewers) res.destroy();
    viewers.clear();
  }

  function armDeadline(s) {
    clearTimeout(s.timer);
    s.timer = setTimeout(() => { if (session === s) stop('camera_frame_timeout'); }, timeoutMs);
    s.timer.unref();
  }

  function publish(jpeg) {
    frames++;
    lastFrameAt = Date.now();
    lastError = null;
    const packet = Buffer.concat([
      Buffer.from(`--k9frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`),
      jpeg, Buffer.from('\r\n')
    ]);
    for (const res of viewers) {
      // A single frame can exceed the socket high-water mark; allow it to drain,
      // but never queue another frame behind a stalled viewer.
      if (res.destroyed || res.writableNeedDrain || res.writableLength > maxFrameBytes) {
        slowViewers++;
        viewers.delete(res);
        res.destroy();
      } else res.write(packet);
    }
    if (!viewers.size) stop();
  }

  function start(target) {
    const s = { buffer: Buffer.alloc(0), pending: null, marker: null, request: null, response: null, timer: null, target };
    session = s;
    armDeadline(s);
    s.request = http.get({ ...target, agent: false, headers: { Connection: 'close' } }, upstream => {
      if (session !== s) { upstream.destroy(); return; }
      s.response = upstream;
      const type = String(upstream.headers['content-type'] || '');
      const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(type);
      if (upstream.statusCode !== 200 || !/^multipart\/x-mixed-replace/i.test(type) || !boundary) {
        stop('camera_invalid_response'); return;
      }
      s.marker = Buffer.from('--' + (boundary[1] || boundary[2]));
      if (s.marker.length > 128) { stop('camera_invalid_boundary'); return; }
      upstream.on('data', chunk => {
        if (session !== s) return;
        s.buffer = Buffer.concat([s.buffer, chunk]);
        if (s.buffer.length > maxFrameBytes + 65536) { stop('camera_frame_too_large'); return; }
        while (session === s) {
          if (s.pending === null) {
            const begin = s.buffer.indexOf(s.marker);
            if (begin < 0) {
              if (s.buffer.length > 4096) stop('camera_invalid_frame');
              return;
            }
            const end = s.buffer.indexOf('\r\n\r\n', begin);
            if (end < 0) {
              if (s.buffer.length > 4096) stop('camera_invalid_headers');
              return;
            }
            const header = s.buffer.subarray(begin, end).toString('ascii');
            const length = /\r\nContent-Length:\s*(\d+)\s*(?:\r\n|$)/i.exec(header);
            s.pending = length ? Number(length[1]) : 0;
            if (s.pending < 4 || s.pending > maxFrameBytes) { stop('camera_invalid_length'); return; }
            s.buffer = s.buffer.subarray(end + 4);
          }
          if (s.buffer.length < s.pending) return;
          const jpeg = s.buffer.subarray(0, s.pending);
          s.buffer = s.buffer.subarray(s.pending);
          s.pending = null;
          if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[jpeg.length - 2] !== 0xff || jpeg[jpeg.length - 1] !== 0xd9) {
            stop('camera_invalid_jpeg'); return;
          }
          armDeadline(s);
          publish(jpeg);
        }
      });
      for (const event of ['end', 'error', 'aborted']) upstream.on(event, () => {
        if (session === s) stop('camera_stream_ended');
      });
    });
    s.request.on('socket', socket => socket.setNoDelay(true));
    s.request.on('error', () => { if (session === s) stop('camera_unreachable'); });
  }

  function handle(req, res) {
    const target = getTarget();
    if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return; }
    if (session && target && JSON.stringify(target) !== JSON.stringify(session.target)) stop('camera_address_changed');
    if (!target || Date.now() < retryAt || viewers.size >= maxViewers) {
      res.writeHead(503, { 'Retry-After': '3', 'Cache-Control': 'no-store' });
      res.end('Camera indisponivel; tente novamente em alguns segundos.'); return;
    }
    res.socket?.setNoDelay(true);
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=k9frame', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.k9Viewer = typeof req.query?.viewer === "string" ? req.query.viewer.slice(0, 100) : null;
    viewers.add(res);
    res.on('close', () => { viewers.delete(res); if (!viewers.size) stop(); });
    if (!session) start(target);
  }

  return {
    handle,
    close: () => stop(),
    status: (viewer) => ({ viewerConnected: typeof viewer === "string" ? [...viewers].some(res => res.k9Viewer === viewer && !res.destroyed) : undefined, viewers: viewers.size, upstreamActive: !!session, frames, lastFrameAt, lastError, slowViewers, retryInMs: Math.max(0, retryAt - Date.now()) })
  };
}
module.exports = { createCameraRelay };
