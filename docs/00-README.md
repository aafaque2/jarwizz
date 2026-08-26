# Jarwizz — Personal AI Assistant — Doc Index

This folder is the complete specification for **Jarwizz**, a voice-activated,
locally-run personal AI assistant.

| # | File | What it covers |
|---|---|---|
| 1 | `01-PROJECT-SPEC.md` | Product definition: feature list, goals, non-goals, success criteria. |
| 2 | `02-ARCHITECTURE.md` | System design, components, routing logic, folder structure. |
| 3 | `03-VOICE-INTERFACE.md` | Voice pipeline: wake word, push-to-talk, STT, TTS. |
| 4 | `04-UI-DESIGN-SYSTEM.md` | Visual identity, design tokens, core component specs. |
| 5 | `05-SAFETY-AND-GUARDRAILS.md` | Approval tiers, action logging, kill switch, voice confirmation. |
| 6 | `06-SETUP-GUIDE.md` | Installation for Windows and Linux (Arch/GNOME Wayland), model selection by hardware. |
| 7 | `07-IMPLEMENTATION-PLAN.md` | Chronological build plan with phase checkpoints; v1 status included. |
| 8 | `08-FUTURE-SCOPE.md` | Post-v1 ideas under consideration; not committed. |
| 9 | `09-MIGRATION-NOTES.md` | Historical record of the Ollama → llama.cpp migration. |
| 10 | `10-USER-GUIDE.md` | Day-to-day operation: starting services, voice commands, approvals, troubleshooting. |
| 11 | `11-PRO-UI-PLAN.md` | Approved plan for the three-layer UI (orb / dashboard / approval gateway). |

Supporting material: `phase-0.5-validation.md` records the model-runtime
validation results for the original development machine.

## How to use this with an AI coding agent

1. Place this `docs/` folder at the root of the project repository.
2. Point the agent at `07-IMPLEMENTATION-PLAN.md` and have it execute phases in
   order, using `02-ARCHITECTURE.md`, `04-UI-DESIGN-SYSTEM.md`, and
   `05-SAFETY-AND-GUARDRAILS.md` as references where steps touch those areas.
3. Treat each phase checkpoint as a gate: do not proceed until it passes.
