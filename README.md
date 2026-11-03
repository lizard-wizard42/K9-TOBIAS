# K9-TOBIAS

Software for Tobias (K9 MK5), a DIY, four-servo robot dog: two ESP32 firmwares, a Wi-Fi control panel, and optional voice control.

**Hardware status:** the latest MK5 revision has been printed, assembled and tested, as confirmed by the project owner on 3 November 2026. The public legs source is **1.7.0-public.1**; the camera source is **1.0.14**. The assembled robot was tested with the private 1.7.0 legs build. The public audio-only variation has compile/native-test validation; it has not been flashed during publication.

## Giving Tobias a little more life

I am developing **AI-assisted control** to give Tobias more personality and richer interaction. The current robot has browser controls, camera video, sounds and scripted emotions; the optional Vivo voice/AI layer is experimental. Broader autonomy and camera-based behavior are ongoing work, not finished features.

Want to help? Contributions in behavior, vision, voice, motion reliability, dashboard UX, tests and documentation are welcome. Read the [AI roadmap](docs/AI-ROADMAP.md) and [contribution guide](CONTRIBUTING.md), then propose a focused issue or pull request. You can contribute without owning the robot; identify simulated and physical validation separately.

[Watch the build](https://youtu.be/sWIoWc-5ltM) · [Project page](https://www.lizardwizard.io/tobias-mk5/)

## Inspiration and original base

Tobias was inspired by the robots from **[miniRobo](https://minirobo.io/)**. I used its **[K9V2.1 model](https://www.minirobo.io/projects/k9v2-1)** as the starting point for this build, then developed the Tobias MK5 body changes, dual-board ESP32 integration, web control panel, sounds, emotions and optional voice features.

Credit for the original K9V2.1 design and the firmware/gait portions adapted from it belongs to miniRobo. This is an independent adaptation, not an official miniRobo release or an endorsement. See [THIRD_PARTY.md](THIRD_PARTY.md) for the origin and license boundaries.

## Get the files

| You need | Where |
| --- | --- |
| Legs firmware — ESP32 DevKit | [Board guide](k9v2-1_firmware/boards/esp32dev.md) · PlatformIO target `esp32dev` |
| Camera firmware — AI-Thinker ESP32-CAM | [Board guide](k9v2-1_firmware/boards/esp32cam.md) · PlatformIO target `esp32cam` |
| Web control panel and local hub | [k9_control_hub/](k9_control_hub/) |
| Optional voice/AI control and Android app | [k9_vivo/](k9_vivo/) |
| Printable parts, 3MF projects and model terms | [Tobias MK5 on MakerWorld](https://makerworld.com/pt/models/3541274-tobias-mk5-esp32-walking-robot-camera) — 25 STLs and six-plate Bambu A1 profile. See [hardware and printing](docs/PRINTING.md) |
| Wiring and bill of materials | [Hardware notes](docs/hardware/README.md) · [BOM](docs/hardware/BILL-OF-MATERIALS.md) |
| Documentation | [docs/README.md](docs/README.md) |

**This repository contains software. STL, 3MF, Blender/CAD files, private design history and promotional media are not distributed here.** Model downloads and commercial-print permissions belong to the MakerWorld listing. Software licensing does not grant rights to the separate 3D designs.

## The two boards

| Board | Job | Firmware | Hardware |
| --- | --- | --- | --- |
| ESP32 DevKit | Four MG90S servos, speaker, movement, poses and emotions | `1.7.0-public.1` | FL GPIO14 · FR GPIO15 · RL GPIO13 · RR GPIO2 · speaker control GPIO25 |
| AI-Thinker ESP32-CAM | Camera, flashlight and strobe | `1.0.14` | On-board LED GPIO4; no servos on this board |

Both boards and the hub use the same 2.4 GHz Wi-Fi network. The hub discovers the boards over the local network. The interface supports Portuguese, English, Spanish, French, German and Chinese.

## Build the firmware

Install [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation/index.html), then create your local configuration:

```bash
cp k9v2-1_firmware/src/secrets.example.h k9v2-1_firmware/src/secrets.h
```

Edit `secrets.h` with your Wi-Fi credentials and unique AP/OTA passwords. It is ignored by Git. From `k9v2-1_firmware/`:

```bash
pio run -e esp32dev     # legs: build only
pio run -e esp32cam     # camera: build only
```

The shared project contains **both firmwares**. The camera target selects `src/cam_stable/web_cam_server.h`; the legs target uses `src/web_cam_server.h`. Do not interchange their build outputs. The C3/gamepad targets are legacy builds and are not the MK5 setup.

A first installation needs USB to install the matching partition layout. See the board guides for first-flash commands and OTA prerequisites. [OTA guidance](k9v2-1_firmware/README.md#ota-updates) explains why personal build outputs must not be shared: they can contain Wi-Fi and OTA credentials.

## Run the panel

Use Node.js 20 or later:

```bash
cd k9_control_hub
npm ci
npm start
```

Open `http://localhost:3080` on the computer or `http://<COMPUTER_IP>:3080` on a phone on the same network. Optional configuration is documented in [.env.example](.env.example). The panel offers movement controls, poses, actions, animations, sounds, emotions, favorites, sequences and an optional idle personality. See [the interface guide](docs/INTERFACE-EXPERIENCE.md).

Voice/AI control is optional: [Vivo setup](docs/VIVO.md). Cloud AI is off by default.

## Checks

```bash
(cd k9_control_hub && npm ci && npm test)
(cd k9_vivo && npm ci && npm test)
bash k9v2-1_firmware/test/run.sh
```

The native firmware checks need GCC and G++. They do not send commands to the robot. Firmware builds above do not upload anything.

## Hardware and operation

MG90S servos are positional servos; they do not provide position feedback. Support the robot when centering or testing the legs. Use regulated supplies and a common ground; the speaker driver uses a TIP41C and a 220 Ω base resistor. See [audio and wiring](docs/AUDIO.md) for the documented circuit.

The project is designed for a trusted local network. Do not expose the hub or boards directly to the internet; see [SECURITY.md](SECURITY.md).

## License and credits

Original project code and documentation are under [LICENSE](LICENSE). Adapted miniRobo firmware remains subject to its original personal/non-commercial terms and is **not relicensed under MIT**. This public source release is not a blanket grant of commercial rights to upstream work. See [THIRD_PARTY.md](THIRD_PARTY.md) and the original [miniRobo terms](https://www.minirobo.io/terms).

The public edition uses four original short sound motifs (Pulse, Lunar March, Arcade and Cosmos). Named third-party song transcriptions from the private build are excluded. No personal firmware binaries are distributed.

The 3D designs are distributed separately through MakerWorld. This software repository does not grant model rights or commercial-print rights. Upstream rights also apply to derivative mechanical work; the separate model listing/membership must respect them.
