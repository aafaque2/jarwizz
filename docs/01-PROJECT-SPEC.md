# Jarwizz — Project Spec

Status: Draft v2 (voice + UI incorporated)
Budget mode: $0 now, cloud APIs added later when funded

---

## 1. What Jarwizz is, in plain language

Jarwizz is a personal AI assistant that runs on your own computer, listens
for its wake phrase ("Jarwizz, wake up"), and then does things for you —
not just answers questions. You talk to it like a person; it either acts
immediately (safe stuff) or reads the action back to you and waits for a
"yes" (anything that can't be undone).

It runs entirely free using local AI models and open-source tools. When you
add a paid cloud API key later, it automatically gets better at the hard
stuff (understanding messy screens, complex reasoning) — everything else
keeps running free and local, forever.

## 2. The full feature list (layman terms)

### Always-on listening
- Runs quietly in the background, mic on, doing nothing until it hears
  "Jarwizz, wake up" (or your chosen phrase).
- Gives an audible/visual cue (a soft tone + the UI orb lighting up green)
  to confirm it heard you and is listening for the actual command.

### Talk to it like a person
- "Open Chrome." "Play the 3rd video." "Summarize this page." "What's on
  my screen right now?" — it interprets natural language, not fixed
  commands.

### Desktop control
- Open and close apps.
- Create, rename, move, or delete files and folders.
- Click, type, scroll, switch windows/tabs — on your behalf.

### Web / browser control
- Open websites, navigate, click things, fill in forms.
- Read and summarize pages.
- Search the web when it needs current information.

### Email & accounts
- Read, draft, and send emails (via Gmail's official API — not by
  clicking around Gmail's UI, which is slower and more fragile).
- Same API-first approach for Calendar and similar connected services.

### Job application assist
- Finds/opens listings, fills your saved profile into forms, attaches
  resume/cover letter.
- Never submits without you saying "yes, submit" first.

### Memory
- Remembers your preferences, past tasks, and reusable info (like your
  resume details) so you don't repeat yourself every session.

### Safety, always on
- Anything reversible (opening an app, drafting an email) — it just does it.
- Anything irreversible (sending the email, deleting a file, submitting a
  form, any payment) — it tells you exactly what it's about to do and
  waits for your confirmation, spoken or typed.
- Full activity log of everything it did, with screenshots, that you can
  scroll back through.
- One command or button always stops it instantly: "Jarwizz, stop."

### The look and feel
- Dark theme, rich green accents — a control-room, "AI core" aesthetic.
  Full design spec in `04-UI-DESIGN-SYSTEM.md`.
- A live dashboard showing: what it's currently doing, a queue of
  pending/past tasks, and a pulsing listening indicator.

## 3. Goals

- Voice-activated, hands-free operation for everyday tasks.
- Runs 100% free and local by default.
- Clean architecture so a paid cloud model can be added later purely by
  config, with zero rewrite.
- Trustworthy: you can leave it running and know it won't do anything
  destructive without asking first.
- Extensible: today it's a personal assistant, later it can grow into a
  broader automation platform.

## 4. Non-goals (v1)

- No fully autonomous job-application spam — submission is always
  confirmed.
- No CAPTCHA/OTP bypass — always pauses and hands control to you.
- No payments or financial actions of any kind.
- No multi-user / role-based permissions — single user only.
- No mobile app in v1 — desktop only.
- No promise of perfect voice recognition on day one — expect tuning.

## 5. Feature tiers at a glance

| Tier | Includes | Timing |
|---|---|---|
| **MVP (v1)** | Wake word, voice commands, browser automation, Gmail API, approval gate, action log, dashboard UI, local memory | Build first, fully free |
| **v2** | Desktop (non-browser) app control, job-application assist, full "observe→decide→act" screen loop | After MVP is stable, still free |
| **v2.5 (funded)** | Optional cloud model fallback for hard reasoning / messy screen understanding | Whenever you add a card, config-only change |
| **v3+ (future scope)** | See `08-FUTURE-SCOPE.md` — plugin system, scheduling, multi-device, etc. | Research later, not committed |

## 6. Success criteria for v1

You should be able to say "Jarwizz, wake up," then "open Gmail and draft a
reply to the last email from [X] saying [Y]," and watch it: wake, open the
browser, navigate to Gmail, find the email, draft the reply, read it back
to you, and send only after you say "yes." End to end, no manual clicking
required except the one confirmation.
