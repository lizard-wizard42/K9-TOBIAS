# Vivo — an AI takes over the K9 (full plan)

"Vivo" is a mode in which an AI (Claude) controls the robot from **voice commands** captured by the phone's microphone, with **memory and knowledge (RAG)** and tools exposed through **MCP**. It starts **off** and only acts after being **armed**.

## 1. Architecture

```
 phone (USB)                               PC
 ┌──────────────────────────┐   ws    ┌───────────────────────────────────────────────┐
 │ Vivo app (ears and mouth)│◄──────►│ k9_vivo (port 3090)                           │
 │  microphone → text       │ adb     │  gateway ──► local shortcuts (stop!) ─┐       │
 │  text → voice            │ reverse │      │                                │       │
 └──────────────────────────┘         │      ▼                                ▼       │
                                      │  agent (Claude, tool use)       SAFETY        │
                                      │      │  MCP (in memory)         layer         │
                                      │      ▼                                │       │
                                      │  MCP server ── tools ─────────────────┘       │
                                      │   • robo_pose / robo_andar / robo_parar       │
                                      │   • robo_status                               │
                                      │   • conhecimento_buscar  (RAG: K9 docs)       │
                                      │   • memoria_buscar / memoria_salvar (RAG)     │
                                      │   • falar                                     │
                                      └───────────────────┬───────────────────────────┘
                                                          │ REST (x-hub-token)
                                      hub (3080): validates, ramps, 400 ms watchdog ──► robot (UDP)
```

- **The phone only listens and speaks.** The reasoning runs on the PC. The phone does not send commands to the robot.
- **Vivo never talks to the robot directly:** it goes through the hub, which already validates commands, bounds numbers, ramps and stops by itself after 0.4 s without a command.
- **MCP:** the same tools serve the built-in agent (over an in-memory transport) and any external MCP client (Claude Code, Claude Desktop) over stdio (`.mcp.json`). So "an AI takes over the robot" holds for both.
- **Without an AI key Vivo is still useful:** a local interpreter of simple commands ("sit", "walk", "turn", "dance", "stop") answers in reduced mode, in six languages.

## 2. Safety (the most important part)
1. **Disarmed by default.** To arm: the "Vivo" button in the panel, or the voice phrase "enable vivo". It disarms by itself after N minutes without use (default 10) and when the phone disconnects.
2. **Stop has priority and does not go through the AI:** "stop", "halt", "enough"… are handled locally, before any call. The Stop button and the panel's emergency stop also disarm.
3. **Allowed command list:** only the panel's poses (sit, lie down, stand, paw R/L, dance, stretch, wag tail, dig) and walking. **Never:** trim, calibration (`cal`), servo tests, gait changes, Wi-Fi, OTA, flashlight.
4. **Limited walking:** maximum speed 50% of the axis, at most 3 s per call, 10 s of walking per minute, always ends with `stop`.
5. **Rate limit:** at most 12 actions per minute.
6. **Fail-safe:** hub or robot offline, tab/phone disconnected or AI error → it stops and disarms.
7. **Audit:** every action (who asked, what the AI decided, what was sent) goes to `k9_vivo/data/auditoria.jsonl`.
8. **Secrets:** the AI key comes from `ANTHROPIC_API_KEY` in the environment, never from the code. The hub token comes from `HUB_TOKEN`.

## 3. RAG (knowledge + memory)
- **Knowledge:** `docs/*.md`, `README.md`, `MK4/README.md` and two files written for Vivo (`persona.md`, `capacidades.md`), cut by headings into chunks of ~600 characters.
- **Memory (episodic):** facts and preferences the user asks to remember ("my name is...", "the living-room floor is slippery"), stored in `k9_vivo/data/memoria.jsonl` (outside git).
- **Search:** BM25 in plain JavaScript (no database or native library) with Portuguese tokenisation (no accents, no stop words). Recent memory weighs more. If the set grows, swap in embeddings without changing the tools.
- The AI queries through the `conhecimento_buscar` and `memoria_buscar` tools; the most relevant memories also enter the context of every request.

## 4. The agent
- Claude with **tool use**, configurable model (`VIVO_MODEL`, default `claude-sonnet-5-5`; `claude-haiku-5-5` for lower latency).
- Persona (`persona.md`): the K9, a small, curious robot dog, **short, spoken** answers, in the language selected in the panel. It does not invent what the robot did: it confirms from the tools' return values.
- Loop of up to 6 tool calls per request; short conversation history; timeout.

## 5. Voice and the phone app
- **Phase A (already works with nothing to install):** web client in `k9_vivo/web`, opened on the phone over USB with `adb reverse tcp:3090 tcp:3090` (the `localhost` address counts as a secure context, so the microphone is allowed). It uses the browser's recognition and speech.
- **Phase B (native Android app, Kotlin):** `SpeechRecognizer`, `TextToSpeech`, a foreground service to keep the microphone with the screen off, WebSocket to the PC (over USB with `adb reverse` or over Wi-Fi). Installed with `adb install`. **Needs JDK 17 + Android SDK (≈1 GB) and accepting the Android SDK licences, which depends on your authorisation.**
- Input: push to talk, or continuous listening with the wake word "K9" (optional).

## 6. In the hub's panel
- A **Vivo** button (on/off) with a gear next to it (time to disarm, maximum speed, voice), a very visible "Vivo on" indicator and the usual Stop. NPC mode and Vivo do not run at the same time.

## 7. Phases and tests
| Phase | Deliverable | How I verify |
|---|---|---|
| 0 | Survey (phone, SDK, Node, key) | **done** |
| 1 | Safety layer + robot adapter | unit tests (limits, rate, allowed list, stop) — **done** |
| 2 | RAG: ingestion, BM25, memory | search tests with real questions about the K9 — **done** |
| 3 | MCP server + tools | in-memory MCP client calls every tool with a simulated robot — **done** |
| 4 | Local interpreter + WebSocket gateway + web client | gateway tests; open on the phone through `adb reverse` — **done** |
| 5 | Claude agent | test with a simulated AI client; real test once `ANTHROPIC_API_KEY` exists — **done** |
| 6 | Android app + `adb install` | install on the phone and speak a command — **installed**; speaking in practice still missing |
| 7 | Vivo button in the panel | hub tests + browser check |
| 8 | Field test | list in `docs/VIVO.md` (robot in your hand first) |

## 8. Pending items that depend on you
1. **`ANTHROPIC_API_KEY`** in Vivo's environment (without it only the local mode works).
2. **Authorise** the download of JDK 17 and the Android SDK and the acceptance of the SDK licences, for Phase B.
3. Confirm the **wake word** and the **time to disarm**.
