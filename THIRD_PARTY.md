# Credits and license boundaries

## miniRobo — inspiration and base

Tobias began with the **miniRobo K9V2.1 model**, used as the starting point for the project. Credit for that original robot design and the adapted firmware/gait portions belongs to **miniRobo**.

- Site: <https://minirobo.io/>
- Original model/project: <https://www.minirobo.io/projects/k9v2-1>
- Terms: <https://www.minirobo.io/terms>
- Adapted portions: `k9v2-1_firmware/src/main.cpp`, `gait_core.h`, `net_console.h`.

The source download did not include a separate standard LICENSE. The upstream site describes code/designs as personal, non-commercial making unless otherwise noted. Those terms remain applicable to upstream-derived portions; they are **not relicensed MIT** by this repository. Attribution documents origin; it is not a replacement for permission, and this project does not assert a grant of commercial or unrestricted redistribution rights from the upstream author. Obtain any additional permissions directly from the rights holder before uses outside those terms.

Original contributions include the hub/web panel, voice integration, board integration and original sound/animation additions, subject to the above boundaries. This is an independent adaptation without an endorsement by miniRobo.

## Other components

| Component | Distribution and license |
| --- | --- |
| Arduino-ESP32 and camera support | Downloaded by PlatformIO, not vendored; retain Espressif/upstream licenses. |
| Node dependencies and SDKs | Declared in package manifests/lockfiles, not vendored; retain their own licenses. |
| Gradle wrapper | Android wrapper files retain their Apache-2.0 notices. |
| Real-ESRGAN service integration | Integration code only; no third-party model or executable included. |
| Public-edition sound motifs | Pulse, Lunar March, Arcade and Cosmos were created for this public edition. Named third-party song transcriptions are omitted. |

STL, 3MF, Blender/CAD files, music recordings, private media and old project history are **not included**. No software license here grants rights in those separate designs/assets.
