#!/usr/bin/env python3
"""K9 super-resolution sidecar (prototype, 29/10/2026).

The camera link carries only ~0.6-0.9 Mbit/s, so the camera sends small frames (preset 0, 320x240, ~3.4 kB) and this
process enlarges them 2x on the PC GPU (Real-ESRGAN "realesr-animevideov3-x2" through ncnn + Vulkan, BSD-3 licence).

  hub relay (/api/camera/stream) --> this sidecar (decode, 2x, encode) --> /stream  --> hub /api/camera/stream-ia --> panel

- It reads the hub's relay, never the camera directly (the camera accepts ONE viewer).
- It only connects upstream while somebody watches /stream.
- Latest frame wins: if the GPU is slower than the camera, older frames are dropped, so the delay does not grow.
- Frames already wider than K9_SR_MAX_IN pixels (preset 2, 640x480) are passed through untouched.

Env: K9_UPSTREAM, K9_TOKEN, K9_SR_PORT (3091), K9_SR_MODELS, K9_SR_MODEL, K9_SR_JPEG_Q (88), K9_SR_MAX_IN (480).
"""
import http.client
import http.server
import io
import json
import os
import re
import socketserver
import sys
import threading
import time
from urllib.parse import urlparse

import ncnn
import numpy as np
from PIL import Image

UPSTREAM = os.environ.get("K9_UPSTREAM", "http://127.0.0.1:3080/api/camera/stream")
TOKEN = os.environ.get("K9_TOKEN", "")
PORT = int(os.environ.get("K9_SR_PORT", "3091"))
MODELS = os.environ.get("K9_SR_MODELS", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "k9-superres", "models"))
MODEL = os.environ.get("K9_SR_MODEL", "realesr-animevideov3-x2")
JPEG_Q = int(os.environ.get("K9_SR_JPEG_Q", "88"))
MAX_IN = int(os.environ.get("K9_SR_MAX_IN", "480"))
SCALE = 2
MAX_JPEG = 1024 * 1024
FRAME_RE = re.compile(rb"Content-Length:\s*(\d+)\s*\r\n\r\n", re.I)


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


class Upscaler:
    def __init__(self):
        net = ncnn.Net()
        net.opt.use_vulkan_compute = True
        net.opt.use_fp16_packed = net.opt.use_fp16_storage = net.opt.use_fp16_arithmetic = True
        net.set_vulkan_device(0)
        net.load_param(os.path.join(MODELS, MODEL + ".param"))
        net.load_model(os.path.join(MODELS, MODEL + ".bin"))
        self.net = net
        self.run(np.zeros((48, 64, 3), np.uint8))   # warm-up: compiles the Vulkan pipelines

    def run(self, rgb):
        h, w, _ = rgb.shape
        m = ncnn.Mat.from_pixels(np.ascontiguousarray(rgb), ncnn.Mat.PixelType.PIXEL_RGB, w, h)
        m.substract_mean_normalize([0, 0, 0], [1 / 255.0] * 3)
        ex = self.net.create_extractor()
        ex.input("data", m)
        _, out = ex.extract("output")
        a = np.array(out).transpose(1, 2, 0)
        return (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)


class Pipeline:
    """Upstream reader -> latest raw frame -> GPU worker -> latest enhanced frame -> viewers."""

    def __init__(self):
        self.up = None
        self.lock = threading.Condition()
        self.viewers = 0
        self.raw = None          # (seq, jpeg)
        self.out = None          # (seq, jpeg)
        self.raw_seq = 0
        self.out_seq = 0
        self.stats = {"frames": 0, "ms": 0.0, "dropped": 0, "passthrough": 0}
        self.running = False
        self.upscaler = None

    # -- viewers -----------------------------------------------------------------
    def join(self):
        with self.lock:
            self.viewers += 1
            if not self.running:
                self.running = True
                threading.Thread(target=self._upstream, daemon=True).start()
                threading.Thread(target=self._worker, daemon=True).start()

    def leave(self):
        with self.lock:
            self.viewers -= 1
            if self.viewers <= 0:
                self.viewers = 0
                self.running = False
                self.lock.notify_all()

    def wait_out(self, last_seq, timeout=5.0):
        with self.lock:
            self.lock.wait_for(lambda: self.out_seq != last_seq or not self.running, timeout)
            return self.out if self.out and self.out[0] != last_seq else None

    # -- upstream reader -----------------------------------------------------------
    def _upstream(self):
        u = urlparse(UPSTREAM)
        path = u.path + ("?token=" + TOKEN if TOKEN else "")
        while self.running:
            conn = None
            try:
                conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=8)
                conn.request("GET", path)
                resp = conn.getresponse()
                if resp.status != 200:
                    raise RuntimeError("upstream HTTP %d" % resp.status)
                buf = b""
                while self.running:
                    chunk = resp.read1(65536)
                    if not chunk:
                        break
                    buf += chunk
                    while True:
                        m = FRAME_RE.search(buf)
                        if not m:
                            if len(buf) > 8192 and b"--" not in buf[-4096:]:
                                buf = buf[-4096:]
                            break
                        n = int(m.group(1))
                        if n < 4 or n > MAX_JPEG:
                            buf = buf[m.end():]
                            continue
                        end = m.end() + n
                        if len(buf) < end:
                            break
                        jpeg = buf[m.end():end]
                        buf = buf[end:]
                        with self.lock:
                            if self.raw is not None and self.raw[0] > self.out_seq:
                                self.stats["dropped"] += 1
                            self.raw_seq += 1
                            self.raw = (self.raw_seq, jpeg)
                            self.lock.notify_all()
            except Exception as e:                      # camera or hub restarting: wait and retry
                if self.running:
                    log("upstream: %s" % e)
                    time.sleep(1.5)
            finally:
                if conn:
                    conn.close()

    # -- GPU worker ----------------------------------------------------------------
    def _worker(self):
        if self.upscaler is None:
            self.upscaler = Upscaler()
            log("modelo %s carregado" % MODEL)
        done = 0
        while True:
            with self.lock:
                self.lock.wait_for(lambda: not self.running or (self.raw and self.raw[0] != done), 2.0)
                if not self.running:
                    return
                if not self.raw or self.raw[0] == done:
                    continue
                seq, jpeg = self.raw
            done = seq
            try:
                t = time.time()
                img = Image.open(io.BytesIO(jpeg)).convert("RGB")
                if img.width <= MAX_IN:
                    img = Image.fromarray(self.upscaler.run(np.asarray(img)))
                    buf = io.BytesIO()
                    img.save(buf, "JPEG", quality=JPEG_Q)
                    out = buf.getvalue()
                else:
                    out = jpeg
                    self.stats["passthrough"] += 1
                ms = (time.time() - t) * 1000
                st = self.stats
                st["frames"] += 1
                st["ms"] = ms if st["frames"] == 1 else st["ms"] * 0.9 + ms * 0.1
            except Exception as e:
                log("frame descartado: %s" % e)
                continue
            with self.lock:
                self.out_seq += 1
                self.out = (self.out_seq, out)
                self.lock.notify_all()


PIPE = Pipeline()


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/health"):
            body = json.dumps({"ok": True, "model": MODEL, "viewers": PIPE.viewers, **PIPE.stats}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if not self.path.startswith("/stream"):
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=k9sr")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        PIPE.join()
        last = 0
        try:
            while True:
                item = PIPE.wait_out(last)
                if item is None:
                    if not PIPE.running:
                        break
                    continue
                last, jpeg = item
                self.wfile.write(b"--k9sr\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(jpeg) + jpeg + b"\r\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            PIPE.leave()


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    log("super-resolução K9 em http://127.0.0.1:%d (upstream %s)" % (PORT, UPSTREAM))
    Server(("127.0.0.1", PORT), Handler).serve_forever()
