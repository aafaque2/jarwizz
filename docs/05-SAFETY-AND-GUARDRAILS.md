# Safety & Guardrails Spec

Non-negotiable layer. Every risky action passes through this — no bypass flag, no exceptions, voice or text.

## 1. Risk tiers

| Tier | Examples | Behavior |
|---|---|---|
| **Read-only** | View screen, read page, summarize, search, "what's on my screen" | Auto-run, log only, blue badge |
| **Reversible** | Open app/site, scroll, navigate, create a folder, draft (not send) an email | Auto-run, log, visible in task queue, green badge |
| **Irreversible / high-impact** | Send email, submit a form, submit a job application, delete a file/folder, any payment, change account settings | **Always** requires explicit approval — voice ("yes"/"confirm") or click — before execution, amber badge |

Classify every planned step into one of these before it's allowed to run. Unknown/ambiguous actions default to irreversible tier until proven otherwise.

## 2. Approval flow (voice + UI)

```
Plan generated
     │
     ▼
Step classified (read-only / reversible / irreversible)
     │
     ├─ read-only or reversible ──► execute ──► log ──► brief TTS confirmation
     │
     └─ irreversible ──► Approval Modal shown + TTS reads summary aloud
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
          "yes"/"confirm" (voice/click)   "no"/"cancel" (voice/click)
                    │                   │
                execute + log      step skipped, logged as rejected,
                                    TTS: "Okay, cancelled."
```

**Approval Modal / spoken summary must include:**
- Plain-language description of the action.
- The exact payload if applicable (email body, form field values, file path).
- Which channel will execute it (API / browser / desktop).
- A screenshot of current state if it's a browser/desktop action.

**Low-confidence voice transcription rule**: if STT confidence is low, treat the step as irreversible tier regardless of its normal classification, and ask an explicit clarifying question before proceeding (see `03-VOICE-INTERFACE.md` §6).

## 3. Action log schema

```json
{
  "task_id": "uuid",
  "step_id": "uuid",
  "timestamp": "ISO8601",
  "input_source": "voice | text",
  "action_type": "browser_click | browser_fill | api_call | desktop_click | file_delete | ...",
  "tier": "read-only | reversible | irreversible",
  "description": "human-readable summary",
  "channel": "playwright | gmail_api | desktop_agent",
  "input_payload": {},
  "screenshot_before": "path/or/base64",
  "screenshot_after": "path/or/base64",
  "approval_status": "auto | approved | rejected",
  "approved_by": "user",
  "approval_method": "voice | click | n/a",
  "result": "success | failure",
  "error": null
}
```

Store append-only (SQLite table or JSONL file) so full task history is replayable and auditable from the Log Viewer.

## 4. Whitelists

- **Domain whitelist**: browser automation only runs on domains you've explicitly approved (or confirm inline on first visit to a new domain).
- **App whitelist** (v2): desktop control restricted to a user-approved app list.
- Anything outside a whitelist triggers a mandatory approval prompt even for otherwise reversible-tier actions.

## 5. Credential handling

- No raw passwords stored by the orchestrator — OAuth wherever a service supports it (Gmail, Calendar).
- Secrets live in a local `secrets/` directory excluded from version control, or OS-level credential storage (e.g. `keytar`) if extended later.
- CAPTCHAs and OTPs always pause the task and hand control back to you — never automated around.

## 6. Kill switch

- **Voice**: "Jarwizz, stop" is recognized as a priority phrase, always armed, independent of the normal wake-word flow — halts any in-progress task instantly.
- **UI**: a permanently visible "Stop all tasks" button in the top bar, same effect.
- On trigger: cancel pending browser/desktop actions immediately, log the interruption, orb returns to idle, TTS confirms: "Stopped."
- Build this in Phase 1 of implementation — not an afterthought, it's foundational.

## 7. Task replay

Every step logged with input/output and screenshots means any completed or failed task is replayable step-by-step in the Log Viewer — both a debugging tool and a trust-building feature since you're the only user relying on it.
