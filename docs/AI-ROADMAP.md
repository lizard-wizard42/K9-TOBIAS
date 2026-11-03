# Giving Tobias a little more life

Tobias MK5 is an ongoing maker robotics project. I am developing AI-assisted control to make interaction feel more expressive and natural. This is a development direction and an invitation to collaborate, not a claim that the robot is fully autonomous.

## What exists today

- The browser dashboard controls movement, poses, actions, animations, sounds and scripted emotions.
- The ESP32-CAM supplies a camera view and lighting controls.
- The optional **Vivo** layer includes voice-command routing, AI-provider integration, document lookup, memory and MCP tools. See [Vivo setup and limitations](VIVO.md) and [the architecture plan](VIVO-PLAN.md).
- The latest physical MK5 was printed, assembled and tested by the owner. That validates the tested configuration; it does not validate every AI workflow or future behavior.

Cloud AI is optional and off by default. Local commands and scripted behavior should not be described as autonomous reasoning. Tests with simulated hardware are distinct from supervised physical tests.

## Where I want to take it

These are proposed work areas, not shipped features or delivery promises:

| Area | Direction | Useful contribution |
| --- | --- | --- |
| Personality and behavior | More coherent responses and expressive routines | Small behavior proposals with clear triggers, duration and cancellation |
| Voice and intent | Natural interaction across languages | Reproducible recognition cases and tests for ambiguous instructions |
| Vision | Explore camera-based context | Offline experiments, datasets with permission and measured latency |
| Reliable motion | Better coordination of movement and sound | Simulation, timing tests and supervised validation of bounded movements |
| Local AI | Evaluate responsive local inference | Hardware/model benchmarks with actual latency and resource usage |
| Developer experience | Make setup and contribution easier | Documentation fixes, examples, tests and accessibility improvements |

## How to contribute

Start with [CONTRIBUTING.md](../CONTRIBUTING.md). Open a focused [issue](https://github.com/lizard-wizard42/K9-TOBIAS/issues) describing the problem or experiment before a large implementation. Documentation, translations and tests are welcome even without a physical robot.

For AI experiments, state:

1. The intended behavior and the conditions under which it runs.
2. Whether you used a simulated robot or physical hardware, with the tested revision.
3. What happens on Stop, cancellation, network loss and provider failure.
4. Which data stays local and which data goes to a provider.
5. The actual validation performed, including failures and known limits.

AI suggestions must go through the existing bounded command path. Preserve explicit arming, command limits and the Stop path. Do not add unrestricted model-generated firmware commands or automatic calibration, firmware uploads or OTA to a behavior feature. Never commit API keys, Wi-Fi credentials, recordings of people, private logs or personal binaries.

## Useful starting points

- [Project and quick start](../README.md)
- [Vivo source](../k9_vivo/) and [setup](VIVO.md)
- [Control hub and dashboard](../k9_control_hub/)
- [Interface behavior](INTERFACE-EXPERIENCE.md)
- [Security and privacy](../SECURITY.md)
- [Third-party terms and credits](../THIRD_PARTY.md)

The public repository contains software and documentation. Printable designs are maintained separately for MakerWorld, under their own terms.
