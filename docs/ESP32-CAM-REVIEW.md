# ESP32-CAM — stability and open source review

Review of 25/10/2026. Hardware: AI-Thinker ESP32-CAM/OV2640, a separate board from the legs. A targeted survey of the main drivers, firmwares and streaming solutions; not an inventory of all existing repositories.

## Local evidence

After a manual reboot of the camera, a residual Chrome connection still existed. After it went away, four pings had 0% loss, average 40.5 ms (3.2–97.4 ms). `/status` answered as K9CAM, with RSSI −58 dBm. This proves recovery at that moment; it does not by itself identify the original cause nor rule out mesh problems.

The stable firmware allows three direct viewers. The history already recorded latency rising with more than one viewer. The panel also had a demonstrable flaw: the error timer reopened the stream even in a hidden tab, and `pagehide` did not explicitly close the video.

## Sources examined and decisions

| Primary source | Contribution to the K9 | Decision |
|---|---|---|
| [Espressif esp32-camera](https://github.com/espressif/esp32-camera) | JPEG reduces memory/Wi-Fi pressure; multiple buffers raise load and throughput; PSRAM and capture modes | Keep the JPEG, PSRAM, two buffers and CAMERA_GRAB_LATEST already present. Do not change clocks, resolution or buffers together with the connection fix. |
| [Espressif CameraWebServer](https://github.com/espressif/arduino-esp32/blob/master/libraries/ESP32/examples/Camera/CameraWebServer/app_httpd.cpp) | Official reference for MJPEG and the buffer acquire/release cycle | Use as a reference, without replacing the K9's stable server entirely. |
| [ESPHome Camera Web Server](https://esphome.io/components/esp32_camera_web_server/) and [Camera](https://esphome.io/components/esp32_camera/) | Video server and frame-rate/idle controls | Adopt on-demand streaming in the hub. An FPS limit in the firmware stays as a separate experiment if a single connection still saturates the network. |
| [s60sc/ESP32-CAM_MJPEG2SD](https://github.com/s60sc/ESP32-CAM_MJPEG2SD) | Recording, RTSP, telemetry and integration; the project itself describes the ESP32's memory limits | Do not migrate firmware: an SD card is not part of the K9, and adding recording/audio/detection would raise the load. |
| [geeksville/Micro-RTSP](https://github.com/geeksville/Micro-RTSP) | RTSP for small devices, paced sending | Reserve for a future NVR/VLC integration. The current panel already uses MJPEG; changing protocol does not by itself solve multiple connections. |
| [AlexxIT/go2rtc HTTP](https://github.com/AlexxIT/go2rtc/blob/master/internal/http/README.md) | External server able to consume HTTP-MJPEG | Centralise video outside the board. A small relay was implemented in the existing Node hub, with no extra service/dependency. go2rtc remains an option if other protocols are really needed. |

The relay code was written for this project; no code was copied from those repositories. There was no change of Arduino core, camera libraries or firmware.

## Applied

- `/api/camera/stream`: one HTTP connection to the camera serves up to eight hub viewers. GET only; honours `HUB_TOKEN`.
- Complete frames are distributed with their own boundary; new viewers do not join in the middle of a JPEG. No transcoding.
- Limits: JPEG up to 1 MiB, bounded headers/buffer, eight seconds without a complete frame close the connection, a three-second pause after a failure. Slow clients are disconnected before they accumulate another frame.
- Last viewer left: the connection to the camera is destroyed immediately. No autonomous hub reconnection without demand.
- The panel uses the hub's endpoint; hidden tabs cancel video and pending retries. `pagehide` suspends and `pageshow` restores. Retries after an error use 3, 6, 12, 24 and at most 30 seconds.
- `/api/camera/status`: camera presence, the camera's own IP, RSSI and uptime, viewers, upstream connection, frame counter, last frame/error and slow clients. The panel's earlier indicators came from the legs and were not proof of the camera's health.

Opening `http://CAMERA_IP:81/stream` directly still bypasses the sharing. Use the hub's panel and refresh old tabs to load the new code.

## Validation

- Automated tests with a simulated HTTP camera: three viewers/one connection, the last viewer closes the camera, a stuck camera, waiting after a failure, invalid size, viewer limit, EOF/recovery and a slow client.
- Panel regressions: hidden tab, retry cancellation, pagehide/pageshow, token on the endpoint and a bounded growing interval.
- Isolated browser at 1440×1000, 390×844 and 844×390: no overflow or JavaScript errors; no connection to the robot in these tests.
- Real 12-second test: three HTTP consumers received the same 17 frames (113,069 bytes per consumer); the operating system showed one Node → camera:81 connection. No relay error or reboot observed; uptime advanced from 725 to 738 seconds. Afterwards: zero viewers and no upstream connection. ECONNRESET on the clients was caused by the test's intentional shutdown.
- The real test verifies sharing and shutdown; it is not an extended soak. The observed rate was about 1.4 frames/s on the existing preset (Sharp). No comparative quality/FPS benchmark was done.

## Limits and next diagnosis

If it fails again, check `/api/camera/status` before rebooting. Tell UDP presence (`online`), actual image reception (`lastFrameAt`, `frames`) and the number of viewers apart. No images with UDP present suggests investigating capture/transmission; the absence of both requires serial/network observation. These are diagnostic hypotheses, not an automatic identification of the cause.

Keep the tag `cam-estavel-b363214` and the header `src/cam_stable/web_cam_server.h` as the reference. The experimental header had recorded failures; it was not re-enabled. Earlier mesh, gait and power fixes were not reverted.
