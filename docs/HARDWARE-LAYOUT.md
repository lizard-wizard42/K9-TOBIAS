# Hardware inside the closed robot (MK4) — 3D layout

Generated in Blender by `MK4/06_fonte_blender/scripts/v4_interior.py` (models in `v4_interior_lib.py`). Previews in `MK4/05_previews/mk4_interior_*.png`.
Reference frame: x forward, y to the left, z up, z = 0 at the floor's bottom.

## Boards and measurements used
| Part | Size | Source | Where it sits |
|---|---|---|---|
| 2S 18650 pack | 70 x 38 x 21, 95 g | measured (thickness assumed) | tray under the floor, battery bottom at z = -7.4, centre x = -1 |
| ESP32 DevKit (legs) | 54 x 29 x 13, micro-USB, no holes | RoboCore | hanging under the lid on the `suporte_esp32` (PCB z 25.4-27.0; pins go down to z 17.4) |
| ESP32-CAM AI-Thinker (OV3660) | 27 x 40.5; the camera module sticks out ~7 mm | catalogue | behind the face: lens at y = -8, z = 16.4 (mirrored front: camera on the left), board standing (plane perpendicular to x) |
| **LM2596 step-down** | **~43 x 21 x 14, ~10 g** | catalogue of the common module, **measure yours** | **under the battery**, see below |
| 4 x MG90S | Cults3D model | MK3 | at the ends, x = ±57 |

Assumptions to check on the real board: orientation of the ESP32-CAM (lens 14 mm from the short end, centred on the width), height of the DevKit's pins (8 mm), dimensions of the LM2596.

## Search result: the LM2596 does not fit
`v4_interior_busca.py` sweeps the interior with 1 mm voxels (body + servos + battery + DevKit + ESP32-CAM) and tests the 43 x 21 x 14 box in the 6 orientations, even with zero clearance: **0 free positions**. Reason: above the battery 17.2 mm are left (13.6 to 30.8), and outside the DevKit (±14.5) only ~10 mm strips remain against the sides (internal waist ±24.5), smaller than the module's 14 mm smallest face. At the ends the servos occupy y 2.6-14.8 and z 11.8-24.2.

## Solution (only the tray changes)
- `MK4/01_corpo/k9v2-1_bandeja_bateria_lm2596.stl`: a tray **17.1 mm deeper** (outer bottom at z = -26.1) with a low 67.6 x 35.6 x 15.5 mm compartment under the battery; a 2 mm **step** up to the shelf; wire exit through the rear wall.
- `MK4/01_corpo/k9v2-1_prateleira_bateria.stl`: a loose 70.4 x 38.4 x 1.6 mm plate with a 12 x 8 mm slot for the LM2596 wires to rise. The battery rests on it; the battery's bottom stays at z = -7.4, so **the battery's height and CG do not rise** (and the ~10 g LM2596 sits at z ≈ -18, lowering the CG).
- LM2596 at x = -12 (near the wire exit), at the bottom of the compartment; adjust the trimmer **before** closing (see `docs/BATTERY.md`, section 5).
- Ground clearance standing: ~33 mm (feet at z ≈ -59). Lying down, the tray's bottom (-26 mm) touches the ground before the belly (z = 0): it becomes the support point.
- Interference (boolean, intersection volume): **0 mm³** between all parts, except **28 mm³** between the modelled DevKit pins and the support ring (an approximation of my model; measure the real board).
- Tray screws into the floor: same as the original (4 on the tabs). No screw is needed for the shelf.

## Still unresolved
- `MESA_KOBRA3_completa` still has the ORIGINAL tray; to use the LM2596, print the deep tray and the shelf (the deep tray is 35.1 mm tall, opening upward).
- Switch, fuse, servo capacitor and the wiring are not modelled. Plan: a switch at the rear (existing window), a 470-1000 uF capacitor next to the servos.
- Nothing printed or assembled; the boards' measurements come from catalogues.
