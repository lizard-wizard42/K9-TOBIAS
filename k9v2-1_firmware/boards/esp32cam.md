# Camera — AI-Thinker ESP32-CAM

Firmware **1.0.14**. Video, flashlight and strobe only. No servos on this board.

- Build target: `esp32cam`.
- Stable camera/network implementation: `src/cam_stable/web_cam_server.h`.
- On-board white LED: GPIO4; the SD card is not used.
- Usual hostname: `k9cam.local`.

From `k9v2-1_firmware/`, after creating `src/secrets.h`:

```bash
pio run -e esp32cam                     # build
# FIRST installation only, with the new board connected over USB/UART:
pio run -e esp32cam -t upload --upload-port <USB_SERIAL_PORT>
```

For the initial installation, use the AI-Thinker bootloader procedure with GPIO0 grounded during reset, a suitable 5 V supply, common ground and a 3.3 V logic USB/UART adapter. Disconnect GPIO0 from ground and reset after flashing. A USB carrier may provide its own boot/reset controls.

Build output: `.pio/build/esp32cam/firmware.bin`. It is private if built with your credentials. Network update target: `esp32cam-ota`; see [OTA prerequisites](../README.md#ota-updates).

After installation, check `/status` for version **1.0.14**, camera readiness, the panel's camera version, image stream and light controls. Camera and legs have independent firmware versions and update targets.
