# Future Scope — Research Later, Not v1/v2

These are ideas worth exploring once the MVP (through Phase 8) and v2
(Phases 9–10) are stable and you're actually living with the assistant day
to day. None of these are committed — treat this as a research backlog to
revisit, not a roadmap.

## Capability expansion

- **Proactive automation / scheduling** — Jarwizz doing things on a timer or trigger ("every morning, summarize my unread emails") rather than only reacting to a spoken command.
- **Plugin/skill marketplace** — a defined interface so new capabilities (home automation, a specific SaaS tool, a niche workflow) can be added without touching core orchestrator code.
- **Multi-device presence** — a lightweight companion that lets you trigger/check tasks from your phone, with the heavy execution still happening on your main machine.
- **Smart home integration** — voice commands extending beyond the computer (lights, thermostats) via existing home-automation APIs.
- **Better desktop vision** — evaluate newer open-source vision-language models as they mature; local screen-understanding quality is improving fast and the "needs cloud" gap may shrink over time.

## Reliability & intelligence

- **Fine-tuning a local model on your own usage patterns** — over time, your command phrasing, common tasks, and preferences could fine-tune a small local model to plan more accurately without needing cloud fallback as often.
- **Better memory consolidation** — summarizing/pruning old task history intelligently rather than letting the memory store grow unbounded.
- **Self-correcting execution** — steps that detect their own likely failure (e.g. a click didn't produce the expected page state) and retry or re-plan rather than just failing.
- **Multi-model router (separate fast / vision / reasoning models)** — explicitly deferred from v1. The MVP uses a single vision-capable model (Qwen3-VL-4B via llama.cpp) for both planning and screen understanding through one client interface. A router that splits traffic across specialized models is a later optimization to revisit only if latency/quality tradeoffs justify the added complexity — not something to build now.

## Platform maturity

- **Multi-user / role-based permissions** — only relevant if this ever grows beyond a personal tool.
- **Sandboxing/isolation** — running desktop-control and browser-automation actions inside a more isolated environment for extra safety margin, especially if you ever loosen the approval gate for convenience.
- **Cost optimization for cloud fallback** — once cloud usage is real, track which step types actually benefit from it versus which were fine on local models all along, and tighten the routing rules accordingly.
- **Formal evals** — a small internal test suite of representative commands run periodically to catch regressions as you keep extending the system, rather than relying only on manual spot-checks.

## Explicitly out of scope indefinitely (revisit only if your risk tolerance changes)

- Fully autonomous submission of anything irreversible without a human confirm step.
- Any CAPTCHA/anti-bot circumvention.
- Any autonomous financial/payment action.

Revisit this list after Phase 8 (MVP) is genuinely stable in daily use — that's the right point to pick 1–2 items here to prototype next, rather than trying to plan them all now.
