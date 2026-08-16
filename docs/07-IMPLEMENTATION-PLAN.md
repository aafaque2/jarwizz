# Jarwizz — Chronological Implementation Plan

This is the master build sequence. Execute phases in order. Each phase ends
with a **Checkpoint** — do not proceed to the next phase until the checkpoint
passes. Read `02-ARCHITECTURE.md`, `04-UI-DESIGN-SYSTEM.md`, and
`05-SAFETY-AND-GUARDRAILS.md` as reference whenever a step touches those areas.

---

## Phase 0 — Environment & Repo Skeleton

**Goal**: everything installed, empty services running, nothing wired together yet.

1. Follow `06-SETUP-GUIDE.md` sections 0–6 completely.
2. Create the folder structure exactly as laid out in `02-ARCHITECTURE.md` §5.
3. Initialize git, commit the empty skeleton.
4. Create a root `README.md` linking to `docs/00-README.md`.

**Checkpoint**: all 7 independent tests in `06-SETUP-GUIDE.md` §7 pass.

---

## Phase 1 — Orchestrator Core (dry-run only, no real actions)

**Goal**: text command → plan → simulated step list, displayed in terminal. No browser/desktop/API actions actually execute yet.

1. `backend/src/model/ollamaClient.js` — function `generatePlan(commandText, memoryContext)` that calls Ollama with a system prompt instructing it to return a JSON plan: `{ steps: [{ description, action_type, payload, tier }] }`.
2. Write the planning system prompt carefully — it must always classify each step's `tier` as one of `read-only | reversible | irreversible` per `05-SAFETY-AND-GUARDRAILS.md` §1. Default to `irreversible` when unsure.
3. `backend/src/orchestrator/taskRunner.js` — takes a plan, iterates steps, and for now just logs each step to console with its tier (no execution).
4. `backend/src/server.js` — Express app with a `POST /command` endpoint: accepts `{ text }`, calls `generatePlan`, returns the plan JSON.
5. Build the **kill switch** now, even though nothing runs yet: `POST /stop` endpoint that sets a global `stopFlag`, checked between every step in `taskRunner.js`.
6. Test via `curl -X POST localhost:4000/command -d '{"text":"open chrome and search for cats"}'` — confirm a sensible JSON plan comes back with correct tiers.

**Checkpoint**: 10 varied test commands (mix of read-only, reversible, irreversible intent) all return correctly tiered plans. Kill switch flag is checked and honored in the runner loop.

---

## Phase 2 — Guardrails & Action Log (still dry-run)

**Goal**: approval gate and logging fully wired, still against simulated execution.

1. `backend/src/guardrails/classifier.js` — validates/re-checks tier classification from the model output against the whitelist rules in `05-SAFETY-AND-GUARDRAILS.md` §1 (defense in depth — don't fully trust the model's self-classification).
2. `backend/src/guardrails/logger.js` — implements the action log schema from `05-SAFETY-AND-GUARDRAILS.md` §3, writing append-only to a `logs.jsonl` file (swap to SQLite in Phase 5 if preferred).
3. Modify `taskRunner.js`: read-only/reversible steps auto-"execute" (still simulated) and log immediately; irreversible steps instead emit a `pending_approval` event via WebSocket and wait.
4. `backend/src/server.js` — add WebSocket support (`ws` package): broadcast plan updates, approval requests, and step results to any connected client.
5. Add `POST /approve/:stepId` and `POST /reject/:stepId` endpoints that unblock or cancel a pending step in `taskRunner.js`.
6. Test with a WebSocket client (or simple script) — send a command that includes an irreversible step, confirm it pauses, approve it via the endpoint, confirm it then logs as `approved` and "executes."

**Checkpoint**: irreversible-tier steps reliably pause for approval; approve/reject endpoints work; every step (of every tier) produces a correctly-shaped log entry.

---

## Phase 3 — Browser Automation (real execution begins)

**Goal**: reversible/read-only browser actions actually execute via Playwright.

1. `backend/src/automation/browser/playwrightRunner.js` — a persistent Playwright browser context the orchestrator can reuse across steps within a task (don't relaunch per step).
2. Implement action handlers for the action types the model plans against: `browser_open`, `browser_click`, `browser_type`, `browser_scroll`, `browser_read` (extract text/summarize).
3. `backend/src/router/chooseChannel.js` — implements the priority rule from `02-ARCHITECTURE.md` §3: for now, since only browser automation exists, all non-API steps route to it.
4. Wire real execution into `taskRunner.js`, replacing the Phase 1–2 simulation for browser-type steps. Capture before/after screenshots for every step, attach to the log entry.
5. Domain whitelist: `backend/src/guardrails/whitelist.js` — checks target domain before any browser step runs; if not whitelisted, force `irreversible` tier for that step regardless of its original classification (triggers approval).
6. Test: "Open example.com and read the page title back to me" end to end — real browser opens, navigates, reads, logs, no approval needed (read-only). Then test "go to a new, non-whitelisted site" — confirm it forces an approval prompt.

**Checkpoint**: at least 5 distinct real browser tasks (navigate, click, type into a field, scroll, extract text) complete successfully end to end with correct logging and screenshots.

---

## Phase 4 — Gmail Integration

**Goal**: real read/draft/send-after-confirm email capability.

1. `backend/src/integrations/gmail/client.js` — OAuth flow using the credentials from `06-SETUP-GUIDE.md` §5, token storage in `backend/secrets/`.
2. Implement `readRecentEmails()`, `draftEmail(to, subject, body)`, `sendEmail(draftId)`.
3. Add `gmail_draft` (reversible tier) and `gmail_send` (irreversible tier — always) as new action types recognized by the planner and router. Update the Phase 1 system prompt so the model knows these exist and when to use them.
4. Route these through the **API-first** branch of `chooseChannel.js` — never through Playwright/Gmail-web-UI automation.
5. Test: "Read my 3 most recent emails and summarize them" (read-only, auto-runs). Then "Draft a reply to the latest one saying I'll be there at 5pm" (reversible, auto-drafts) then "send it" (irreversible, requires approval) — confirm the full chain works and only sends after explicit approval.

**Checkpoint**: full read → draft → approve → send cycle works via real Gmail account, fully logged.

---

## Phase 5 — Memory Layer

**Goal**: preferences and task history persist and inform future planning.

1. `backend/src/memory/store.js` — SQLite tables: `preferences`, `task_history`, plus a `vectra` index for semantic recall (e.g. "what did I say my resume summary was").
2. On every completed task, store a compact summary + embedding in memory.
3. Before generating a plan (Phase 1's `generatePlan`), retrieve top-k relevant memory items and inject them into the model's context.
4. Add a simple `preferences` set/get API so things like "always CC my personal email" or saved job-application profile fields can be stored and reused.
5. Test: tell it "my name is [X] and my email is [Y]," end the session, restart the backend, ask a new task that references "my email" — confirm it recalls correctly from memory, not from re-asking.

**Checkpoint**: preferences and task history survive a full backend restart and are correctly retrieved into new plans.

---

## Phase 6 — Voice Service Integration

**Goal**: wake word → STT → command pipeline connects live to the orchestrator; TTS speaks responses.

1. Build `voice-service/main.py`: continuous wake-word listener (per `03-VOICE-INTERFACE.md` §4) → on trigger, record command window → transcribe via faster-whisper → POST the text to the backend's `/command` endpoint (same path as Phase 1's text input — no backend changes needed here).
2. Implement the "stop" priority phrase as a second, always-armed listener calling `POST /stop` directly, independent of the main wake-word flow.
3. `voice-service/tts/speak.py` — wraps Piper; the voice service subscribes to the backend's WebSocket stream and speaks a short summary whenever a step completes or an approval is needed.
4. Implement all 6 listening states from `03-VOICE-INTERFACE.md` §3 as events the voice service emits over WebSocket, for the frontend orb (Phase 7) to consume.
5. Handle low-confidence transcriptions per `03-VOICE-INTERFACE.md` §6 — force irreversible tier + explicit re-confirmation.
6. Test end to end with voice only, no UI yet: say "Jarwizz, wake up," then a real command, confirm it executes and speaks a result. Test "Jarwizz, stop" mid-task.

**Checkpoint**: full voice round trip works reliably across 10 varied spoken commands in a normal room (not silent), including at least one irreversible-tier command requiring spoken "yes" to proceed, and one live "stop" interrupting an in-progress task.

---

## Phase 7 — Dashboard UI

**Goal**: the full dark-green dashboard from `04-UI-DESIGN-SYSTEM.md`, live-wired to backend/voice state.

1. Apply the Tailwind theme tokens from `06-SETUP-GUIDE.md` §2.
2. Build `ListeningOrb.jsx` first, driven by a `state` prop, styled exactly per the 6 states in `03-VOICE-INTERFACE.md` §3 / `04-UI-DESIGN-SYSTEM.md` §3.
3. Build `CommandBox.jsx` — text fallback input, posts to `/command` same as voice.
4. Build `TaskQueue.jsx` — subscribes to WebSocket task/step events, renders tiered status badges.
5. Build `ApprovalModal.jsx` — triggered by `pending_approval` WebSocket events, calls `/approve/:stepId` or `/reject/:stepId`; also listens for spoken "yes"/"no" via a WebSocket event from the voice service while open.
6. Build `LogViewer.jsx` — reads the action log (via a new `GET /logs` endpoint), filterable, expandable rows showing screenshots and payloads.
7. Wire the top bar: Orb + "Jarwizz" title + a permanently visible **Stop** button calling `/stop` directly.
8. (Optional but recommended) Package the frontend with Electron so it's a real always-available desktop app rather than a browser tab.

**Checkpoint**: with voice service and backend both running, the dashboard accurately reflects live state — orb changes correctly through all 6 states, task queue updates in real time, approval modal appears and correctly handles both click and spoken confirmation, log viewer shows full history with screenshots.

---

## Phase 8 — End-to-End MVP Validation

**Goal**: confirm the full system meets the success criteria from `01-PROJECT-SPEC.md` §6.

1. Run the exact scenario from the spec: "Jarwizz, wake up" → "open Gmail and draft a reply to the last email from [X] saying [Y]" → verify wake → browse/API routing decision is correct → draft created → read back → sends only after explicit "yes."
2. Run a full regression pass: at least one command per action type built so far (browser nav/click/type/scroll/read, Gmail read/draft/send, memory recall, stop mid-task, non-whitelisted domain approval, low-confidence voice re-confirmation).
3. Fix any reliability gaps found — this phase is allowed to loop; don't move to v2 features until regression passes cleanly.

**Checkpoint**: MVP is what you'd actually leave running day to day. This is the real "v1 done" milestone.

---

## Phase 9 (v2) — Desktop Control

1. `backend/src/automation/desktop/desktopRunner.js` — screenshot capture + mouse/keyboard action execution (PyAutoGUI or an open-source computer-use agent, per `02-ARCHITECTURE.md`).
2. Extend `chooseChannel.js`: desktop control is now the fallback used only when a step targets a native (non-browser) app or no API/browser path exists.
3. Implement the app whitelist per `05-SAFETY-AND-GUARDRAILS.md` §4.
4. Implement file operations (create/rename/move/delete) as explicit action types — delete is always irreversible tier, no exceptions.
5. Test: "create a folder called Invoices on my desktop" (reversible, auto-runs), then "delete it" (irreversible, requires approval).

**Checkpoint**: at least 5 real desktop actions (open app, click, type, file create, file delete-with-approval) work end to end.

---

## Phase 10 (v2) — Job Application Assist

1. Build a saved-profile schema in the memory layer (resume summary, common form answers, resume/cover-letter file paths).
2. Implement a listing-parse step type: given a job posting URL, extract key fields via Playwright.
3. Auto-fill known form fields from the saved profile; leave unknown fields flagged for user input rather than guessing.
4. Submission is always irreversible tier, no exceptions, full approval modal shown with every field that will be submitted.
5. Test against 2–3 real job postings on different platforms (e.g. a Greenhouse-based site and a Workday-based site) to validate how much varies between ATS platforms, per the risk noted in `01-PROJECT-SPEC.md` §6.

**Checkpoint**: at least one real successful assisted application completed, with a clean log of every field submitted.

---

## Phase 11 (funded, v2.5) — Cloud Model Fallback

1. Follow `06-SETUP-GUIDE.md` §8 to add the cloud client alongside the Ollama client.
2. Add `requires_vision` / `high_complexity` flags to the planner's step schema; route flagged steps to the cloud client, everything else stays on Ollama.
3. Test the same regression suite from Phase 8 with cloud fallback enabled on a couple of previously-unreliable screen-understanding cases, and confirm measurable improvement before treating this as "on" by default.

**Checkpoint**: cloud fallback measurably improves the specific failure cases it was added for, without changing behavior (or cost) for the steps that didn't need it.

---

## Notes for opencode

- Do not begin a phase's checkpoint tests using mocked/stubbed data where real execution is specified — the checkpoints are meant to catch real integration issues, not just code compiling.
- If a checkpoint fails, fix within the current phase before proceeding — later phases assume earlier guarantees hold (e.g. Phase 6 assumes Phase 2's approval gate is airtight).
- Every new action type introduced in any phase must be added to the risk-tier classifier (`05-SAFETY-AND-GUARDRAILS.md` §1) before it's usable — no action type ships without a tier.
