# Troubleshooting

## First: read the robot's log

Each board keeps a log in its own flash (it survives reboots). In the panel: **Settings › Robot log**, or:

```bash
curl http://k9.local/log        # legs
curl http://k9cam.local/log     # camera
```

Every start-up writes a line `=== BOOT === reset: <reason>`:

| Reason | Means |
| :--- | :--- |
| `power-on` | power was applied (normal) |
| `BROWNOUT (supply sagged)` | the supply voltage dropped: a **power/wiring problem**, not a code problem |
| `PANIC (crash)`, `watchdog`, `task watchdog` | firmware hang |
| `software restart` | requested reboot (OTA, Wi‑Fi change) |

The `stat` line (every 5 s) shows free memory, signal and, on the camera, `fps` and KB per frame.

## Mesh network: the signal changes at every reboot

On a **mesh** Wi‑Fi (main router + 2 nodes with the same name) the ESP32 does not roam and, by default, joins the **first** node it finds, sometimes a distant one: the legs board's log showed the signal swinging between -48 and -90 dBm from one reboot to the next. The firmware now scans all channels and joins the **strongest** node, does not pin the BSSID, and searches again if the signal stays below -78 dBm for 30 s while the robot is still. If the signal is still bad, look at the `stat ... rssi=` line of the log and move the robot closer to a node. `k9.local` (mDNS) sometimes fails on a mesh: `ota.sh` uses the IP the hub knows.

## It reboots when the legs move (BROWNOUT)

Four servos starting together draw a lot of current. The firmware already limits the total animation speed and powers the servos one at a time at boot, but that only reduces the peak. The definitive fix is electrical:
- 5 V supply with 2–3 A, short thick wires, common GND.
- A 470–1000 µF capacitor between V+ and GND of the servos, and another next to the board's 5V/GND.
- Power the board and the servos through separate paths (like the original design: MCU straight from the battery, boost only for the servos).
- Do not power the ESP32‑CAM from the 3V3 pin or from a weak FTDI adapter (FTDI jumper on **5 V**, board **5V** pin).

## Video opens fine and soon freezes

Symptom: the image appears and stops after a few seconds, but the board stays on. The browser shows no error: the camera closes the video connection and the image freezes. Cause found: with the **experimental** camera firmware the board's Wi‑Fi stalls ~2 s under video and sending times out (`stream drop: errno=116` in the log at `k9cam.local/log`). Also measured: 0 viewers = ~40 ms ping, 1 = ~100 ms, 2 = 500+ ms. That is why the ESP32‑CAM uses the stable firmware (see the README) and the panel should be open in **one tab only**. If it freezes anyway, reload the page (F5): the panel also reopens the video by itself when the camera returns to the network.

## The camera drops off the network or has no image

- The ESP32‑CAM is sensitive to power: you see `BROWNOUT` in the log, or it answers only a few seconds after power-up. Change the USB cable/port, use a 5 V 2 A supply.
- Video: open only one or two panel tabs. Limit of 3 viewers; the oldest is dropped.
- Dark image: use **Night mode** and **Brightness** in the panel.
- Heavy/stuttering image: switch to **Fast** mode.
- The panel shows the camera video (`k9cam` board) even with the legs off.

## The panel says "Robot off"

It means the **legs** (`k9.local`) did not answer. Check power and Wi‑Fi (poor signal below -75 dBm). Video and flashlight keep working if the camera is up.

## I need to move the robot to another Wi‑Fi network

Use **Settings › Boards' Wi‑Fi network** in the panel (pick the board, type the network name and password). The board reboots and joins the new network; if it cannot, it opens the emergency access point `Minirobo-K9` so you can reach it again (see [`FIELD-USE.md`](./FIELD-USE.md)). Without the panel: `curl -X POST http://<board_ip>/wifi -d ssid=<name> -d pass=<password>`.

## Hub down

```bash
cd k9_control_hub && ./restart.sh     # stops the old one, waits for the port to free up, starts the new one and confirms
```
Hub log at `/tmp/k9_control_hub.log`.

## Flashing (OTA) fails

- The first flash of each board is over USB; OTA only afterwards.
- The password comes from `K9_OTA_PASS` in `secrets.h`; the board must have been flashed with the same one.
- If `k9.local`/`k9cam.local` does not resolve, try the IP directly and check that the board answers on `/status`.
- Changing `partitions_k9.csv` requires a USB flash.

## Reading the serial port over USB

Opening the serial port reboots the board (adapter DTR/RTS lines). This is normal and can look like a reboot loop; the flash log shows the truth.

## Boot pins

`GPIO2` (leg RR) and `GPIO15` (leg FR) are ESP32 strapping pins: the legs may twitch for a moment at power-up. A 10 kΩ resistor from each signal to GND helps.

## The panel is in the wrong language

Use the language selector at the top of the panel; the choice is stored per browser (`localStorage` key `k9.lang`). See [`I18N.md`](./I18N.md).
