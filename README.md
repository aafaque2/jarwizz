# Jarwizz — Personal AI Assistant (v1)

A voice-activated, **locally-run** personal AI assistant. Jarwizz plans your request,
routes each step to the right channel (web, Gmail, desktop, or the model itself),
executes it with a safety approval gate, and speaks the result back.

Everything runs on your machine: the model runtime is **llama.cpp (Vulkan or ROCm)**
serving any instruction-tuned GGUF you choose — one open-weight local model handles
both planning *and* screen vision (vision-capable models), no cloud account required
for the core experience. See `docs/06-SETUP-GUIDE.md` §1b for model recommendations
by hardware.

## What v1 does

- **Voice control** — push-to-talk (hold **Ctrl+Shift**, release to send). STT via faster-whisper,
  TTS via Piper. Not always listening.
- **Web automation** — search, navigate, read, click, type, scroll (Playwright).
- **Gmail** — read / draft / send. *Send* is irreversible and always asks for approval first.
  Connect real Gmail via OAuth (see docs/06-SETUP-GUIDE.md §5).
- **Desktop control** — open apps, type into the focused window, capture the screen and have the
  assistant describe it (vision), create/delete files.
- **Job application assist** — parse a posting, draft a tailored cover letter from your saved
  profile, and submit (irreversible, full approval modal showing every field).
- **Memory & preferences** — remembers facts you tell it ("my name is Aafaque"), keeps a profile,
  and keeps conversational context within a session.
- **Safety** — every step is tiered `read-only` / `reversible` / `irreversible`; irreversible steps
  pause for explicit approval. Domain whitelist forces unlisted sites to irreversible.

## Architecture

See `docs/02-ARCHITECTURE.md` for the full picture. In short:

```
voice-service (STT/TTS) ──WS/HTTP──▶ backend (planner + orchestrator + channels)
                                        ├─ model/llamacppClient   → llama.cpp (Vulkan) :8080
                                        ├─ router/chooseChannel    → api | browser | desktop | job | llm
                                        ├─ guardrails/classifier   → risk tiers + approval gate
                                        └─ memory/store            → SQLite (prefs, profile, apps, chats)
```

## Quick start

**Linux:**
```bash
# 1. Start the model runtime + backend
./scripts/start-jarwizz.sh

# 2. (optional) also launch the voice service and the dashboard
./scripts/start-jarwizz.sh --voice --ui

# 3. Stop everything
./scripts/stop-jarwizz.sh
```

**Windows:**
```powershell
.\scripts\start-jarwizz.ps1            # model + backend
.\scripts\start-jarwizz.ps1 -Voice     # + voice service
.\scripts\stop-jarwizz.ps1
```

Then open the dashboard (Vite dev server in `frontend/`) or just talk:
hold **Ctrl+Shift**, say e.g. *"open notepad"*, *"what is my name"*,
*"send an email to bob saying hello"*, or *"parse this job posting <url> and draft an application"*.

Before first run, follow `docs/06-SETUP-GUIDE.md` to install llama.cpp (Vulkan), the model GGUF,
Playwright, and the voice `venv`. On Linux start at **§9**, which covers the Wayland-specific
pieces (portal screenshots, `ydotool`, evdev push-to-talk) the Windows sections don't.

## Documentation

- `docs/00-README.md` — doc index
- `docs/01-PROJECT-SPEC.md` — product spec & MVP definition
- `docs/02-ARCHITECTURE.md` — system design
- `docs/05-SAFETY-AND-GUARDRAILS.md` — risk tiers, approval gate, whitelist
- `docs/06-SETUP-GUIDE.md` — full setup (models by hardware, Gmail OAuth, voice)
- `docs/07-IMPLEMENTATION-PLAN.md` — phase plan + v1 status
- `docs/09-MIGRATION-NOTES.md` — Ollama → llama.cpp migration
- `docs/10-USER-GUIDE.md` — how to actually use Jarwizz

## Status

v1 = Phases 0.5 → 10 complete. Deferred (post-v1): wake-word training, cloud model fallback (Phase 11).
