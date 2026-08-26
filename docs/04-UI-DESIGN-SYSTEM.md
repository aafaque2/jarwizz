# Jarwizz — UI Design System

Aesthetic direction: dark "AI core" / control-room feel, rich green as the
signature accent — a calm, high-tech instrument panel. Confident and quiet.

> **Scope note:** the color tokens, typography, motion rules, and component
> specs in this document remain authoritative. The single-window layout in §5
> is superseded by `11-PRO-UI-PLAN.md`, which defines the current three-layer
> architecture (orb presence / command dashboard / intercept gateway) and an
> updated token set (§2 there).

## 1. Color tokens

```css
:root {
  /* Backgrounds */
  --bg-void:        #0a0d0b;   /* app background, near-black with a green tint */
  --bg-panel:       #121710;   /* cards, panels */
  --bg-panel-raised:#171d15;   /* hover/raised elements */
  --bg-input:       #0f1310;   /* command box, inputs */

  /* Green accent family */
  --green-primary:  #33FFA4;   /* signature bright green — orb, active states, primary actions */
  --green-dim:      #1f9e68;   /* secondary green — icons, borders, idle orb */
  --green-glow:      rgba(51, 255, 164, 0.25); /* used for box-shadow glow effects */
  --green-muted:     #26382e;   /* subtle backgrounds, dividers */

  /* Status colors (intentionally break from green for clarity) */
  --amber-approval:  #E8B339;   /* awaiting-approval state, irreversible-tier flags */
  --red-error:       #E85B4E;   /* errors, failed actions */
  --blue-info:       #4EA8DE;   /* informational, read-only tier badges */

  /* Text */
  --text-primary:    #E8F5EE;   /* main text, near-white with green tint */
  --text-secondary:  #8FA89B;   /* secondary/meta text */
  --text-disabled:   #4C5D54;

  /* Borders */
  --border-subtle:   #223026;
  --border-glow:     var(--green-primary);
}
```

## 2. Typography

- **UI font**: a clean geometric sans — Inter or Space Grotesk. Used for all standard UI text.
- **Monospace accent font**: JetBrains Mono or IBM Plex Mono — used for the command box, log entries, and any "system output" text, to reinforce the terminal/AI feel.
- Sizes: keep a simple scale — 12 / 14 / 16 / 20 / 28px. Avoid more than 3 weights (Regular, Medium, Semibold).

## 3. Core components

### Listening Orb
The signature visual element — a circular indicator, always visible, showing Jarwizz's current state:
- **Idle**: dim green (`--green-dim`), slow steady pulse (~4s cycle), low opacity glow.
- **Awake/listening**: bright green (`--green-primary`), faster pulse, stronger glow (`box-shadow` using `--green-glow`).
- **Processing**: subtle rotating shimmer/gradient sweep across the orb.
- **Awaiting approval**: shifts to `--amber-approval`, stops pulsing, becomes a steady "waiting" glow — visually distinct on purpose.
- **Error**: brief flash of `--red-error`, returns to idle.

### Command Box
- Monospace font, dark input background (`--bg-input`), thin green border that brightens on focus.
- Placeholder text: `Say "Jarwizz, wake up" or type a command…`
- Doubles as text-input fallback for when voice isn't practical.

### Task Queue (sidebar or panel)
- List of tasks: pending, in-progress, completed, rejected.
- Each item: short description, status badge (color per risk tier — blue for read-only, green for reversible/in-progress, amber for awaiting approval, red for failed).
- In-progress task shows a subtle animated progress indicator, not a fixed percentage (most steps aren't measurable that way).

### Approval Modal
- Deliberately the most visually distinct screen in the app — amber accent border, slightly elevated/darkened backdrop behind it.
- Shows: plain-language description, exact payload (email body, form fields, file path being deleted, etc.), a screenshot if relevant.
- Two clear buttons: **Confirm** (`--green-primary` filled) and **Reject** (outlined, `--red-error` border).
- Voice equivalent: saying "yes"/"confirm" or "no"/"cancel" while this modal is open should trigger the same action as clicking.

### Log Viewer
- Chronological, monospace, each entry timestamped.
- Color-coded left border per risk tier (matches task queue badges).
- Expandable rows to see full payload/screenshots per step (ties to the action log schema in `05-SAFETY-AND-GUARDRAILS.md`).
- Filterable by task, date, or status.

### Settings Panel
- Toggle wake word on/off, choose local vs cloud model (once cloud key is added), manage domain/app whitelists, view/edit saved profile info (for job applications).

## 4. Motion principles

- Motion should feel calm and intentional — slow pulses, gentle transitions (200–350ms ease), never abrupt or flashy.
- The orb is the one place personality lives; everything else (panels, text, logs) should stay static and legible.
- Avoid gradients/animations on text — reserve glow/gradient effects for the orb and status indicators only.

## 5. Layout

```
┌────────────────────────────────────────────────────┐
│  [Orb]   Jarwizz                          [Settings] │  ← top bar
├───────────────────────┬──────────────────────────────┤
│                        │                              │
│   Task Queue           │   Log Viewer                 │
│   (pending/active/     │   (chronological, filterable)│
│    completed)          │                              │
│                        │                              │
├───────────────────────┴──────────────────────────────┤
│  > Say "Jarwizz, wake up" or type a command…           │  ← command box, always docked at bottom
└────────────────────────────────────────────────────┘
```

Approval Modal overlays this layout centered, dimming the background, whenever an irreversible-tier action needs confirmation.

## 6. Implementation notes for opencode

- Use Tailwind CSS with the above tokens mapped into `tailwind.config.js` under `theme.extend.colors`.
- Build `ListeningOrb.jsx` as an isolated, reusable component driven purely by a `state` prop (`idle | listening | processing | awaiting-approval | error`) — makes it trivial to test in isolation and reuse.
- Keep all color values as CSS variables (not hardcoded hex in components) so the theme can be tweaked centrally later.
