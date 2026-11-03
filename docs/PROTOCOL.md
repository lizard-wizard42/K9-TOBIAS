# K9 protocol

## Boards (UDP port 4210 and HTTP port 80)

Each board answers text UDP packets (one command per packet) with a short reply. `PING` returns the full telemetry as JSON.

| Packet | Does | Board |
| :--- | :--- | :--- |
| `D <fwd> <turn>` | walk/turn, from -1 to 1 (e.g. `D 0.85 -0.20`), replies `ACK_D` | legs |
| `C <cmd>` | command: `stop stand sit lie wave dance bow stretch wag dig wiggle cal gait test0..test3` (`gait` = back to the final gait) | legs |
| `T <leg> <delta_us>` | fine adjustment of a leg's centre (0 FL, 1 FR, 2 RL, 3 RR), stored in NVS | legs |
| `L <0-100>` | flashlight brightness (real cap of 60% power, ~100 ms ramp) | camera |
| `S <hz>` | flash strobe, 1–30 Hz, `S 0` stops | camera |
| `Q <0-2>` | image mode: 0 Fast 160x120, 1 Balanced 240x176, 2 Sharp 320x240 | camera |
| `O <key> <value>` | image option (brightness, mirror, flip, night mode, fps). **Experimental firmware only**; the stable camera ignores it | camera (experimental) |
| `C flash` / `C flashon` / `C flashoff` | toggle / switch on at 100% / switch off the flashlight | camera |
| `PING` / `STATUS` | replies with the telemetry JSON | both |

In the experimental firmware the `Q`/`O` values are stored in the camera's NVS; in the stable one the mode returns to the default (Fast) on reboot.

### HTTP (each board)

| Route | Does |
| :--- | :--- |
| `GET /status` | telemetry JSON |
| `GET /cmd?c=<cmd>[&f=..&t=..&leg=..&d=..&v=..]` | same commands as UDP (`c=drive`, `c=trim`, `c=level&v=0..100`, `c=strobe&v=hz`, `c=camq&v=n`, `c=flash`, ...) |
| `GET /log` | last 64 KB of the log stored in flash (`?full=1` = everything) |
| `GET /log/info` | log size, flash usage, free memory |
| `GET /log/clear` | erases the log |
| `POST /wifi` (`ssid`, `pass`) | changes the Wi‑Fi network and reboots (used by the panel's **Settings › Boards' Wi‑Fi network** through the hub) |
| `GET :81/stream` | MJPEG video (camera only; use one viewer at a time: with more than one the latency climbs a lot) |

No authentication (local network).

### Telemetry (JSON)

`device` (`K9V21` legs · `K9CAM` camera), `ip`, `ssid`, `rssi`, `uptime` (s), `fwd`, `turn`, `gait`, `hold`, `flash` (0–100), `strobe` (Hz), `cam` (mode 0–2), `opt` (`[brightness, mirror, flip, night, fps]`), `trim` (µs ×4), `us` (µs ×4), `deg` (degrees ×4).

## Hub (port 3080)

Validates everything (allowed command list, bounded numbers) before sending to the boards. Walk/pose commands go to the legs; flashlight, strobe and image go to the camera.

### Socket.IO (browser → hub)

`k9:drive {fwd,turn}` · `k9:cmd {cmd}` · `k9:flash {level}` · `k9:strobe {hz}` · `k9:cam {preset}` · `k9:camopt {key,val}` · `k9:trim {leg,delta}` · `k9:set_ip {ip}`

### Socket.IO (hub → browser)

`k9:telemetry` (the legs' telemetry **plus** `camIp`, `camOnline`, `camPreset`, `camStrobe`, `camOpt` and the camera's `flash`) · `k9:status` · `k9:ack` · `k9:nome` (robot name changed)

### REST

`GET /api/status` · `POST /api/cmd {cmd, fwd, turn, leg, delta, level}` · `GET /api/log[?full=1]` · `GET /api/log/info` · `POST /api/log/clear` (the legs' logs) · `GET|POST /api/nome` (robot name) · `POST /api/wifi {alvo, ssid, pass}` (see below). With `HUB_TOKEN` set, send `x-hub-token` or `?token=`.

#### `POST /api/wifi`

Changes the Wi‑Fi network of one board. Body (JSON): `alvo` = `"legs"` or `"cam"`, `ssid` (1–32 bytes, no control characters), `pass` (empty for an open network, otherwise 8–63 characters). The hub validates it and forwards it to `POST /wifi` on the board; the board stores it in flash and reboots. Rules: requires `HUB_TOKEN` if set; a browser `Origin` must be the panel itself; at most one request every 5 s; the password is never logged or returned. Replies: `200 {ok:true}`, `400 {error:"alvo"|"ssid"|"senha"}`, `403 {error:"origem"}`, `429 {error:"aguarde"}`, `502 {error:"placa"|"sem_resposta"}`, `503 {error:"placa_offline"}`. If the new network or password is wrong, the board falls back to the emergency access point `Minirobo-K9` (see [`FIELD-USE.md`](./FIELD-USE.md)).

### Hub security

- WebSocket origin restricted to the page itself; optional `HUB_TOKEN`.
- Fail-safe: no drive command for 0.4 s (or the driver disappeared) → `D 0 0`.
- Flashlight/strobe: resent until the camera confirms; they switch off after 5 min and when the last browser leaves.
