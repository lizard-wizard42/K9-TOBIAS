# K9CAM — approved stable reference

## Consolidated active configuration — revision 12

| Parameter | Flashed configuration |
| --- | --- |
| Hardware / address | ESP32-CAM, OV3660, `<camera IP>` |
| XCLK / format | 18,000,000 Hz / native JPEG |
| Resolution / quality | CIF 400×296 / JPEG 10 |
| Framebuffers | 2 in PSRAM, `CAMERA_GRAB_LATEST` |
| Colour / sharpness | `special_effect=0` / `sharpness=1` |
| Gamma / lens | `raw_gma=1` / `lenc=1` |
| Other DSP | DCW, BPC, WPC, denoise and gainceiling with no explicit override; driver defaults |
| Affinity | Camera initialisation, the internal `cam_task` and the stream on Core 1 |
| Radio | Sleep off after GOT_IP and checked periodically; HT20 |
| Requested TX | `WIFI_POWER_15dBm`; the effective value depends on the driver |
| Transport | MJPEG shared by the hub, TCP_NODELAY, 150 ms send deadline; closes the connection on a partial send |
| Lighting | LED off at start-up; manual control available |
| Panel | Single profile, no quality selector and no "Enhance with AI" button |

**Current evidence:** original screenshot of revision 12 and comparison with the rejected revision 11 (private maintainer archive; not part of the software repository); parameters and hashes in JSON (private maintainer archive; not part of the software repository).

**Validation:** build and USB flash completed, flash hash verified in the history. The user judges the image personally. There is no new measurement of FPS, latency or average JPEG size for 18 MHz; the 16 MHz results below are historical. The screenshot does not demonstrate the sensor's internal parameters nor measure performance.

**Procedure from here on:** keep this profile; small changes only when requested. At the user's later request, do not run automatic camera/network benchmarks; the user tests personally. Do not re-flash for a documentation update.

**Sources:** `k9v2-1_firmware/src/cam_stable/radio_diag_config.h`, `src/cam_stable/web_cam_server.h` and `src/cam_driver_affinity.cpp`. The `src/web_cam_server.h` header is not the camera's active firmware. Build in the `esp32cam` environment; USB FTDI `/dev/ttyUSB0`, baud 115200. Do not version `secrets.h` or binaries that contain credentials.

## Latest reference approved by the user — 29/10/2026

**Revision 10: 18 MHz, JPEG 10, CIF 400×296, colour, gamma and lens on, sharpness +1.** Two buffers in PSRAM, CAMERA_GRAB_LATEST, camera on Core 1, Wi-Fi without sleep and a single profile with no selector. Denoise and gain ceiling with no additional overrides in this revision.

The user tested personally and reported: "It looks good, it's working well". This approval is visual/by use; FPS, ping or latency were not measured in this configuration. Firmware flashed over USB with the hash verified: `dc536dd9524ff341b1d0cd5bdecf2e417e9cd8aab6cf4d8b01d43b0f6b21581c`.

Revision 11 (sharpness 2, denoise 1 and gainceiling 2) was **rejected by the user**: the image was too dark. The original screenshot and the full configuration (private maintainer archive; not part of the software repository) are archived. Revision 12 restores the approved profile above, removing the additional DSP overrides and returning sharpness to +1, without changing 18 MHz/JPEG 10/CIF.

---


Reference validated on 29/10/2026, revision 3, OV3660 camera. This is a historical profile; the current configuration is revision 12, described above.

- XCLK: **16 MHz**.
- Resolution: **CIF, 400×296**.
- JPEG: **12**.
- Colour, gamma and lens correction on, sharpness **+1**.
- Denoise, DCW, BPC, WPC and gain ceiling: driver defaults in this reference, with no extra overrides.
- Two framebuffers in PSRAM, CAMERA_GRAB_LATEST.
- Initialisation, the internal cam_task and the stream on Core 1; power save NONE with periodic checking.
- Requested TX 15 dBm; HT20. The effective TX reading may differ from the requested one.
- Stream shared by the hub, 150 ms send deadline; a partial connection is closed. Single profile, no selector in the panel.

Result: 521 valid images in 30.024 s (**17.35 FPS**), average JPEG **9052 bytes**, maximum interval **220.2 ms**. Simultaneous ping with video: average **4.939 ms**, maximum **17.734 ms**, 60/60 replies. The user approved the image in the browser. Raw data: diagnostics/k9cam-radio-v3-2026-10-29.json. This is evidence from a short sample, not a long-term guarantee.

To restore the profile: set K9_CAM_XCLK_HZ=16000000, K9_CAM_JPEG_QUALITY=12, K9_CAM_FRAME_SIZE=FRAMESIZE_CIF; post-init special_effect=0, raw_gma=1, lenc=1 and sharpness=1, without the DSP overrides of revision 4. Build esp32cam, flash only the camera and confirm camera_ready and the parameters through /status before measuring video.

Historical rule, later replaced by the request for personal testing: preserve this reference, test small changes and measure before adopting them. The specific experiment authorised next changes only the clock to 20 MHz and JPEG to 10, keeping the rest of the reference. That is two variables by explicit request; the result does not isolate each one.

## History: attempt to restore revision 7

Revision 7 flashed over USB and parameters confirmed (16 MHz, CIF, JPEG 12, Core 1, wifi_ps=0), but the recovery still did NOT reproduce revision 3's approved result: the first stream received 19 images in 1.707 s before cutting off at the send deadline; the window's ping had an average of 41.044 ms, maximum 261.508 ms, 60/60 replies. Do not present the configured profile as a validated recovery. SHA-256 of revision 7: `58feb3a91195587eb962dad9aa881dd8a4f7c3b8e6fcc5bc3e959947cf42e181`. Data: diagnostics/k9cam-radio-v7-2026-10-29.json.

## Latest flashed configuration

**Revision 12: approved profile restored — 18 MHz/JPEG 10/CIF, colour, gamma/lens on and sharpness +1.** The extra DSP overrides of revision 11 removed. Build and USB flash completed with the hash verified. SHA-256 `01ff03b190eaa31856f2b98cff401b8546a5d71ec561719d9401fbf44a123396`. Personal validation by the user; no automated video tests. The historical 16 MHz/JPEG 12 reference stays above only as history.
