# K9CAM — radio survival mode and diagnostics

Implementation of 29/10/2026 for the ESP32-CAM/OV3660. History of flashes and measurements below; do not attribute the results of one revision to another.

Current profile: **revision 12, 18 MHz, CIF, JPEG 10, sharpness +1**. See the [consolidated technical summary](K9CAM-STABLE-PROFILE.md) and the original examples (private maintainer archive; not part of the software repository). No new benchmarks, as the user requested.

## Complete files

- `k9v2-1_firmware/src/main.cpp`: the project's entry point; with `K9_CAM_ONLY` it includes the camera firmware.
- `k9v2-1_firmware/src/cam_stable/web_cam_server.h`: network, routes, sensor and K9CAM tasks.
- `k9v2-1_firmware/src/cam_stable/radio_diag_config.h`: clock, JPEG quality, power and start-up lighting.
- `k9_control_hub/scripts/diagnose-camera.js`: Node.js diagnostics with no extra dependencies.

## Historical configuration of revisions 2 and 3

| Item | Value |
|---|---|
| XCLK | 16 MHz in revision 2; the macro accepts 10 or 20 MHz for comparison |
| TX | WIFI_POWER_15dBm in revision 2 |
| Wi-Fi | sleep off after connection and at every GOT_IP, checked every second; HT20 |
| Sensor | Revision 3: CIF 400×296, JPEG q12, colour, gamma/lens on, sharpness +1 |
| Buffers | 2 in PSRAM, CAMERA_GRAB_LATEST |
| Lighting | off at start-up to remove one consumption variable; manual control preserved |
| Presets | all three IDs use CIF/q12 in revision 3 |

In revision 3 the OV3660 uses CIF. Sub-QVGA failed in earlier tests of the project. The JPEG size depends on the scene and is not guaranteed by the quality value. A `write` call does not mean a single TCP packet; segmentation, MTU/MSS and retransmissions still exist.

## Concurrency and metrics

`/capture` transfers ownership of a copy of `WiFiClient` to a worker on Core 1. The queue holds a pointer, never a binary copy of the C++ object. A semaphore limits it to one job in total, pending or active; concurrent requests get 503. The shared-socket behaviour and its release by the WebServer was checked on the Arduino-ESP32 2.x version used by `espressif32@6.5.0`. Re-validate that integration if you update the framework.

The worker measures only `esp_camera_fb_get()`, writes the header and then the whole JPEG in a single `client.write` call, checks for a partial send, returns the framebuffer and releases the socket. The legacy MJPEG was also moved to Core 1. There is no busy capture loop on Core 0. The camera/Wi-Fi driver and its interrupts remain under the SDK's control; this does not dedicate a core exclusively to the application.

`/status` and `/health` do not capture images nor wait for the camera mutex. They return RSSI, heap, PSRAM, uptime, profile, radio parameters read from the driver, the configured clock and the last photo's statistics. A short critical section protects only the copy of the counters. The existing UDP commands and telemetry remain compatible.

- `last_fb_get_us`: wait in the API of the last capture; zero may also mean no capture (see `completed`, `failures` and `updated_ms`). It is not the full exposure time, since the driver works with continuous buffers.
- `last_send_us`: time of the header and JPEG write calls; it does not prove that the browser received or drew the image.
- `X-Handler-Us` on `/status`: local preparation of the JSON, before sending over TCP. Target below 5 ms; it does not guarantee the RTT nor include the wait for HTTP service.
- `X-Fb-Get-Us` on `/capture`: a measurement tied to that very photo.
- `X-Frame-Age-Us`: age since the first DMA's timestamp until the header is prepared; it includes neither the transfer nor the drawing on screen.

The status route specifically avoids blocking on the photo's capture/send. Other synchronous legacy routes, such as the log download, can still occupy the WebServer. Do not run them simultaneously when measuring the baseline.

## Build / flash

From the project:

```bash
pio run -d k9v2-1_firmware -e esp32cam
pio run -d k9v2-1_firmware -e esp32cam -t upload --upload-port /dev/ttyUSB0
```

USB identified on this bench: an FTDI FT232R adapter. If the adapter does not control the flashing mode, the ESP32-CAM must be put in download mode with GPIO0/GND and reset. Serial monitor: 115200. Do not run erase_flash: it preserves settings and logs. Local credentials stay in `secrets.h`, outside git; do not publish the binary, which embeds those credentials.

The existing OTA alternative: `./ota.sh cam`. Do not flash the legs board.

## Running the measurement

Close the videos in the panel and other clients before the baseline. After flashing:

```bash
node k9_control_hub/scripts/diagnose-camera.js http://<camera IP> /tmp/k9cam-radio-survival.json
```

Ten sequential requests to `/status`, then ten to `/capture`, straight to the board. Each request has a new TCP connection, TCP_NODELAY and a total deadline of eight seconds. It reports connection, TTFB, total, bytes, RSSI and capture time; it writes the raw data and summaries to JSON. Failures stay out of the percentiles but count in the effective-rate time. The script returns exit code 1 if there are failures or old firmware.

Compare the same tests at 10 and 16 MHz, keeping the scene, lighting, power and position constant. A slow `/status` also points to the network/stack/scheduling, but alone it does not tell antenna, power or interference apart. A slow capture with a low `fb_get` suggests queue/send/transport; a high `fb_get` indicates a wait for the framebuffer, without proving a physical defect of the sensor. To isolate sensor interference you would still need to compare with the camera de-initialised and observe the power with instruments.

## Validation in this revision

- `esp32cam` build: passed.
- Three Node tests: passed, including exactly 10+10 requests, firmware metrics, old firmware, an incomplete JPEG, HTTP 503 and the deadline.
- Firmware flashed over USB with the hash verified. The second transfer at 460800 baud failed; a repeat at 115200 baud completed.
- The initial association deadline was raised from 6.5 to 20 seconds. Serial confirmed the OV3660 sensor initialised, but the connection to the home network did not happen within the deadline; fallback AP Minirobo-K9 at 192.168.4.1.
- The connection was re-established after flashing the revision below; the pending measurement was resolved.
- The AI button and activation were removed from the panel; only direct reception of snapshots remains. Seven interface/video-cycle tests passed.

### Corrected address and measurement — 29/10/2026

The network inventory already assigned the address used by this camera to another camera. The K9CAM got a new address that was absent from the inventory and outside the documented DHCP pool (.100–.199). The prior probe received no answer; that does not guarantee the absence of a powered-off device. The new address was recorded in the inventory.

Firmware flashed over USB at 115200 baud, hash verified; `/status` confirmed `radio-survival-v1`, XCLK 10 MHz, quality 24, sleep off, HT20 and an effective TX of 10.5 dBm. The HT20 configuration was also moved to before `WiFi.begin`, avoiding reconfiguring the width after association. The hub confirmed the camera online and zero viewers during the measurement.

Ten requests per route, new connections, no hub/browser:

| Route | Successes | Median | Mean | Maximum |
| --- | --- | --- | --- | --- |
| /status | 10/10 | 134.3 ms | 145.3 ms | 342.0 ms |
| /capture | 10/10 | 188.3 ms | 292.9 ms | 781.8 ms |

Capture: 3.4 effective FPS, median `fb_get` wait 0.7 ms, JPEG 2408–2413 bytes, RSSI between -43 and -46 dBm. Raw data: `/tmp/k9cam-ip-diagnostics.json`. There is still variation in transport/service; it is not a scene→screen measurement. The old tests at the previous address are not a controlled comparison, because of the conflicting assignment and the simultaneous firmware changes.

Ping done separately after HTTP: 10/10 replies, 0% loss in this sample; RTT min/mean/max 7.0/404.1/1115.7 ms. Loss did not appear in this short test, but the latency variation remains.

### Continuous stream in the panel — 29/10/2026

The panel went back to using `/api/camera/stream`, with a single MJPEG connection shared by the hub. It does not reopen the connection on every `load` event. Hidden tabs release the video; errors wait for the relay's 3-second cooldown; viewers that do not drain the write are disconnected. Explicit TCP_NODELAY on the relay's sockets. Thirteen tests of the relay, page cycle and bar passed. Hub restarted; re-flashing the firmware was not needed, since port 81 already offered a stream.

Sequential measurements, without mixing the diagnostic requests with the stream:

- Direct on port 81: 326 valid JPEGs in 30.02 s, **10.86 FPS**; first frame 92 ms, median interval 75.6 ms, largest interval 1430.9 ms.
- A new sample of 10 snapshots: **13.8 FPS**, mean 72.7 ms, median 61.6 ms; TCP connection between 5.1 and 86.1 ms. Data in `/tmp/k9cam-snapshot-comparison.json`. A short sample does not prove sustained superiority over the stream.
- Through the hub's relay: 319 valid JPEGs in 30.02 s, **10.63 FPS**; first frame 139.8 ms, median interval 77.5 ms, largest interval 1346.1 ms.

The earlier 3.4 FPS corresponded to the inverse of the 292.9 ms mean, not of the 188.3 ms median. These results do not prove a fixed cost of 80–120 ms per socket nor a promise of 20+ FPS. Network variation remains relevant. The count of JPEGs received and the interval between arrivals do not measure scene→screen latency nor guarantee distinct content in every frame.

### Double ping — 29/10/2026

Gateway confirmed by the local route. Two sequential phases of about 30 s, each with 60 pings per destination every 500 ms, camera and gateway in parallel, timestamps recorded. Phase without video: relay inactive, zero viewers and the frame counter stayed at 586. Phase with video: one connection through the relay; the counter ended at 878. The sensor stayed initialised in both phases: without video does not mean DMA/camera off.

| Phase / destination | Median RTT | Mean RTT | Max RTT | Replies |
| --- | --- | --- | --- | --- |
| No video / gateway | 1.18 ms | 1.425 ms | 15.930 ms | 60/60 |
| No video / K9CAM | 26.65 ms | 57.710 ms | 555.647 ms | 60/60 |
| With video / gateway | 1.165 ms | 1.352 ms | 9.065 ms | 60/60 |
| With video / K9CAM | 21.95 ms | 80.945 ms | 793.382 ms | 60/60 |

Stream during the pings: 292 JPEGs in 30.03 s (9.72 FPS), largest interval between images 1263.9 ms. RSSI in the boundary queries between -46 and -49 dBm. Zero losses in the four series. Raw logs and summaries in `/tmp/k9-dual-ping/`.

The peaks occurred only on the camera's path and also without a stream. This weakens the hypothesis of a common PC→gateway delay and does not allow blaming only the video's TCP write. It still does not tell radio/AP→ESP32, scheduling, power or continuous sensor activity apart. Stream peaks are not ICMP peaks. The installed WiFiClient library uses a select of up to 1 s per attempt and send MSG_DONTWAIT; it can hold the sending task and the framebuffer, but that does not imply freezing the whole stack nor determine a fixed RTO of 1–1.5 s. No clock/radio parameter was changed in this test.

### Revision 2 — camera isolation and send deadline

- XCLK 16 MHz and TX 15 dBm; the IP stays the same.
- GOT_IP applies WiFi.setSleep(false) and esp_wifi_set_ps(NONE). The loop queries the driver every second and corrects any unexpected return of sleep. `/status` includes `wifi_ps_result` to tell a valid reading from an error.
- The CamService task, pinned to Core 1, calls esp_camera_init, signals completion to setup and, once the network is ready, runs the stream. `/status` shows setup_core and camera_init_core.
- The installed SDK already configures Arduino setup on Core 1, but its precompiled esp32-camera library uses CONFIG_CAMERA_CORE0. `src/cam_driver_affinity.cpp` and the linker `--wrap=xTaskCreatePinnedToCore` redirect only the creation of `cam_task` to Core 1. The effective affinity read with xTaskGetAffinity appears in camera_driver_core. This adjustment depends on the task's name in the SDK pinned at espressif32@6.5.0 and must be re-validated on upgrades. It does not replace the driver nor affect other tasks' affinity. Core 0 keeps the system tasks; literal exclusivity for Wi-Fi is not promised.
- The stream uses send(MSG_DONTWAIT) and select with an absolute deadline of 150 ms for the frame header, JPEG and trailer, shared among the viewers. TCP_NODELAY and SO_SNDTIMEO 150 ms are also configured. When the deadline/error is exhausted, it closes that viewer's socket and returns the framebuffer: it cannot leave a partial JPEG and continue with the next one on the same connection. The relay reconnects according to its cooldown. It does not guarantee a scene→screen deadline nor eliminate network buffers.
- `/status` adds stream_fb_get_us, stream_send_us, stream_max_send_us, stream_frames and stream_drops. Frames/drops count sends per viewer; max_send includes the closing of failed clients. `last_*` still belongs to snapshots.
- `esp32cam` build passed. A host test running the real extracted function verified a complete send, an already-expired deadline and a saturated socket: return by deadline at 150071 us. That test verifies the algorithm, not the real ESP32 scheduling.
- SHA-256 of the final binary: `79f5342c31287e3a13de8ecd1c3a7c83672b1c7d64778d6604dfc95c29d6d087`.

#### Validation on the board — final revision 2

USB flash completed with the hash verified. `/status` confirmed revision=2, setup_core=1, camera_init_core=1, camera_driver_core=1, stream_core=1, xclk_hz=16000000, wifi_ps=0 and wifi_ps_result=0. Requested power WIFI_POWER_15dBm; the driver reported **13.75 dBm** in this run. Do not confuse the requested value with the effective reading. RSSI about -46 dBm.

Repeated 60 pings per destination/phase, gateway and camera simultaneously, without video and with video. Sensor initialised in both phases.

| Phase / destination | Mean RTT | Max RTT | Replies |
| --- | --- | --- | --- |
| No video / gateway | 1.152 ms | 1.247 ms | 60/60 |
| No video / K9CAM | 5.132 ms | 23.662 ms | 60/60 |
| With video / gateway | 1.325 ms | 10.597 ms | 60/60 |
| With video / K9CAM | 7.214 ms | 46.926 ms | 59/60 |

Stream through the hub: 533 valid JPEGs in 30.023 s, **17.75 FPS**, first frame 71.6 ms, median interval 56.4 ms and maximum **80.9 ms**. There was no premature end of the stream. At the end, the firmware reported stream_max_send_us=12007 (12.0 ms), stream_fb_get_us=46168 (last wait, not a mean) and stream_send_us=11922. stream_drops=1 after the test client closed the connection; that counter mixes socket errors and deadlines and does not prove a drop due to the 150 ms. One ping was lost in the video phase (1/60), which must be reported even with the latency gain.

In the previous comparison, idle had a mean of 57.7 ms/maximum 555.6 ms; the stream reached 9.72 FPS and a maximum interval of 1263.9 ms. There was an improvement in this short sample, but the simultaneous changes do not isolate causality and the test guarantees neither prolonged stability nor scene→screen latency. Raw data preserved in `docs/diagnostics/k9cam-radio-v2-2026-10-29.json`.

### Revision 3 — image quality

Request applied: JPEG 12, CIF 400×296, set_special_effect(0) for colour, set_raw_gma(1), set_lenc(1) and set_sharpness(1). Kept XCLK 16 MHz, the camera's affinity on Core 1, power save off, the 15 dBm TX setting and the 150 ms send deadline. The endpoint includes the sensor's effective values in sensor_framesize, sensor_quality, special_effect, raw_gma, lenc and sharpness. The three presets use the same image profile to avoid accidental reversion during the measurement.

`esp32cam` build passed; firmware flashed over USB with the hash verified. SHA-256: `d43a32d06092c20bea8fbf1575b967bbf4997ed3d5b8d1cfe39785c1011a0eb6`. `/status` confirmed revision=3, quality=12, framesize=6 (CIF), effect=0, gamma=1, lenc=1 and sharpness=1.

In the no-video phase the hub had to be switched off temporarily, because there was an active viewer in a tab unavailable to automation. This also removes the hub's discovery traffic: it is a methodological difference from the revision 2 test, which kept the hub active with no viewers. The video phase uses the hub again.

#### Result and the single profile adopted

The user tested the image in the browser and approved it visually. The Fast/Balanced/Sharp selector was removed from the panel, along with the preset-sending handlers: they were identical during the diagnostics. Single profile adopted: CIF 400×296, JPEG 12, colour, gamma/lens on and sharpness +1. Legacy preset commands stay compatible in the firmware, but all use that same profile. Seven panel/video-cycle tests passed; the served HTML was confirmed to have no selector. A photo received and decoded confirmed 400×296 RGB.

| Phase / destination | Mean RTT | Max RTT | Replies |
| --- | --- | --- | --- |
| No video / gateway | 1.138 ms | 1.236 ms | 60/60 |
| No video / K9CAM | 5.577 ms | 17.557 ms | 60/60 |
| With video / gateway | 1.145 ms | 1.260 ms | 60/60 |
| With video / K9CAM | 4.939 ms | 17.734 ms | 60/60 |

Stream through the hub: 521 JPEGs in 30.024 s, **17.35 FPS**, first frame 98.9 ms, median interval 56.7 ms and maximum **220.2 ms**; mean JPEG 9052 bytes. Before, revision 2 delivered 17.75 FPS, mean JPEG 3475 bytes and a maximum interval of 80.9 ms. Network/scene vary and this is not a controlled laboratory comparison. There was no ICMP loss in the four new series. `/status` kept wifi_ps=0 and camera_driver_core=1; stream_drops=0. stream_max_send_us=70776 is cumulative since boot, including the preview the user opened before the test, so do not attribute that maximum only to the 30 s window. Effective power reported in this start-up: 14.75 dBm for the WIFI_POWER_15dBm setting.

Raw data: `docs/diagnostics/k9cam-radio-v3-2026-10-29.json`. Hub switched back on after the idle phase; panel and video available. The hub did not need a restart to serve the selector's removal (static HTML).

### Revision 4 — 20 MHz and JPEG 10

Requested values applied: XCLK 20 MHz, JPEG 10, CIF 400×296, two framebuffers in PSRAM, CAMERA_GRAB_LATEST; colour image with gamma, lens, DCW, BPC and WPC on, sharpness 2, denoise 1 and set_gainceiling((gainceiling_t)2). Preserved: single profile with no selector, initialisation/internal task/stream on Core 1, power save off, TX configured at 15 dBm and the 150 ms send deadline. `/status` exposes the additional DSP states.

`esp32cam` build passed. SHA-256 of the binary: `7657917b4b079e5983335598204f3f170a55bd4ae5c42d34cc8f3e8f7319a547`. Do not infer beforehand an FPS gain nor that the gain ceiling forces a lower exposure: measure the board.

#### Revision 4 result: regression

USB flashed with the hash verified and `/status` confirmed all requested settings (revision=4, 20 MHz/q10, sharpness=2, denoise=1, dcw/bpc/wpc=1, gainceiling=2, Core 1 and wifi_ps=0). The first stream access received HTTP 503 during the reconnection cooldown after the reboot; attempt excluded. A new attempt after readiness received one frame and was interrupted. So a full 30-second window with reconnections was measured, also counting the unavailability.

30.000 s window: **1 valid JPEG**, **0.033 effective FPS**, 5453 bytes in that single frame (an insufficient sample for a representative mean size). Three interrupted connections; interval between frames cannot be calculated, since there was only one frame. It ended with 14.24 s without a new frame since that single image. Simultaneous ping: gateway 60/60, mean 1.198 ms, maximum 1.616 ms; camera 43/60, loss 28.33%, mean 2246.595 ms and maximum 7213.645 ms. The status reading at the end timed out after 4 s; do not omit that failure.

Before that window, the counters already showed a local send wait of about 153 ms and streams closed by the deadline. The scheduling tolerance explains slightly exceeding the programmed 150 ms; it does not limit end-to-end TCP latency. Do not conclude that the clock is the sole cause: clock, quality and DSP changed together. Full data in `docs/diagnostics/k9cam-radio-v4-2026-10-29.json`.

To preserve the working single profile the user already approved, revision 5 restores the image settings of revision 3: 16 MHz/CIF/q12, colour/gamma/lens, sharpness=1, without overriding denoise/DCW/BPC/WPC/gainceiling beyond the sensor's initialisation defaults. Additional diagnostic fields stay available. Recovery result below.

### Revisions 5–7 — recovery and a restricted test

Revision 5 restored the image parameters of the good profile, but the first start-up after the upload showed camera_ready=false and camera_driver_core=-1. It was not validated as a recovery. Before new tests, the user reiterated to document/keep the good profile and then explicitly asked to test only 20 MHz/JPEG 10, without the additional DSP overrides.

Revision 6 applied only that pair of changes over revision 3's profile, keeping sharpness 1 and the driver's denoise/gain defaults. Build and USB passed; SHA-256 `07d135328a548d8a102665e6f03506af2b7ec77afc7b9accec2b354699011942`. Normal start-up confirmed, camera_driver_core=1, wifi_ps=0, denoise=0 and gainceiling=248. The stream was aborted after 0.280 s without any complete JPEG; there is no sustained FPS, mean size or interval between valid images to report for this attempt. The pings continued through the window of about 30 s: camera 58/60 (3.33% loss), mean 795.635 ms, maximum 2712.976 ms; gateway 60/60, mean 1.283 ms, maximum 7.108 ms. So do not call that 30 s phase active video: the video attempt ended early. The firmware reported stream_frames=0, stream_drops=1, stream_max_send_us=150738. Data in `diagnostics/k9cam-radio-v6-2026-10-29.json`.

Since the 20 MHz/JPEG 10 pair did not sustain video, revision 7 again restores 16 MHz/JPEG 12 to fulfil the request to keep the good profile active. Reference documented in `K9CAM-STABLE-PROFILE.md`. No other FPS optimisation will be done in this recovery; validate real video before declaring success.

### Revision 8 — applied for the user's personal test

On 29/10/2026, on a new explicit request, only XCLK 20 MHz and JPEG 10 were applied over the restored profile, keeping CIF 400×296, two buffers in PSRAM, CAMERA_GRAB_LATEST, colour/gamma/lens, sharpness 1 and Core 1. No extra DSP override. The diagnostics revision incremented to 8.

Build passed; USB flash completed with the hash verified and a hard reset. SHA-256 `508be4cd887b566431f09e526d394a34dbab5139c641116e7ff2c08f2fd9de07`. As the user instructed, NO video, FPS, ping or benchmark tests were run after this application. Practical evaluation is the user's; do not declare stability or FPS gain without that feedback. The 16 MHz/JPEG 12 reference preserved in K9CAM-STABLE-PROFILE.md.

### Revision 10 approved; revision 11 requested

On 29/10/2026 the user personally approved 18 MHz/JPEG 10: "It looks good, it's working well". No automatic measurements. Reference and recovery path recorded in K9CAM-STABLE-PROFILE.md.

Next they asked to keep clock/resolution/JPEG and apply only DSP: special_effect=0, raw_gma=1, lenc=1, dcw=1, bpc=1, wpc=1, sharpness=2, denoise=1 and gainceiling=(gainceiling_t)2. Do not attribute beforehand an FPS or exposure improvement to the gain ceiling. Visual validation is the user's, as requested.

Revision 11: `esp32cam` build completed and USB upload finished with the hash verified. SHA-256 `e202d0f1f814383a931f112bed74a0c2cbecfb6ef2ae644c3437b332cf97beb4`. 18 MHz/JPEG 10/CIF kept. No performance or video tests: personal validation by the user, as agreed.

### Revision 12 — return to the approved profile and a visual example

The user rejected revision 11's image ("It looks bad, go back") and supplied a screenshot. Original preserved in `camera-examples/2026-10-29-rev11-dsp-escura.png`, the exact configuration in `camera-examples/2026-10-29-rev11-config.json` and an index of the examples in `camera-examples/README.md`. A very dark screenshot, with lost detail in the shadows; no causal conclusion about an isolated adjustment. No approved reference screenshot was invented that has not been supplied yet.

Revision 12 restores revision 10's image configuration: 18 MHz/JPEG 10/CIF, colour/gamma/lens, sharpness=1, the additional denoise/gainceiling/DCW/BPC/WPC overrides removed. Core 1 affinity, PSRAM buffers and latest mode kept. Build passed, USB flashed and hash verified. SHA-256 `01ff03b190eaa31856f2b98cff401b8546a5d71ec561719d9401fbf44a123396`. No automatic benchmarks or video tests, per the user's preference.
