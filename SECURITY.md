# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private vulnerability reporting ("Security" tab → "Report a vulnerability") on this repository. Include what you found, how to reproduce it and the affected files. We aim to answer within a few days.

## What this project is — and is not

K9 is a hobby robot controlled over a **trusted home network**. By design the hub (`k9_control_hub`) and the boards' HTTP/UDP interfaces have **no authentication** unless you set `HUB_TOKEN`. Anyone on the same network can reach them. Do **not** expose the hub or the boards to the internet. Run the robot only on a network you trust, and set `HUB_TOKEN` on shared networks.

## Secrets and personal data — rules for contributors

- **Never commit** Wi‑Fi names/passwords, OTA or access-point passwords, API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`), `HUB_TOKEN`, QR codes that embed a password, `secrets.h`, `secret.md`, `.env`, personal MAC/IP inventories or absolute paths from your machine. They are already in `.gitignore`; check `git status` before every commit.
- Firmware secrets live in `k9v2-1_firmware/src/secrets.h` (copy of `secrets.example.h`). The firmware **does not compile** without `K9_AP_PASS` and `K9_OTA_PASS` — there are no default passwords. Choose unique values per robot.
- The Wi‑Fi network can be changed from the panel (Settings › Boards' Wi‑Fi network). The password only passes through memory: it is not logged, not stored in the browser and not returned by the API.
- Vivo (the optional AI) sends the transcribed sentence to the AI provider **only if you switch the cloud AI on**. It never sends the hub token, Wi‑Fi password or anything from `secrets.h`.
- If a secret was ever committed, **rotate it** (change the password/key) — deleting the file is not enough because git history keeps it.

## Hardening checklist before sharing a robot or a build

- [ ] `HUB_TOKEN` set; panel opened with `?token=…`
- [ ] Unique `K9_AP_PASS` and `K9_OTA_PASS` in `secrets.h`
- [ ] Router isolates guests; the robot is not port-forwarded
- [ ] No `.env`, `secrets.h`, `secret.md`, QR images or logs with network details in your fork

## Supported versions

Only the latest `main` branch receives fixes.

## Public source boundaries

This public repository starts from a new, reviewed source history. The older development repository remains private and archived. See [`docs/PUBLIC-EDITION.md`](docs/PUBLIC-EDITION.md) for the distribution boundaries. Old PR references and private history were not imported into this new repository.
