# K9-MK3 battery — 2S 7.4 V 2500 mAh Li-Ion pack with BMS

Source: the RoboCore product page (`pack-bateria-li-ion-7_4v-2500mah-com-bms`) and the owner's measurements. Mark what is **manufacturer data**, **measured** and **assumption**.

## 1. The pack
| Item | Value | Source |
|---|---|---|
| Cells | 2 × 18650 Li-Ion in series (2S1P), brand/model not given | manufacturer |
| Nominal voltage | 7.4 V (usable range ≈ 6.0 to 8.4 V) | manufacturer / calculation |
| Capacity | 2500 mAh nominal (cheap packs often deliver less) | manufacturer |
| Discharge | "2C" ≈ 5 A, **no test** confirms it (RoboCore's own arithmetic) | manufacturer |
| Weight | 100 g advertised, **95 g measured** | manufacturer / measured |
| Size | 70 × 38 mm with the tape, ~20 mm thick (assumed) | measured / assumption |
| Connector | JST (variant not given), silicone cable | manufacturer |
| BMS | present, **limits not given**; **no balance lead**; the supplier **did not confirm balancing** | manufacturer |
| Charge port / LED | none | manufacturer |

## 2. Charging
A dedicated 2S Li-ion charger (8.4 V) is the simplest; RoboCore cites the "2S Lithium Battery Mini Charger" as an option (not "confirmed compatible"). A bench supply **with current limit (CC/CV)** also works. A fixed-voltage adapter without current limit **does not**.

**Rules**
- **Maximum voltage 8.40 V** (4.20 V per cell), checked with a multimeter with the supply unloaded. The pack's protection usually cuts near 4.25-4.30 V per cell, but that is not specified: do not rely on it.
- **Current:** first charge **0.5 A** (0.2C). If everything is normal (pack warm at most, current falling at the end), you can raise it to **1.0 A**. Do not exceed 1.25 A (0.5C): the cells' brand is unknown.
- **End of charge:** current < ~100 mA at 8.40 V (≈ 5% of C). Switch the output off and unplug the pack. Do not leave the supply "floating" at 8.4 V.
- Charge **outside the robot**, on a non-flammable surface, never unattended; between 0 °C and 45 °C.

**Step by step (bench supply)**
1. Output off, nothing connected: set 8.40 V and the current limit (0.5 A); check the voltage with the multimeter.
2. Connect the pack to the JST (red = +), then switch the output on. At the start the supply should be in **CC** (fixed current), the voltage rises to 8.4 V and moves to **CV**, with the current falling.
3. Pack fully discharged and with no output (BMS cut it): start with 0.2 A until it passes ~6 V, then raise it.

**Time (calculated, not measured; real capacity may be lower)**
| Current | From empty to full |
|---|---|
| 1.25 A | 3 to 3.5 h |
| 1.0 A | 3.5 to 4 h |
| 0.5 A | 5.5 to 6 h |
Starting from half: about half the time.

**Supply readings**
| What you see | Means | Action |
|---|---|---|
| 8.40 V, **CV**, ~0.02 A | pack full; end of charge | switch off and unplug the pack (at rest ≈ 8.3-8.4 V) |
| < 8.4 V, **CC**, low current | the supply's current limit is set low | raise the limit to 0.5 A |
| 8.40 V, **CV**, but the pack at rest was < ~8 V | BMS blocking the charge (e.g. imbalance) | stop; possibly a defective pack |
| current ~0, supply voltage rises fast, pack very low | deep-discharge protection or a bad JST contact | check contact/polarity; start with 0.2 A |

Store at ~7.4-7.6 V (3.7-3.8 V per cell). Do not discharge the robot below ~6.4 V.

## 3. How the pack goes into the robot (what the project says and does not say)
- The original K9V2.1 used a **1S LiPo (3.0-4.2 V)**, the MCU straight from the battery and a **5 V boost for the servos only**; a slide switch on the positive wire; a 470 µF capacitor (`k9v2-1_stl/k9v2-1_wiring.svg`).
- **The project does not document the connection for the 2S pack.** The "8 g 5 V converter" in the K9-MK3 documents is an **assumption** (which converter the owner uses was not reported yet).
- MG90S accept **4.8-6 V**: never connect the pack (6-8.4 V) straight to the servos. They need a **5-6 V buck converter with ≥ 3 A peak** (4 servos × ~0.8 A stall).
- ESP32 DevKit: 5 V on the `5V` pin, or ~7-12 V on `VIN` (on-board regulator; it heats up). ESP32-CAM: 5 V / 2 A peak. Common ground for everything.
- Switch and wire: check the switch's **current rating** (a 7.4 V input draws ~2 A with 3 A at 5 V) and consider a **~5 A fuse** on the positive.
- The firmware **does not read the battery voltage** (no `analogRead`); it can be read with a resistor divider on an ADC1 pin, but that is a future decision.
- Run time (estimate): 1 to 2 h walking, longer standing still.

## 4. Board reboot when moving (investigation)
Reported symptom: with this pack, the ESP32 reboots when the robot moves. Hypotheses, from most to least likely, with the test that separates each. The reboot reason in `/log` decides a lot:
- `reset: BROWNOUT` → the board stayed powered, but the 5 V/3.3 V rail **sagged** (servo peaks, weak converter, thin wire, missing capacitor).
- `reset: power-on` → power **dropped completely**: the pack's BMS tripping on overcurrent at servo start-up, a bad JST/switch contact, or a fuse/converter protection.

| # | Hypothesis | Test |
|---|---|---|
| 1 | Shared rail: servos and ESP on the same 5 V; the converter cannot take the peak | power the ESP from a power bank (common GND only) and walk: if it stops rebooting, it is the rail |
| 2 | The pack's BMS trips on overcurrent (limit not given) | the ESP-CAM (if on the same pack) reboots together, the reason is `power-on`; repeat with the bench supply (3 A) instead of the pack |
| 3 | Drop through a thin wire/JST connector/switch | measure the voltage at the ESP's pin with a multimeter in Min/Max while walking; replace the switch with a direct wire for the test |
| 4 | Missing capacitor on the servo branch | 470-1000 µF (low ESR) between V+ and GND of the servos, and 100 nF near the ESP |
| 5 | Converter with a low current limit (e.g. 2-3 A modules) | test a buck of ≥ 5 A or two bucks (servos / boards) |
| 6 | Pack still poorly charged (low voltage, high internal resistance) | repeat with the pack charged to 8.4 V |

Recommended arrangement (the original's path): **two bucks from the pack** — one 5-6 V / 3-5 A for the 4 servos only (with a capacitor) and another 5 V / 1-2 A for DevKit + ESP32-CAM — common ground, switch and fuse sized accordingly.

## 5. Converter in use: LM2596 (owner's data, 29/10/2026)
The owner uses an **LM2596 DC-DC step-down module, input 3-40 V, output 1.5-35 V** (adjustable by trimmer). The data below are **typical of the common blue module** and of the LM2596 IC (datasheet); **your specific board was not measured**: check it with calipers and a multimeter.

| Item | Value | Source |
|---|---|---|
| Input | 3-40 V; needs **Vin ≥ Vout + ~1.5 V** | listing / datasheet |
| Output | 1.5-35 V, adjustable (multi-turn trimmer) | listing |
| Current | 3 A max.; **~2 A continuous without a heatsink** | datasheet / practice |
| Frequency | 150 kHz; efficiency ~80-90 % | datasheet |
| Size | ~43 x 21 x 14 mm (1.6 mm PCB; the inductor, 2 electrolytics and trimmer are the tall parts) | typical, **measure** |
| Weight | ~10 g | typical, **measure** |
| Mounting holes | normally **none**; reverse-polarity protection: **none** | typical |

**Consequences for the K9**
- **Adjust the output BEFORE connecting servos or boards**: with a multimeter on the output, unloaded, go to **5.5-6.0 V** (MG90S: 4.8-6 V). Modules arrive from the factory with any output, sometimes > 12 V.
- With the 2S pack (6.4-8.4 V in use) a 5.5-6 V output keeps the 1.5 V margin. Below ~6.4 V on the pack (already the limit this document says to respect) the output starts to fall with it.
- **The 4 stalled MG90S draw ~3 A (4 x 0.8 A): that is the module's limit.** Walking, the peak is lower, but it is hypothesis 5 of section 4 (converter at its limit) in concrete form: if the ESP reboots under load, the LM2596 alone feeding servos + DevKit + ESP32-CAM is the first suspect. The project **does not yet record** whether this module feeds only the servos or also the boards.
- A 470-1000 uF capacitor (low ESR) on the output, near the servos; a ~5 A fuse and a properly rated switch on the input (a 7.4 V input draws ~1.5x the 5 V output current ÷ efficiency).
- **Position inside the robot: see [`HARDWARE-LAYOUT.md`](HARDWARE-LAYOUT.md).** The MK3's "8 g 5 V converter at x = -45" was an assumption; the real module is bigger (43 x 21 x 14, ~10 g).
