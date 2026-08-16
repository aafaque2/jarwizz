# Jarwizz — Personal AI Assistant — Doc Index

This folder is the complete spec for **Jarwizz**, a voice-activated, locally-run
personal AI assistant. Read/feed to opencode in this order:

| # | File | What it covers |
|---|---|---|
| 1 | `01-PROJECT-SPEC.md` | What Jarwizz actually is, in plain language. Full feature list, goals, non-goals. |
| 2 | `02-ARCHITECTURE.md` | System design, components, routing logic, folder structure. |
| 3 | `03-VOICE-INTERFACE.md` | Wake word ("Jarwizz, wake up"), speech-to-text, text-to-speech pipeline. |
| 4 | `04-UI-DESIGN-SYSTEM.md` | Dark theme + rich green visual identity, component specs. |
| 5 | `05-SAFETY-AND-GUARDRAILS.md` | Approval tiers, logging, kill switch, voice confirmation flow. |
| 6 | `06-SETUP-GUIDE.md` | Exact commands to install the full free local stack. |
| 7 | `07-IMPLEMENTATION-PLAN.md` | **The build plan.** Chronological, phase-by-phase, step-by-step. Give this to opencode as the primary task list. |
| 8 | `08-FUTURE-SCOPE.md` | Ideas to research later, once MVP is stable. Not for v1. |

## How to use this with opencode

1. Drop this whole `docs/` folder into the root of your empty project repo.
2. Start opencode in that repo.
3. Point it at `07-IMPLEMENTATION-PLAN.md` and tell it to execute Phase 0 → Phase 1
   → ... in order, checking off each numbered step. It should read
   `02-ARCHITECTURE.md`, `04-UI-DESIGN-SYSTEM.md`, and `05-SAFETY-AND-GUARDRAILS.md`
   as reference whenever a step touches those areas.
4. Do not let it skip ahead to later phases before earlier "checkpoint" tests
   pass — each phase's checkpoint is a gate, not a suggestion.
