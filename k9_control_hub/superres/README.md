# AI-enhanced video (prototype, 29/10/2026)

The camera's Wi-Fi link delivers only ~0.6 to 0.9 Mbit/s (`docs/CAMERA-WIFI.md`). Instead of sending large frames, the camera
sends small frames (**Fast** preset, 320×240, ~3.4 kB, ~12 fps) and the PC's GPU upscales 2× to 640×480 and removes the JPEG blocks.

```
camera -> hub relay (/api/camera/stream) -> superres.py (GPU) -> hub /api/camera/stream-ia -> panel ("Enhance with AI" button)
```

- Model: Real-ESRGAN `realesr-animevideov3-x2` (BSD-3-Clause, 1.2 MB), through ncnn + Vulkan (no CUDA needed). Measured on an RTX 2060:
  ~38 ms per frame with fp16.
- The service only connects to the hub while someone watches, drops old frames (the delay does not grow) and lets through untouched
  frames already wider than 480 px (the Sharp preset).
- If the service is not running, the hub answers 503 and the panel returns to normal video by itself.

## Install and start
```bash
python3 -m venv ~/k9-superres/venv
~/k9-superres/venv/bin/pip install ncnn pillow numpy
# model (it ships in the pip package realesrgan-ncnn-py; copy only these two files):
#   ~/k9-superres/models/realesr-animevideov3-x2.param   and   .bin
./k9_control_hub/superres/start.sh      # port 3091 (K9_SR_PORT)
```
`GET http://127.0.0.1:3091/health` shows the model, viewers, ms per frame and dropped frames.
Variables: `K9_UPSTREAM`, `K9_TOKEN` (if the hub uses a token), `K9_SR_PORT`, `K9_SR_MODELS`, `K9_SR_MODEL`, `K9_SR_JPEG_Q`, `K9_SR_MAX_IN`.

## Known limits
- The model is trained on anime/video: it smooths fine textures (carpet, noise) and leaves clean edges. For photos you can try `realesr-general-x4v3`.
- It does not create real detail: the advantage is smoothness (more frames on the same link) and the absence of blocks, not real resolution.
- The `/api/camera/stream-ia` endpoint serves an enhanced copy to whoever asks; each AI viewer shares the same processing.
