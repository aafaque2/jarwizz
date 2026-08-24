# Jarwizz — Architecture

## 1. System diagram

```
┌──────────────────────────────────────────────────────────┐
│                    Voice Service (always-on)                │
│  mic input → wake-word detector → STT → command text         │
│  + TTS for spoken responses/confirmations                    │
└───────────────────────┬──────────────────────────────────┘
                          │ command text (WebSocket)
┌────────────────────────▼──────────────────────────────────┐
│               React Dashboard (Electron shell)               │
│  listening orb · command box (text fallback) · task queue    │
│  · approval modal · log viewer · settings                    │
│  Dark theme, rich green accents (see 04-UI-DESIGN-SYSTEM.md)  │
└───────────────────────┬──────────────────────────────────┘
                          │ REST/WebSocket
┌────────────────────────▼──────────────────────────────────┐
│               Node/Express Orchestrator API                  │
│  - intent parsing → plan (calls model runtime)                │
│  - task/step state machine                                    │
│  - router: API vs browser vs desktop                          │
│  - risk-tier classifier + approval gate                       │
│  - audit logger                                                │
└──┬───────────┬───────────┬───────────┬────────────┬─────────┘
   │           │           │           │            │
   ▼           ▼           ▼           ▼            ▼
┌──────┐  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐
│Model  │  │Browser   │ │Desktop   │ │Direct API│ │Memory/  │
│Runtime│  │Automation│ │Control   │ │Clients   │ │Vector   │
│(llama.│  │(Playwright│ │(v2:      │ │(Gmail,   │ │Store    │
│cpp +  │  │)         │ │screenshot│ │Calendar) │ │(Chroma/ │
│Qwen3- │  │          │ │+ mouse/kb│ │          │ │SQLite)  │
│VL-4B) │  │          │ │loop)     │ │          │ │         │
└──────┘  └──────────┘ └──────────┘ └──────────┘ └────────┘
```

## 2. Component responsibilities

| Layer | Responsibility | v1 tooling (free) | Later upgrade |
|---|---|---|---|
| Voice service | Wake-word detection, speech-to-text, text-to-speech | openWakeWord or Porcupine (free tier) + faster-whisper (local) + Piper TTS | Cloud STT/TTS for higher accuracy if needed |
| Frontend | Command input, task queue, approvals, logs, listening indicator | React + Vite, packaged with Electron for a real desktop app | — |
| Orchestrator | Plan tasks, route steps, enforce guardrails | Node/Express | — |
| Model runtime | Intent parsing, planning, summarization **and** vision (screen understanding) — single vision-capable model handles both planning and screenshot-description calls via one client interface | llama.cpp (Vulkan backend), Qwen3-VL-4B GGUF Q4 (Q4_K_M, ~3–6GB at Q4, Apache 2.0) — vision-capable natively, one model for text and image+prompt | Claude/GPT-4o API as optional fallback for hard reasoning only (not required for vision) |
| Browser automation | Website/form control, DOM-aware actions | Playwright | — (stays free) |
| Desktop control (v2) | Screenshot + mouse/keyboard loop for native apps | PyAutoGUI / open-source computer-use agent — uses `describeScreen()` from the model runtime (no separate vision integration) | — (local vision already covered by Qwen3-VL; cloud fallback only if local quality proves insufficient) |
| Integrations | Gmail, Calendar, structured actions | Google APIs (free tier) | — |
| Memory | Preferences, task history, RAG context | SQLite + vectra (or Chroma) | — |
| Guardrails | Risk classification, approval gate, logging | Custom Node middleware | — |

### Why llama.cpp + Vulkan on this hardware

The dev machine for this project uses an **AMD RX 5500M (Navi 14 / gfx1012)**. That GPU is **not officially supported by ROCm** — AMD's ROCm 7.x only covers RDNA 3 / RDNA 4 desktop cards and Instinct data-center chips. Building or running a ROCm-backed runtime on this hardware is not viable.

The practical local inference path here is **llama.cpp with the Vulkan backend**. Vulkan works across AMD/Intel/Nvidia GPUs without requiring vendor ML driver stacks (ROCm/CUDA), and llama.cpp's Vulkan path correctly offloads transformer layers to this GPU. The model was chosen to match this constraint: **Qwen3-VL-4B in GGUF Q4_K_M** (~3–6 GB) runs comfortably within 8 GB total system RAM while providing native GUI/screen understanding and agent tool-use, Apache 2.0 licensed.

This decision is **hardware-specific to this machine**. If the dev hardware changes (e.g. to an NVIDIA card with CUDA or an AMD card with official ROCm support), revisit the runtime/backend choice and re-run the validation in `07-IMPLEMENTATION-PLAN.md` Phase 0.5. The single-client abstraction (`generatePlan()` + `describeScreen()` in `backend/src/model/`) is intended to isolate that swap.

The model runtime component exposes **one client interface for both text-only planning calls and vision calls** (e.g. "describe what's on this screenshot") because Qwen3-VL handles both natively — do not build separate text and vision model integrations for v1. A multi-model router (separate fast/vision/reasoning models) is explicitly deferred — see `08-FUTURE-SCOPE.md` — and is not part of the MVP.

## 3. Routing rule (core design decision — do not skip)

For every planned step, the orchestrator picks a channel in this order:

1. **Direct API** — if the target service has one (Gmail, Calendar). Fastest, least fragile.
2. **Browser automation (Playwright)** — for websites without a usable API. DOM-aware, no vision needed.
3. **Desktop/screen control** — only for native apps, or when 1 and 2 aren't possible. Most fragile, used last.

Enforce this in code as an explicit function (`chooseChannel(step)`), not as a loose convention. Every step must resolve to exactly one channel before execution.

**Vision-model call scope:** vision calls to the model runtime (`describeScreen(imageBuffer, prompt)`) are invoked **only** for read-screen / desktop-control / ambiguous cases where DOM/API context is insufficient — for example, interpreting a native app screenshot, disambiguating an unlabeled control, or handling a "what's on my screen?" query. **Browser automation stays DOM-first via Playwright per the priority order above** — do not add vision calls to the browser path for cases Playwright can already handle (navigation, clicking selectors, reading DOM text). This scope does not change the routing priority.

## 4. Voice pipeline detail

```
Mic (always listening, low CPU)
   → Wake-word model (tiny, runs continuously, local)
       → on detect: play confirm tone, light up UI orb
       → open a short recording window
           → STT (faster-whisper, local) transcribes command
               → sent to Orchestrator as if typed in the command box
                   → orchestrator plans + routes as normal (plan generated via llama.cpp + Qwen3-VL runtime)
                       → response spoken back via TTS (Piper, local)
                           + shown in dashboard log
```

Full detail in `03-VOICE-INTERFACE.md`.

## 5. Folder structure

```
jarwizz/
├── voice-service/
│   ├── wakeword/           # wake-word model + listener loop
│   ├── stt/                # faster-whisper wrapper
│   ├── tts/                # Piper wrapper
│   └── main.py              # ties mic → wake word → STT → send to backend
├── backend/
│   ├── src/
│   │   ├── orchestrator/    # plan → step routing logic
│   │   ├── router/          # chooseChannel(step) — API vs browser vs desktop
│   │   ├── model/           # llama.cpp client (Qwen3-VL, exposes generatePlan + describeScreen) + cloud client later
│   │   ├── automation/
│   │   │   ├── browser/     # Playwright actions
│   │   │   └── desktop/     # (v2) screenshot/action loop
│   │   ├── integrations/
│   │   │   └── gmail/
│   │   ├── memory/          # SQLite + vector index
│   │   ├── guardrails/      # risk classifier, approval gate, logger
│   │   └── server.js
│   ├── .env
│   └── package.json
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── ListeningOrb.jsx
│       │   ├── CommandBox.jsx
│       │   ├── TaskQueue.jsx
│       │   ├── ApprovalModal.jsx
│       │   └── LogViewer.jsx
│       ├── theme/            # design tokens from 04-UI-DESIGN-SYSTEM.md
│       └── App.jsx
└── docs/                     # this doc set
```

## 6. Data flow for a single command (concrete example)

"Jarwizz, wake up" → "Send an email to Raj confirming tomorrow's meeting."

1. Voice service detects wake word → confirm tone → records → transcribes to text.
2. Text sent to orchestrator via WebSocket.
3. Orchestrator sends the text + relevant memory (Raj's email, past meeting context) to the local model runtime (llama.cpp server + Qwen3-VL-4B) for planning.
4. Model returns a plan: `[find Raj's email address from memory] → [draft email via Gmail API] → [show draft for approval] → [send on confirm]`.
5. Router classifies "send email" as irreversible tier → approval gate triggers.
6. Dashboard shows the draft; TTS reads a short summary aloud; waits for "yes"/"confirm" (voice or click).
7. On approval: Gmail API sends the email. Action logged with full payload and timestamp.
8. TTS confirms: "Sent to Raj."
