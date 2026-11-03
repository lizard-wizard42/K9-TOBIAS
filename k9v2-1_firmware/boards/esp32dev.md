# Legs — ESP32 DevKit

Firmware **1.7.0-public.1**. Four positional MG90S servos, Wi-Fi commands and speaker.

| Signal | GPIO |
| --- | --- |
| Front left (FL) | 14 |
| Front right (FR) | 15 |
| Rear left (RL) | 13 |
| Rear right (RR) | 2 |
| Speaker driver control | 25 |

Speaker control goes through the 220 Ω resistor and TIP41C driver, not directly to a speaker terminal. See [the audio circuit](../../docs/AUDIO.md). Servo power requires a suitable regulated supply and common ground.

From `k9v2-1_firmware/`, after creating `src/secrets.h`:

```bash
pio run -e esp32dev                     # build
# FIRST installation only, with the new board connected over USB:
pio run -e esp32dev -t upload --upload-port <USB_PORT>
```

Build output: `.pio/build/esp32dev/firmware.bin`. It is private if built with your credentials. Network update target: `esp32dev-ota`; see [OTA prerequisites](../README.md#ota-updates). The usual hostname is `k9.local`.

Check `/status` for `firmwareVersion: 1.7.0-public.1` and hub telemetry after installation. Support the robot when centering and attaching the legs. Commanded zero does not prove physical zero because these servos have no position feedback.
