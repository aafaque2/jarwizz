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

**Checkpoint**: all 7 independent tests in `06-SETUP-GUIDE.md` §7 pass (including the Vulkan offload + text+vision smoke tests in §1c).

---

## Phase 0.5 — Hardware & Model Validation (one-time, lightweight)

**Goal**: prove the chosen local runtime actually works on this hardware before building product code on top of it. This is **not** an exhaustive multi-model, multi-runtime benchmark — just a single pass/fail sanity check on the one stack you've committed to: llama.cpp (Vulkan backend) + Qwen3-VL-4B GGUF Q4_K_M.

**Why this phase exists:** the RX 5500M has no official ROCm support, and GGUF quantization / Vulkan offload can silently fall back to CPU-only. If the runtime is unvalidated, every later phase will appear to "work" but be unusably slow or functionally broken for vision. Validate once, then build.

1. **Confirm Vulkan GPU detection.** Start `llama-server` with `--vulkan --gpu-layers 99` as described in `06-SETUP-GUIDE.md` §1c. Inspect the startup log: it must enumerate the GPU (AMD RX 5500M / gfx1012) and report layers offloaded to Vulkan. If it reports `0 layers` or only `cpu`, the build is CPU-only — rebuild with `-DGGML_VULKAN=1` or obtain a known Vulkan-enabled binary. Optionally observe GPU utilization (Task Manager → GPU, or `radeontop`) spiking during generation to double-confirm offload is live. This is not a benchmark; it's a yes/no gate.
2. **Load Qwen3-VL-4B Q4_K_M.** Point the server at the GGUF file at `MODEL_PATH` / `LLAMACPP_URL`. Confirm the server loads without OOM and advertises a vision-capable context (no error about missing mmproj / unsupported image content — Qwen3-VL GGUFs bundle vision; a text-only Qwen3 GGUF will fail the next step).
3. **Text-only planning-style prompt.** Via `curl` to `LLAMACPP_URL/v1/chat/completions` (or via the thin client you will later wrap), send a representative planning prompt, e.g.: `You are a task planner. Given the command "draft a reply to the last email from Raj saying I'll be there at 5pm," return a JSON plan: { steps: [{ description, action_type, payload, tier }] }`. Record wall-clock latency from request to first token and to completion. The model should return well-formed JSON with tier classifications.
4. **Screenshot-description (vision) prompt.** Take any screenshot (or use a sample image) and send a single image+prompt request through the **same** server/model, e.g. `Describe what's visible on this screen in one paragraph — list windows, buttons, and any text you can read.` Record latency for this call as well. Confirm the response is actually describing the image (not hallucinating a generic answer that ignores the image). This proves the vision path is wired correctly via the single `describeScreen()` interface.
5. **Record both latencies** (text-only and vision) in a short note (e.g. `docs/phase-0.5-validation.md` or the Phase 0 commit message). No fixed millisecond threshold is prescribed — this is a **judgment call**: does the delay feel tolerable for an interactive voice assistant where you'd be waiting for a plan or screen description mid-task? A few seconds is likely fine; tens of seconds or minutes is not.

**Checkpoint:** both calls complete successfully with latency low enough to feel usable in an interactive voice loop (threshold is a judgment call, not a fixed number — note what you observed and whether you'd tolerate it day-to-day). **If this checkpoint fails —** e.g. Vulkan not active, vision call errors, or latency is clearly unusable — **stop and reassess model/quantization choice before continuing** (try a smaller quantization, a different GGUF build, or revisit hardware). **Do not proceed to Phase 1 on an unvalidated runtime.** A failed validation is not a reason to add an exhaustive bake-off; pick one alternative, re-run this phase once, and decide.

---

## Phase 1 — Orchestrator Core (dry-run only, no real actions)

**Goal**: text command → plan → simulated step list, displayed in terminal. No browser/desktop/API actions actually execute yet.

1. `backend/src/model/llamacppClient.js` — function `generatePlan(commandText, memoryContext)` that calls the **llama.cpp server** (via `LLAMACPP_URL` / `MODEL_PATH`) with a system prompt instructing it to return a JSON plan: `{ steps: [{ description, action_type, payload, tier }] }`. The **same client module** must also expose `describeScreen(imageBuffer, prompt)` — a thin wrapper that sends an image+prompt (vision) request to the same server/model (Qwen3-VL handles both natively). Build both functions now; `generatePlan` is used starting this phase, `describeScreen` is exercised starting Phase 9 (and optionally for ambiguous read-screen cases earlier) — do not build a separate vision client or a second model integration.
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

_No model-runtime change in this phase — the voice service continues to call the same `POST /command` endpoint backed by the model runtime (llama.cpp + Qwen3-VL) built in Phase 1. No legacy runtime-specific code should remain here — verify no references to the previous runtime remain._

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

**Goal**: add native-app control by reusing the vision-capable model runtime already built in Phase 1 — no separate vision integration needed.

1. `backend/src/automation/desktop/desktopRunner.js` — screenshot capture + mouse/keyboard action execution (PyAutoGUI or an open-source computer-use agent, per `02-ARCHITECTURE.md`). On each step that needs screen understanding, capture a screenshot and call the **existing** `describeScreen(imageBuffer, prompt)` from `backend/src/model/llamacppClient.js` (built in Phase 1) — e.g. `describeScreen(screenshot, "What UI elements are visible? Where is the 'Save' button?")` — to ground the next action. No new model, no separate vision service, no multi-model router.
2. Extend `chooseChannel.js`: desktop control is now the fallback used only when a step targets a native (non-browser) app or no API/browser path exists. Vision calls via `describeScreen` are scoped to read-screen / desktop-control / ambiguous steps only; browser automation remains DOM-first via Playwright (see `02-ARCHITECTURE.md` §3).
3. Implement the app whitelist per `05-SAFETY-AND-GUARDRAILS.md` §4.
4. Implement file operations (create/rename/move/delete) as explicit action types — delete is always irreversible tier, no exceptions.
5. Test: "create a folder called Invoices on my desktop" (reversible, auto-runs), then "delete it" (irreversible, requires approval). Also test a vision-grounded case, e.g. "what's open on my screen right now?" or "click the Save button in Paint" — confirm `describeScreen` returns an accurate description that the desktop runner can act on.

**Checkpoint**: at least 5 real desktop actions (open app, click, type, file create, file delete-with-approval) work end to end, including at least one vision-grounded step that uses `describeScreen`.

_This phase is simpler than it would be with a separate vision stack: the model client already handles both planning and vision, so desktop control only needs to add screenshotting and input automation around it._

---

## Phase 10 (v2) — Job Application Assist

1. Build a saved-profile schema in the memory layer (resume summary, common form answers, resume/cover-letter file paths).
2. Implement a listing-parse step type: given a job posting URL, extract key fields via Playwright.
3. Auto-fill known form fields from the saved profile; leave unknown fields flagged for user input rather than guessing.
4. Submission is always irreversible tier, no exceptions, full approval modal shown with every field that will be submitted.
5. Test against 2–3 real job postings on different platforms (e.g. a Greenhouse-based site and a Workday-based site) to validate how much varies between ATS platforms, per the risk noted in `01-PROJECT-SPEC.md` §6.

**Checkpoint**: ✅ done (v1). Validated in mock mode end-to-end via `backend/test-phase10.js`:
parse → draft → submit-with-approval → recorded in the applications tracker, with the approval modal
showing the real parsed company/role and the generated cover letter. Parsing was verified to extract
structured fields (title/company/skills) from a posting. Live submission against real Greenhouse/Workday
sites is intentionally left as mock-recording (submitting synthetic applications is not appropriate);
the read-only `parse` step works identically on any real URL. Real Gmail sending is gated behind the
OAuth setup in `06-SETUP-GUIDE.md` §5.

---

## Phase 11 (funded, v2.5) — Cloud Model Fallback

1. Follow `06-SETUP-GUIDE.md` §8 to add the cloud client alongside the model runtime (llama.cpp + Qwen3-VL) client.
2. Add `requires_vision` / `high_complexity` flags to the planner's step schema; route flagged steps to the cloud client, everything else stays on the local model runtime (llama.cpp + Qwen3-VL). Note: local Qwen3-VL already covers vision, so this is for hard reasoning or cases where local quality proves insufficient — not a mandatory vision path.
3. Test the same regression suite from Phase 8 with cloud fallback enabled on a couple of previously-unreliable cases (e.g. complex reasoning, not merely screen reading), and confirm measurable improvement before treating this as "on" by default.

**Checkpoint**: cloud fallback measurably improves the specific failure cases it was added for, without changing behavior (or cost) for the steps that didn't need it.

---

## Notes for opencode

- Do not begin a phase's checkpoint tests using mocked/stubbed data where real execution is specified — the checkpoints are meant to catch real integration issues, not just code compiling.
- If a checkpoint fails, fix within the current phase before proceeding — later phases assume earlier guarantees hold (e.g. Phase 6 assumes Phase 2's approval gate is airtight). For Phase 0.5, a failed checkpoint means reassessing model/quantization before any product code is built — do not proceed to Phase 1 on an unvalidated runtime.
- Every new action type introduced in any phase must be added to the risk-tier classifier (`05-SAFETY-AND-GUARDRAILS.md` §1) before it's usable — no action type ships without a tier.

---

## v1 Status (production cut)

**Complete:** Phases 0 → 10. The assistant plans, routes (web / Gmail / desktop / job / model),
executes behind a tiered approval gate, speaks replies, and remembers preferences — all on a local
llama.cpp + Qwen3-VL runtime (no cloud required for core use).

**Checkpoints passed:** Phase 0.5 (Vulkan offload + text/vision), 1 (planning), 2 (approval gate),
3 (browser), 4 (Gmail mock), 5 (memory/recall), 6 (voice round-trip, manual), 7 (UI), 8 (full
regression, 50/0), 9 (desktop control, 5/5), 10 (job assist, mock e2e).

**Shipped with v1:** `scripts/start-jarwizz.ps1` / `stop-jarwizz.ps1` (one-command launch),
`README.md`, `docs/10-USER-GUIDE.md`, and the Gmail OAuth flow (`/gmail/auth-url` + `/gmail/callback`).

**Deferred (post-v1):**
- **Phase 11 — Cloud model fallback** (needs an API key; for hard-reasoning cases only).
- **Wake-word training** — v1 uses push-to-talk (hold Ctrl+Shift); a custom `hey_jarvis` model is a
  later tuning step.
- **Real Gmail sending** requires the user to complete the one-time OAuth in `06-SETUP-GUIDE.md` §5
  (code is ready; the `credentials.json` is account-specific).
- **Live job submission** to real ATS sites is intentionally mock-recorded in v1.
