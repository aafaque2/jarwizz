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
│(Ollama│  │(Playwright│ │(v2:      │ │(Gmail,   │ │Store    │
│local, │  │)         │ │screenshot│ │Calendar) │ │(Chroma/ │
│cloud  │  │          │ │+ mouse/kb│ │          │ │SQLite)  │
│later) │  │          │ │loop)     │ │          │ │         │
└──────┘  └──────────┘ └──────────┘ └──────────┘ └────────┘
```

## 2. Component responsibilities

| Layer | Responsibility | v1 tooling (free) | Later upgrade |
|---|---|---|---|
| Voice service | Wake-word detection, speech-to-text, text-to-speech | openWakeWord or Porcupine (free tier) + faster-whisper (local) + Piper TTS | Cloud STT/TTS for higher accuracy if needed |
| Frontend | Command input, task queue, approvals, logs, listening indicator | React + Vite, packaged with Electron for a real desktop app | — |
| Orchestrator | Plan tasks, route steps, enforce guardrails | Node/Express | — |
| Model runtime | Intent parsing, planning, summarization | Ollama (Llama 3.1/3.2 8B, or Qwen2.5) | Claude/GPT-4o API for hard reasoning or vision |
| Browser automation | Website/form control, DOM-aware actions | Playwright | — (stays free) |
| Desktop control (v2) | Screenshot + mouse/keyboard loop for native apps | PyAutoGUI / open-source computer-use agent | Cloud vision model for screen understanding |
| Integrations | Gmail, Calendar, structured actions | Google APIs (free tier) | — |
| Memory | Preferences, task history, RAG context | SQLite + vectra (or Chroma) | — |
| Guardrails | Risk classification, approval gate, logging | Custom Node middleware | — |

## 3. Routing rule (core design decision — do not skip)

For every planned step, the orchestrator picks a channel in this order:

1. **Direct API** — if the target service has one (Gmail, Calendar). Fastest, least fragile.
2. **Browser automation (Playwright)** — for websites without a usable API. DOM-aware, no vision needed.
3. **Desktop/screen control** — only for native apps, or when 1 and 2 aren't possible. Most fragile, used last.

Enforce this in code as an explicit function (`chooseChannel(step)`), not as a loose convention. Every step must resolve to exactly one channel before execution.

## 4. Voice pipeline detail

```
Mic (always listening, low CPU)
   → Wake-word model (tiny, runs continuously, local)
       → on detect: play confirm tone, light up UI orb
       → open a short recording window
           → STT (faster-whisper, local) transcribes command
               → sent to Orchestrator as if typed in the command box
                   → orchestrator plans + routes as normal
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
│   │   ├── model/           # Ollama client (+ cloud client later)
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
3. Orchestrator sends the text + relevant memory (Raj's email, past meeting context) to the local model for planning.
4. Model returns a plan: `[find Raj's email address from memory] → [draft email via Gmail API] → [show draft for approval] → [send on confirm]`.
5. Router classifies "send email" as irreversible tier → approval gate triggers.
6. Dashboard shows the draft; TTS reads a short summary aloud; waits for "yes"/"confirm" (voice or click).
7. On approval: Gmail API sends the email. Action logged with full payload and timestamp.
8. TTS confirms: "Sent to Raj."
