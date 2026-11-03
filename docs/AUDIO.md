# Speaker and sound — public edition

The speaker is controlled by **GPIO25 on the ESP32 DevKit legs board** through a TIP41C NPN transistor and a **220 Ω** base resistor. The ESP32-CAM does not drive the speaker.

| Connection | Destination |
| --- | --- |
| GPIO25 | 220 Ω resistor → TIP41C base |
| TIP41C emitter | Common GND |
| TIP41C collector | Speaker negative |
| Speaker positive | Regulated 5 V |
| 1N4007 diode | Across the speaker: striped cathode to positive; anode to collector |

TIP41C, lettering facing you and leads down: Base, Collector, Emitter; the tab is collector. See the [ST datasheet](https://www.st.com/resource/en/datasheet/tip41c.pdf). Speaker impedance/current are component-dependent; no higher supply voltage is specified here.

Volume is 0–100 in 5% steps; zero is silent. Mute also applies to automatic emotion sounds. LEDC speaker channel 6 is separate from servo channels 0–3. Playback is non-blocking and stops for OTA.

The public music buttons use four original motifs: **Pulse, Lunar March, Arcade and Cosmos**. A track plays once; another click stops it. Dance cycles these motifs while the movement is active. Alarm is the only manual looping sound. Poses/actions are silent; selected emotions and scratching synchronize their own sound to the motion timeline.

The private build's named third-party song transcriptions are not part of this edition. Publishing this source did not change the firmware installed on the robot.
