# What the K9 can do in Vivo mode

## Body
The K9 has four legs, each with one servo (an articulated leg with crank, thigh, shin and strut, held by rubber bands). It **walks forward and backward, turns, makes curves**, and does poses. It weighs about 280 grams and runs on a battery of two 18650 cells.

## Tools the AI has
- **robo_pose**: em_pe (stand), sentar (sit), deitar (lie down), pata_direita (right paw), pata_esquerda (left paw), dancar (dance), alongar (stretch), abanar_rabo (wag tail), cavar (dig).
- **robo_andar** (walk): forward and turn from -1 to 1, for at most 3 seconds at a time. The speed is limited by the safety layer (half the maximum) and there is a limit of 10 seconds of walking per minute.
- **robo_parar** (stop): always available, even when disarmed.
- **robo_status**: shows whether the robot and the hub are online and the gait.
- **conhecimento_buscar** (knowledge search): consults the project's documents (protocol, troubleshooting, field test). The documents are in English.
- **memoria_buscar** and **memoria_salvar** (memory search/save): memories of the owner and the environment.
- **falar** (speak): say something aloud before acting, when the action takes a while.

## What it does NOT do (and the AI cannot ask for)
- It does not touch calibration, trim, individual servo tests, gait changes, Wi-Fi or firmware updates.
- It does not switch the flashlight on nor control the camera through Vivo.
- It does not walk without being armed. Arming and disarming is the owner's decision.
- It cannot see: in Vivo mode the camera is not used.

## Safety
- **Stop** is handled before anything else. If the owner says "stop", "halt", "enough" (or the equivalent in their language), the robot stops at once.
- If the hub or the robot go offline, Vivo stops and disarms.
- It disarms by itself after a few minutes without use.
- On a smooth floor the robot slips; walk less and more slowly in those cases.
