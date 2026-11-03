# Contributing to K9

Thanks for helping! This is a hobby robotics project (firmware, hub/panel, Android app, 3D-printable body). Small, focused pull requests are easiest to review.

## Ground rules

- **Language:** code identifiers and comments may be in Portuguese or English, and new public documentation, commit messages, issues and pull requests should be in English. The interface itself is multilingual — see [`docs/I18N.md`](./docs/I18N.md) for how to add or fix a translation.
- **No secrets or personal data** (Wi‑Fi credentials, API keys, MAC addresses, home paths, photos of people). See [`SECURITY.md`](./SECURITY.md).
- **Safety first:** the robot moves. Anything that touches walking, servos, calibration or the stop path needs a test and a note on how you verified it. "Stop" must always win.
- Be honest in documentation: mark what was **measured**, what was **calculated** and what is an **assumption**.

## Setup

```bash
git clone <your fork>
cd k9_control_hub && npm install && npm test     # hub + panel tests
cd ../k9_vivo     && npm install && npm test     # voice/AI gateway tests
cd ../k9v2-1_firmware && cp src/secrets.example.h src/secrets.h   # then edit it
pio run -e esp32dev                                              # needs PlatformIO
```

## Workflow

1. Open an issue (or comment on one) describing the change.
2. Branch from `main`: `feat/…`, `fix/…`, `docs/…`.
3. Write the test first when you can; keep functions small and files focused.
4. Make sure `npm test` passes in `k9_control_hub` and `k9_vivo`, and that firmware still builds (`pio run -e esp32dev -e esp32cam`).
5. Use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
6. Open a pull request describing what changed, how you tested it and any hardware you used.

## Hardware models

The GitHub repository is software-only. STL, 3MF and Blender/CAD files are maintained separately for MakerWorld. Do not add model archives or private design history to a code pull request. Report fit and printing issues with the tested revision, printer, material and nozzle. Model commercial permissions are separate from the software license; see [printing](docs/PRINTING.md).

## Licence

Contribute only material you have permission to share. Original contributions use the project license (see [`LICENSE`](./LICENSE)); do not submit upstream restricted code under MIT. Third-party material keeps its own licence — see [`THIRD_PARTY.md`](./THIRD_PARTY.md).

## Start here

1. Fork <https://github.com/lizard-wizard42/K9-TOBIAS> and branch from `main`.
2. Read the board guide before changing firmware; the two ESP32 targets serve different hardware.
3. Run the applicable tests and describe the actual result in your PR. CI runs the panel, voice and native motion/audio tests.
4. Never upload credentials, personal binaries, STL/3MF/Blender assets or old private history.
5. Firmware changes must distinguish compile-only checks from physical tests. Maintainers must explicitly decide whether to flash; CI never performs OTA.

Use the issue templates for reproducible bugs and feature proposals. The PR template records behavior, validation, licensing and hardware impact. Never include passwords, tokens, MAC inventories or home paths in reports.
