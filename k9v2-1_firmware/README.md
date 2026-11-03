# K9 firmware — two boards, one source project

The current MK5 uses a **plain ESP32 DevKit for the legs** and a separate **AI-Thinker ESP32-CAM for video and light**. This folder includes both complete firmware targets; shared source is kept once to avoid divergent copies.

| Target | Board | Version | Job | Guide |
| --- | --- | --- | --- | --- |
| `esp32dev` | ESP32 DevKit | 1.7.0-public.1 | Four MG90S servos and GPIO25 speaker | [Legs](boards/esp32dev.md) |
| `esp32cam` | AI-Thinker ESP32-CAM | 1.0.14 | Camera, flashlight and strobe | [Camera](boards/esp32cam.md) |

## Configure and build

Copy `src/secrets.example.h` to `src/secrets.h`, set your own 2.4 GHz Wi-Fi credentials and unique `K9_AP_PASS`/`K9_OTA_PASS`, then run from this folder:

```bash
pio run -e esp32dev
pio run -e esp32cam
```

These commands **only compile**. Running `pio run` with no target builds these two current boards. Both use `partitions_k9.csv`. Board selection and compilation flags are in `platformio.ini`.

- Shared entry point: `src/main.cpp`.
- Legs network/audio: `src/web_cam_server.h`, `src/speaker.h`.
- Camera network/video: `src/cam_stable/web_cam_server.h`.
- Motion: `src/gait_core.h`, `src/personality_motion.h`.
- Independent version strings: `src/firmware_version.h`.
- Native tests: `bash test/run.sh` (GCC/G++, no board required).

## First installation

A new board requires an initial USB installation with the correct partition table. Select the guide for the actual board and connect only the intended target. Do not load the camera image on the servo board or vice versa.

## OTA updates

OTA requires a matching firmware and partition layout already installed, working network access and the same OTA password used in the installed build. The root `ota.sh` selects `esp32dev-ota` or `esp32cam-ota`.

On the maintainer's assembled robot, USB access is no longer available. Preserve its current network configuration, partition layout and OTA implementation. Always compile first and verify version and communication after an update. Do not use publishing/release preparation as a reason to flash either board.

**Do not distribute a `.bin` built with personal `secrets.h`: credentials can be embedded in firmware binaries.** Public source archives include the configuration example, never `secrets.h`, `.pio/`, logs or personal binary builds.

## Legacy targets

`esp32-c3-supermini`, `tune`, `trim` and their OTA variants belong to the older ESP32-C3/gamepad setup. They remain in the source project for reference; their pin assignments and instructions do not apply to the two-board MK5.

## Upstream code

Parts of the entry point and gait code originate from miniRobo K9V2.1. See [third-party provenance](../THIRD_PARTY.md) before redistribution or relicensing.
