# Jarwizz — Pro UI/UX Plan

Status: Approved direction, ready to build
Supersedes: the single-window layout in `04-UI-DESIGN-SYSTEM.md` §5 (that doc's
tokens, typography, motion rules, and component specs still apply unless
overridden here).

---

## 0. The core idea

Three layers instead of one always-visible dashboard:

| Layer | When visible | What it is |
|---|---|---|
| **Orb Presence** | ~99% of the time | Small floating orb, always-on-top, transparent window |
| **Command Dashboard** | On demand only | Full overlay: telemetry + live terminal feed + action queue + threads rail |
| **Intercept Gateway** | Interrupt, any time | Approval gate overlay with countdown ring |

Key principle: **the orb is the main character**. Chat threads and telemetry
are supporting features you dip into — never competing for primary real estate.

### Orb lifecycle (resolved)

A permanently large centered orb would block the desktop it's meant to assist.
Resolution — position follows state:

| State | Size / position | Look |
|---|---|---|
| **Idle** | Small, docked **bottom-left**, draggable | Dim (~55% opacity), slow breath pulse |
| **Listening** (wake word or `Ctrl+Shift+J`) | **Large, centered** — full holographic-core moment | 100% opacity, **audio-reactive** |
| **Processing** | Small, bottom-left dock | Full opacity, shimmer sweep |
| **Speaking (TTS)** | Small, bottom-left dock | Full opacity, **animates with the voice** |

Details:

- The expand-to-center triggers on wake word detection or the dashboard hotkey;
  it stays centered **for as long as it's listening**, and returns to the
  bottom-left dock the moment listening ends (processing/speaking happen docked).
- **Audio reactivity is mandatory, not decorative**: a Web Audio
  `AnalyserNode` on the mic stream drives the listening animation (amplitude +
  frequency bands → ring waveforms, core intensity), and the same analyser on
  the TTS output drives the speaking animation. When Jarwizz speaks, the orb
  visibly *is* the voice.
- While idle-docked it dims to ~55% opacity; processing/speaking run at full
  opacity so activity is always noticeable even at small size.
- While idle-docked it must never intercept clicks outside the orb itself.

So you get the "big center" Jarvis presence exactly during every interaction,
and an unobtrusive dim companion the rest of the time.

---

## 1. Window architecture (Electron)

This requires Electron — the current Vite-only frontend can't do transparent,
always-on-top, multi-window shells.

Three BrowserWindows, all loading the same React bundle with different routes:

```
main process (electron/main.js)
├── orbWindow      → frameless, transparent, alwaysOnTop, skipTaskbar,
│                    ~140px, position saved to config, click-through except
│                    on the orb itself (setIgnoreMouseEvents(true, {forward: true}))
├── dashboardWindow→ frameless fullscreen overlay, hidden by default,
│                    show/hide on toggle (double-click orb / voice command /
│                    hotkey e.g. Ctrl+Shift+J)
└── gatewayWindow  → frameless overlay, created hidden at startup, shown ONLY
                     for irreversible-tier approvals (never behind other windows)
```

IPC contracts needed:
- `orb:setState` (idle | listening | processing | awaiting-approval | error)
- `dashboard:toggle`, `dashboard:openThread(id)`
- `gateway:show(payload)`, `gateway:resolve(approved)`
- `threads:list | pin | open`
- `telemetry:sample` (CPU / VRAM / mic level push, throttled to ~1Hz)

Renderer ↔ backend unchanged: same WebSocket event stream from the Express
server (`02-ARCHITECTURE.md`), just fanned out to whichever window is visible.

---

## 2. Design tokens v2 (merged palette)

Keeps the dark base from `04-UI-DESIGN-SYSTEM.md`; upgrades the accents:

```css
:root {
  /* Backgrounds — unchanged */
  --bg-void:         #0a0d0b;
  --bg-panel:        #121710;
  --bg-panel-raised: #171d15;
  --bg-input:        #0f1310;

  /* Accent upgrade: electric "Quantum Green" */
  --green-primary:   #00FF66;  /* was #33FFA4 — punchier AI-core feel */
  --green-dim:       #14B854;
  --green-glow:      rgba(0, 255, 102, 0.30);
  --green-muted:     #12301f;

  /* Approval gate upgrade: fusion orange (replaces amber) */
  --orange-alert:    #FF7A18;
  --orange-glow:     rgba(255, 122, 24, 0.35);

  /* Unchanged status colors */
  --red-error:       #E85B4E;
  --blue-info:       #4EA8DE;

  /* Text / borders — unchanged */
}
```

Note for Tailwind v4: tokens go in CSS via `@theme` (no `tailwind.config.js`).
Both greens rendered side-by-side in the settings panel theme picker during
Phase P2 so the final call (`#00FF66` vs legacy `#33FFA4`) is a one-line flip.

---

## 3. Layer 1 — Orb Presence

### 3a. Visual design (the signature element — must not look simple)

Built as a **layered Canvas/WebGL composition** (one `<canvas>` per window,
`requestAnimationFrame` loop), bottom to top:

```
┌─ L6  state overlays        error flash / approval lock-in
├─ L5  orbiting motes        8–12 tiny particles on elliptical orbits
├─ L4  waveform ring         polar FFT spectrum — reacts to mic/TTS audio
├─ L3  arc rings             2–3 concentric dashed arcs, counter-rotating,
│                            different speeds; tighten when active
├─ L2  inner core            layered gradient sphere, breathing scale,
│                            specular highlight, amplitude-driven intensity
└─ L1  atmosphere            large blurred radial glow in state color
```

- **L4 is the star**: a polar waveform ring fed by the `AnalyserNode`. While
  listening, it ripples with your voice; while Jarwizz speaks, it dances with
  the TTS output. When there's no live audio (processing), fall back to smooth
  procedural noise so it never looks dead.
- Arc rings speed up and pull inward as arousal rises: idle < listening <
  processing < awaiting-approval.
- State color mapping: idle `--green-dim`, listening/processing/speaking
  `--green-primary` + `--green-glow`, approval `--orange-alert`, error
  `--red-error` flash then decay.
- Performance budget: ≤5% CPU at idle dock size. Render the small docked orb
  from the same component at reduced layer detail (skip L5, lower particle/
  sample counts) — one codebase, two fidelity tiers.
- Ship it as an isolated `<OrbCore>` component driven purely by
  `{ state, level, spectrum }` props so it's testable without audio.

### 3b. Interactions

- Single click → summon: expand-to-center + open quick command input.
- Double-click → Command Dashboard.
- Right-click → context menu (pin thread shortcut, settings, quit).
- Drag → reposition from the bottom-left dock, persists across restarts.
- Hotkey (`Ctrl+Shift+J`) → same summon path as wake word.

---

## 4. Layer 2 — Command Dashboard

Fullscreen frameless overlay. Layout:

```
┌─────────────────────────────────────────────────────────────────────┐
│ [Threads Rail]  │  TELEMETRY   │   LIVE TERMINAL FEED   │  QUEUE    │
│                 │              │                        │           │
│ ▸ pinned        │ CPU  ██░ 34% │ > wake word detected   │ ▶ active  │
│   job-hunt      │ VRAM ██░ 61% │ > plan: 4 steps        │ ⏳ pending│
│ ─ ephemeral ─   │ MIC   █░░ 12%│ > step 1/4: open gmail │ ✔ done   │
│   draft-reply ▂ │ LAT  240ms   │ > tier: reversible ✓   │ ✖ failed │
│   summarize ▃▂  │              │ …                      │           │
│  (fading =      │              ├────────────────────────┤           │
│   expiring)     │              │ > type a command…      │           │
└─────────────────────────────────────────────────────────────────────┘
```

- **Telemetry (left)**: visible by default (user choice). CPU, VRAM, mic
  level, model latency. Collapsible to icons if it ever feels noisy.
- **Terminal feed (center)**: monospace, streaming chain-of-thought / step log.
  This is the signature component — timestamped entries, risk-tier colored
  left borders, auto-scroll with pause-on-hover. Reuse Log Viewer styling
  from the design system.
- **Action queue (right)**: existing Task Queue component, restyled.
- **Threads rail (far left, collapsible)**: see §5.
- Clicking a thread swaps the center column feed for that thread's transcript;
  a "← live" chip returns to the real-time feed. Nothing modal.
- Dismiss: Esc, hotkey, or orb double-click → back to orb-only state.

---

## 5. Threads system

Data model (`backend/src/memory/threads.js`, SQLite later, JSONL fine for v1):

```jsonc
{
  "id": "thr_...",
  "title": "auto-generated short label",
  "messages": [{ role, text, ts }],
  "pinned": false,
  "created_at": "...",
  "expires_at": "created_at + 24h"   // null when pinned
}
```

Behavior:
- Every conversation creates an ephemeral thread; auto-expires after 24h.
- Expiring threads fade in opacity as they approach expiry (quiet countdown,
  not a nagging badge).
- Pin before expiry → moves to top of rail, solid styling, never expires.
- Thread transcripts also persist into the action log (safety record stays
  complete even when UI threads expire — `05-SAFETY-AND-GUARDRAILS.md` §3).

---

## 6. Layer 3 — Intercept Gateway

Close to the existing Approval Modal spec, upgraded for urgency:

- Dedicated overlay window (§1) — works whether the dashboard is open or not.
- Full-screen dim + `--orange-alert` border pulse.
- **Countdown ring** around the payload card: 60s default; timeout = reject
  (safe default). Ring turns red in the last 10s.
- Content per existing spec: plain-language description, exact payload,
  screenshot if relevant, Confirm / Reject buttons.
- Voice: "yes"/"confirm"/"no"/"stop" while open triggers the same actions.
- Any state shift cancels cleanly if the task is killed via kill switch.

---

## 7. Cinematic mode (toggleable, Settings)

On by default, single switch to silence everything:

| Effect | In scope |
|---|---|
| Font scramble on boot/text render | yes |
| Audio cues (hum, clicks, approval chime) | yes |
| Expanded summon animation | yes (always available, this only controls flourish) |

Off = instant renders, silent operation, faster perceived performance.

---

## 8. Performance budget (hardware-conscious by design)

Target machine is the existing laptop (RX 5500M-class iGPU/dGPU, no headroom
wasted). The UI must cost almost nothing while idle — the local LLM owns the
GPU and CPU during real work.

Hard budgets:

| Scenario | Budget | How it's met |
|---|---|---|
| Orb idle (docked) | **≤1% CPU**, GPU ~0 | 30fps cap, reduced layer detail (skip motes, low-res glow), `requestAnimationFrame` pauses entirely when occluded/minimized |
| Orb active (listening/processing/speaking) | ≤5% CPU | Single canvas, one RAF loop; spectrum downsampled to ~64 bins before drawing |
| Dashboard closed | Zero cost | Window *hidden* (`win.hide()`) — not rendered at all, not merely transparent |
| Gateway hidden | Zero cost | Created once at startup, hidden until needed |
| Telemetry sampling | ≤1 sample/sec | Throttled in the main process; skipped entirely while dashboard is hidden |
| Memory (all three windows resident) | ≤250MB total | Shared Vite bundle, lazy-load dashboard/gateway routes on first open |

Techniques enforced across all phases:

- One `AnalyserNode`, reused for mic and TTS paths — FFT size 256, not 2048.
- Canvas layers drawn as gradients/cached sprites where possible; no per-frame
  DOM animation, no CSS blur filters animating.
- Electron flags: `backgroundThrottling: true` (default), `--disable-gpu` NOT
  set (canvas compositing stays on GPU), but orb window uses
  `transparent: true` only — no other expensive window features.
- Wake word + VAD stay in the voice-service process (`02-ARCHITECTURE.md`),
  never in a renderer.
- Checkpoint additions: P2 measures idle-orb CPU via Task Manager over 60s;
  P3 measures dashboard-hidden cost = 0. If idle exceeds 1%, reduce fps cap
  to 15 before touching visual quality.

The heavy stuff (LLM inference, vision) already lives in llama.cpp with Vulkan
offload — this UI plan deliberately keeps every renderer cheap so it never
competes with that.

---

## 9. Build phases

Sequenced to slot alongside `07-IMPLEMENTATION-PLAN.md` (its Phase 2+ events
feed these components). Each ends with a checkpoint.

**P1 — Shell migration**
Electron scaffolding around the existing Vite React app; three windows defined;
orb window shows a static placeholder orb, always-on-top + click-through +
drag verified. IPC plumbing skeleton in place.
✓ Orb floats over other apps, survives display sleep, position persists.

**P2 — Orb + tokens**
Full layered `OrbCore` (§3a) with all five states wired to real WebSocket
events; mic/TTS `AnalyserNode` audio reactivity live; token upgrade to v2
palette; theme picker rendering both greens side-by-side; expand-to-center on
wake word / hotkey, shrink-to-bottom-left-dock on completion.
✓ All five orb states reachable end-to-end from the backend event stream;
  orb visibly reacts to voice input and to TTS playback.

**P3 — Dashboard**
DashboardWindow with telemetry panel (live samples), terminal feed (streaming
step logs), action queue. Esc/hotkey dismissal.
✓ Say a dry-run command and watch steps stream through the feed live.

**P4 — Threads**
Thread store + rail; ephemeral expiry with fade; pin/unpin; inline transcript
view swapping the center column.
✓ Two conversations create two fading tabs; pinning one keeps it solid.

**P5 — Gateway**
GatewayWindow + countdown ring + voice confirm/reject wired to the existing
approval flow (`pending_approval` events).
✓ An irreversible-tier simulated step raises the gate even with the dashboard
closed; timeout rejects safely.

**P6 — Cinematic mode + polish**
Scramble/audio effects behind the settings toggle; micro-interaction pass;
settings panel updated (wake word, cinematic, theme, whitelists).
✓ Toggle off → everything instant and silent; on → full experience.

---

## 10. Open decisions (non-blocking)

1. **Final green**: `#00FF66` (default in this plan) vs `#33FFA4` — decide
   visually in P2's side-by-side picker; flipping is one token change.
2. **Hotkey** for dashboard toggle: proposed `Ctrl+Shift+J`, confirm no conflicts.
3. SQLite vs JSONL for threads/logs — defer to whenever `07-IMPLEMENTATION-PLAN.md`
   Phase 5 makes that call; interface identical either way.
