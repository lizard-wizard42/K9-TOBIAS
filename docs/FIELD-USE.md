# Field test — K9-MK3

Mark what was **verified** (tested on the robot or in the code) and what is an **assumption**.

## 1. Before leaving (5 minutes)
1. `cd k9_control_hub && ./preflight.sh` (read-only; sends no command). All **OK** = ready. If it reports the **camera offline**, switch on the ESP32-CAM and wait ~20 s.
2. Battery charged; lid screws and crank screws tight; the cranks of all four legs pointing the same way with the robot in **Align 90°** (Settings → Leg adjustment).
3. Legs firmware with **gait 5 (MK3 diagonal, 1.25 Hz)** as the start-up gait (`GAIT_BOOT 4`, flashed over OTA on 29/10; telemetry should show `gait 5`). It is the one that "walked very well, I could walk around the room" with the **MK4 rear feet, support18 +8 mm** installed (owner's report, no measurement; `docs/GAIT-STUDY.md` 6.17). Without those feet it did not walk. Gait 6 (sides together, 1.5 Hz, return at 89% of the limit: watch for BROWNOUT) is still available in the "Other gaits and tests" menu.
4. Phone on the same network as the PC: open the address `preflight.sh` prints (`http://<PC-IP>:3080`). The **K9 app** also uses this network (USB is no longer needed): the first time it asks for the PC's IP; if the IP changes, use "Change PC address". Reserving the PC's IP in the router is recommended.
5. **AI mode (Vivo) only works with the PC on the network** (hub + Vivo running): in pure field mode (`Minirobo-K9`) the phone talks only to the legs and there is no AI; use the PC's hotspot with your home network's name (section 2) if you want AI in the field.

## 2. Network in the field
- **Near home, with signal ≥ −70 dBm** (the panel shows Wi-Fi in dBm): nothing to do.
- **Away from home:** create an access point (hotspot) with the **same name and password as your home network**, on 2.4 GHz. Both boards join it by themselves and the hub keeps finding everything. On Linux: `nmcli dev wifi hotspot ifname <wifi-card> band bg ssid "<name>" password "<password>"`, and the phone joins the same hotspot. *Assumption: not tested in the field.*
- Alternatively, **change the boards' Wi-Fi from the panel** (Settings › Boards' Wi-Fi network) to the field network before leaving, and back when you return.
- **Boards' field mode** (access point `Minirobo-K9`): for using **only the legs, with the camera board off**. See section 2.1. With both boards on it does not work: **both** create it, both at 192.168.4.1 on channel 1, and they get confused.
- If the signal drops, the robot stops by itself: the legs board stops after 1 s without a command and the hub sends zero after 0.4 s (verified in the code).

### 2.0 Camera in the field (29/10: measured at home, **not tested in the field nor walking**)
- It only works with the home network or the PC's hotspot (same name and password) and with the hub on the PC. In pure field mode (`Minirobo-K9`) there is no camera.
- Measured at home with the camera on USB and the robot still: link of ~0.6 to 0.9 Mbit/s, delay to the hub of 0.2 to 0.4 s. **Fast** image ≈ 12 fps; **Sharp** 2 to 9 fps depending on the scene (the stable camera firmware was not changed: VGA at q18). The **Enhance with AI** button only works with the `k9_control_hub/superres/start.sh` service running on a PC with a GPU (`docs/CAMERA-WIFI.md`).
- **Not verified:** the camera powered from the robot's battery with the servos walking (the board may reboot; see `/log`), video with the robot moving, and the camera's Wi-Fi range far from the router (the signal fell to −74 dBm in one position at home).

### 2.1 Field mode: legs only, no camera (decision: the camera is not used in the field)
**How it works** (verified in the code; **not tested in the field**):
- At power-up the legs board tries the home network for about 6 to 13 s. If it does not find it, it becomes an access point: network **`Minirobo-K9`**, password `K9_AP_PASS` (from `secrets.h`), channel 1, at most **2 devices**, control page at **http://192.168.4.1**. Wait about **20 s** after switching on.
- **Keep the camera board OFF** (unpowered). If it starts without the home network, it creates a second, identical `Minirobo-K9` network and the phone may join the wrong one.
- The page (`192.168.4.1`) was simplified on 28/10: no video and no flashlight. It has joystick, D-pad/WASD, speed, Stop, the panel's poses (Default, Sit, Lie down, Paw R/L, Dance, Stretch, Wag, Dig), gaits 1 to 5, trim and "Lock 90°". It has no Random mode (it ran on the hub, on the PC). *Verified: flashed over OTA, the page served by the robot no longer has video or the removed buttons.*
- **QR code:** `references/qr/k9-qr-campo.png` (kept out of git, **contains the password**): QR 1 joins the `Minirobo-K9` Wi-Fi, QR 2 opens `http://192.168.4.1`. Print it at about 6 cm and keep it with the robot. If you change `K9_AP_PASS`, generate the QR again.

**To use:** switch on only the legs, wait ~20 s, join `Minirobo-K9` (QR 1), open the control page (QR 2). The robot stops by itself after 1 s without a command (releasing the joystick, locking the screen, closing the tab).

**Limits** (read from the code):
- Once in field mode, the board **does not try the home network again**: to go back, reboot with the home network available.
- The PC is left out of the network (only 2 slots: phone + a spare). The hub's panel, NPC mode and the camera do not work in this mode.

**Test at home before leaving (done once):** switch off the router, or flash a network that does not exist with `curl -X POST http://<ip>/wifi -d ssid=test -d pass=<8+ characters>` (the board reboots and, not finding the network, becomes an access point). Check joystick, Stop, the 5 gaits, the robot stopping by itself 1 s after closing the page, and the range (walk away about 10 m). Note whether it reboots while walking. To return to the home network, flash the right network again at `http://192.168.4.1/wifi` (POST `ssid` and `pass`) or from the panel.

**If it reboots in the field:** open **`http://192.168.4.1/log`** on the phone: the reason for the last reboot (`reset: BROWNOUT`, `watchdog`, `power-on`...) is in the board's own log and survives the reboot, with no PC needed.

## 3. How to test (first outing)
1. Firm, flat floor, no stairs, robot about 1 m from you. Start **held in the air for a few seconds** to check that the legs turn correctly.
2. Speed **30%**, gait **5 (MK3 diagonal)** (already the start-up one). Hold W for 3 s, release. Then 45% and 60%. Only go higher after 3 walks in a row without a reboot.
3. **STOP:** the big button on the phone (fixed at the bottom) and **Space** on the PC. The robot also stops when you release the joystick/key, lose focus or close the tab.
4. Watch: if a diagonal "flies" (leg without support) → adjust the trim of those legs; if the board reboots → see `/log` (below).
5. Terrain: short grass, packed earth, smooth floor. The v2 foot (round, 12 mm) is for that; on a smooth floor glue a strip of rubber/silicone on the foot.

## 4. If something goes wrong
- **It rebooted:** Settings → Robot log → "View recent", or `curl http://<legs-IP>/log | tail` (in field mode: `http://192.168.4.1/log` on the phone). Look for `BOOT ... reset: BROWNOUT`. After an unexpected reboot the board **ignores "walk" until you release the key** (`neutral lock`); this is intentional.
- **Does not walk at all:** gait 5 does not "grip" yet at 15% (±8° step); raise the speed.
- **Too slow:** expected (~25% slower than gait 1). Test gait 1 only with the robot in your hand before using it on the floor.
- **Return to the creator's gait at start-up:** in `main.cpp`, `GAIT_BOOT 0`, rebuild and flash.
- **Crooked legs:** refit the crank on the shaft; do not compensate in software.

## 5. Known limits
- The brownout **has not been explained yet**: the firmware review points to the shared 5 V rail (servos + board) as the most likely cause. If it reboots even at 30%, the next test is to power the ESP32 from a power bank, with only the common GND.
- The printed MK3 body **has not been assembled yet**; the weight/torque numbers are estimates.
