/* Recover silent MJPEG disconnects without periodically resetting healthy video. */
(function (root) {
  function create({ getState, getStatus, reconnect, now = Date.now }) {
    let busy = false, attemptedAt = 0;
    return async function check() {
      const state = getState();
      if (busy || state.suspended || !state.ip || now() - state.openedAt < 12000 || now() - attemptedAt < 12000) return;
      busy = true;
      try {
        const status = await getStatus(state.viewer);
        const current = getState();
        if (current.suspended || current.viewer !== state.viewer) return;
        if (status.retryInMs > 0) return;
        if (status.viewerConnected === false || status.upstreamActive === false ||
            (status.lastFrameAt && now() - status.lastFrameAt > 12000)) {
          attemptedAt = now(); reconnect();
        }
      } catch (_) { /* Network recovery is also handled by Socket.IO reconnect. */ }
      finally { busy = false; }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = create;
  else root.K9CameraWatchdog = create;
})(typeof window !== 'undefined' ? window : globalThis);
