# K9 camera: Wi-Fi and smoothness measurements (29/10/2026, 15:25)

> **Current state (29/10/2026):** revision 12, 18 MHz, CIF, JPEG 10, colour and sharpness +1. [Consolidated profile](K9CAM-STABLE-PROFILE.md) · screenshots and settings (private maintainer archive; not part of the software repository). The sections below record earlier experiments; AI and the quality selector were removed from the panel.

K9CAM board (**OV3660 sensor**), 2.4 GHz mesh network. The PC and the hub are **on a cable**, so the only wireless leg is camera ↔ router.
Measured with `scratchpad/camstream.py` (connects to port 81, counts JPEG frames) and `ping`. Camera settings restored at the end (preset 0, limit of 12 fps).

## Signal and latency
| Board | RSSI | Ping (20 packets) | Loss |
|---|---|---|---|
| Camera | −33 to −38 dBm (excellent, very close to the node) | 2.7 / 13.5 / 36.6 ms (min/avg/max) | 0 % |
| Legs | −45 to −54 dBm | 3.9 / 7.9 / 21.2 ms | 0 % |
| Camera with the stream on | −36 dBm | 3.2 / 19.4 / 52.0 ms | 0 % |

Earlier, at 14:56, the camera log showed −74 to −49 dBm: the robot's position matters a lot.

## Real presets (OV3660: QVGA / CIF / VGA)
| Preset | Resolution | Bytes per frame |
|---|---|---|
| 0 Fast | 320×240 | 5.7 kB |
| 1 Balanced | 400×296 | 8.9 kB |
| 2 Sharp | 640×480 | 22.6 kB |

## Measured smoothness (port 81, 12 to 20 s per run, RSSI ≈ −36)
| Preset | fps | throughput | note |
|---|---|---|---|
| 0, limit 12 fps | 13.8 / 12.9 | 614 to 658 kbit/s | limited by the firmware's fps cap |
| 1 | 10.2 then 5.1 | 753 and 375 kbit/s | same bytes per frame, **fps halved** between runs; longest pause 1.4 s |
| 2 | 8.4 / 5.8 / 5.1 / 4.3 | 780 to 1580 kbit/s | same; frame interval of 120 to 350 ms |

64 kB download of `/log`: camera 97 to 113 kB/s, legs 72 to 86 kB/s (≈ 0.6 to 0.9 Mbit/s) despite very different signals.

## Reading
- **The camera link's effective throughput is ~0.4 to 1.6 Mbit/s and varies between runs with the same signal and the same bytes.** That is far below what 2.4 GHz Wi-Fi delivers at −36 dBm, and points to the **wireless leg** (channel congestion, low negotiated rate or retransmissions), not to the sensor. It agrees with the owner's hypothesis.
- I did not separate what is the ESP32's radio from what is the router/mesh: the PC is on a cable and has no Wi-Fi card, so channel, negotiated rate and neighbours could not be seen.
- A delayed ACK from the PC is not the bottleneck (TCP_QUICKACK changed nothing).
- Camera firmware: no protocol choice (802.11b/g/n all on), 17 dBm power, access point not pinned (pinning the BSSID was switched off on purpose), sleep off, 1 viewer at a time, maximum fps cap 15.

## Ideas to speed it up (NOT tested yet)
1. Reduce preset 2's bytes: raise the VGA compression (q18 → ~24–26) in `cam_stable/web_cam_server.h` (**not done yet**; measure with the same scene and check the JPEG quantisation table).
2. Remove 802.11b from the camera radio (`esp_wifi_set_protocol` G+N only) and review the 11 dBm power of `cam_stable` (**not tested**).
3. Measure the channel and the node: see the mesh's channel and whether the camera is on the nearest node (Wi-Fi analyser on the phone or the router's panel); force a channel without neighbours.
4. Improve position/antenna: the difference from −74 to −35 dBm between two moments shows that place matters.
5. Raising the 15 fps cap only makes sense after the link is solved.

## ERRATUM (29/10, 16:25): the camera was NOT changed today
I said the "q18 → q26 on VGA" change and the removal of 802.11b had been flashed to the camera. **They were not.** The camera builds `src/cam_stable/web_cam_server.h` (`main.cpp` line 9); I edited `src/web_cam_server.h`, which only the legs use. Proof: (1) the camera `.bin` built after both flashes is **byte for byte identical** to the one before (SHA-256 `e5d7b092…`); (2) the quantisation table of preset 2's frames is still q18's (`[18,12,14,16,14,11,18,16]`).
Consequences:
- **Withdrawn:** "Sharp went from 2–5 to 9 fps with q26", "22–37 kB frames dropped to 11 kB" and "802.11b did not help". None of this was tested. The difference in bytes came from the **scene**: the same firmware (q18) gave 22–37 kB per frame in one scene and ~11 kB in another (carpet and cables against a smooth wall), and fps followed the bytes (fps ≈ throughput ÷ bytes).
- **Withdrawn:** the "fps cap" tests (6 and 15): the stable firmware **has no** fps cap or options command (`O`); the hub keeps those values only in the panel. The stable firmware sends as fast as the link allows (up to 3 viewers, `vTaskDelay(1)`), and may use an 11 dBm transmit power.
- **Also withdrawn:** the "weak power" explanation for the 15:38 worsening: what is known is that at that moment there were **two viewers** (hub and my script) and then the owner plugged in the USB; the cause was not proven.
- **Still valid:** signal and ping measurements, link throughput (0.4 to 1.6 Mbit/s, oscillating), camera-to-hub delay (0.2 to 0.4 s, unaffected by the "fps cap", which did not exist) and the whole AI prototype, which works on the frames the camera already sends.
- **The camera's real firmware today:** preset 0 = 320×240 q28 (≈ 3.5 kB, ≈ 12 fps), preset 1 = 400×296 q22 (≈ 9 kB), preset 2 = 640×480 q18 (11 to 37 kB depending on the scene). The adjustments (VGA q, transmit power, XCLK) **have not been made yet** and must be made in `cam_stable/web_cam_server.h`.

## Prototype: AI-enhanced video on the PC (29/10, 16:00) — `k9_control_hub/superres/`
A "DLSS-like" idea: the camera sends small frames (Fast preset, 320×240, 3.4 kB) and the PC's GPU upscales 2× (Real-ESRGAN `realesr-animevideov3-x2`, ncnn + Vulkan, RTX 2060, BSD-3). The `superres.py` service reads the hub's relay and serves `/stream`; the hub exposes `/api/camera/stream-ia`; the panel got the **Enhance with AI** button (Quality menu; remembers the choice in the browser and goes back to normal video by itself if the service is off).
- **Speed:** GPU 38 to 45 ms per frame (fp16); the complete service 56 ms (decode 1.7 + GPU 44.5 + encode 9.6), ~85 ms average with the service in use. More than the camera's ~12 fps? No: the service drops old frames and delivers 9.8 to 12.6 fps.
- **Smoothness of what reaches the panel (Fast preset + AI):** 9.8 and 12.6 fps, p95 interval of 117 to 131 ms, on a link that uses only ~330 kbit/s. Comparison (same firmware, different scenes): Sharp without AI 2 to 9 fps depending on the scene (11 to 37 kB per frame).
- **Delay to the hub (flash as marker):** with AI 0.19 to 0.40 s; without AI 0.16 to 0.25 s (about +60 to 100 ms for the AI).
- **Image:** without JPEG blocks, clean edges and measured sharpness equal to native VGA, but fine textures (carpet, noise) look "painted" (the model is trained on video/anime). PSNR against native VGA is not a good criterion here: the framing changed slightly between captures and the model does not reproduce noise (34.0 dB with AI against 35.5 dB bicubic).
- **Honest limit:** AI does not create detail the camera did not capture; the gain is smoothness and the absence of blocks. Next test: `realesr-general-x4v3` (trained on photos) and a side-by-side comparison in the panel.
- The venv and the model live in `~/k9-superres/` (≈ 380 MB, outside git); the service must be started with `k9_control_hub/superres/start.sh`.

## Real-time profile requested — 29/10/2026

Applied to the real file `src/cam_stable/web_cam_server.h`: XCLK 20 MHz, JPEG q18, QVGA default and CIF maximum (buffers initialised at CIF), two buffers in PSRAM, GRAB_LATEST, grayscale effect 2, lens/gamma off.
Wi-Fi without sleep with an explicit WIFI_PS_NONE call; TCP_NODELAY kept. The legacy stream on Core 0 uses taskYIELD after sending, with no artificial wait; waits remain when there is no client or capture fails. The flashlight starts dim at 10% of the PWM control, keeping the limit and the automatic switch-off.

Added `/capture` on the camera, serialised with the stream by a mutex. The hub exposes `/api/camera/capture` with no cache, with a maximum deadline of 8 s. The panel starts in snapshots, asks for the next one after load, retries after an error in 100 ms and suspends when the tab is hidden. AI stays optional, but is not switched on by an old preference when the panel opens. No promise of zero delay or measured improvement.

Validation: the esp32cam-ota build and 10 video tests passed. Hub suite: 85/86, the only failure pre-existing `unused light controls and shortcut are absent`.

OTA flash completed at 20:37; SHA-256 of the binary: `19d3897eeb8ea6a8aef6d132c20800a807b01d4e1bfe7ecab7ed0a6965796fd3`.
USB identified as FTDI FT232R, `/dev/ttyUSB0`, serial 115200. The serial reading confirmed OV3660, Wi-Fi and servers starting.
Three captures through the hub's new route: 320×240, 2387/2394/2393 bytes, R=G=B in every pixel. Full request times: 3.43/0.24/0.35 s; this measures the request, not sensor→screen latency. The link still oscillates.
