# Jarwizz v1 — User Guide

How to run and actually use Jarwizz. Setup/install lives in `docs/06-SETUP-GUIDE.md`; this is the
day-to-day usage guide.

## 1. Start Jarwizz

**Windows** (PowerShell, from the repo root):

```powershell
.\scripts\start-jarwizz.ps1            # model runtime + backend
.\scripts\start-jarwizz.ps1 -Voice     # also opens the voice service window
```

`start-jarwizz.ps1` starts llama.cpp on port 8080 and the backend on 4000,
and waits for both to be healthy. Stop with `.\scripts\stop-jarwizz.ps1`.

**Linux:**

```bash
./scripts/start-jarwizz.sh              # model runtime + backend
./scripts/start-jarwizz.sh --voice --ui # + voice service and dashboard
./scripts/stop-jarwizz.sh
```

Services run detached with logs in `.run/`; the launcher opens a tmux window
with one live pane per service (see `docs/06-SETUP-GUIDE.md` §9g).

The model served depends on your hardware — the launchers read `backend/.env`.
See `docs/06-SETUP-GUIDE.md` §1b for recommendations.

The dashboard (chat UI) is the Vite dev server in `frontend/` — run it separately if you want the
visual interface.

## 2. Talking to Jarwizz (voice)

v1 uses **push-to-talk**, not always-listening:

1. **Hold Ctrl+Shift**.
2. Speak your command.
3. **Release** — it transcribes and acts.

This avoids the mic always being on and stops the assistant from cutting you off mid-sentence
(it records only while you hold the keys).

What you'll hear/see:
- `[STT]` — the transcribed command (printed in the voice terminal).
- `[PLAN]` — how many steps it planned.
- `[STEP] Completed` — each action as it runs.
- Spoken reply — greetings, answers, and confirmations are spoken aloud.

### Example commands

- "what is my name" → answers from memory.
- "open notepad" → launches Notepad.
- "search for AI news" → opens Google and searches.
- "type hello world into the focused window" → types via desktop automation.
- "send an email to bob@example.com saying meeting at 3" → **pauses for approval**, then you say
  **"yes"** (or "no") to send.
- "jarwizz stop" → halts the current task.

## 3. Approval gate (important)

Any **irreversible** action — sending email, deleting a file, submitting a job application — pauses
and asks for your approval. The voice assistant speaks the request and listens for **"yes"** / **"no"**.
In the dashboard, an approval modal shows every field that will be changed. Nothing irreversible
happens without your explicit go-ahead.

Unknown / non-whitelisted websites are automatically forced to **irreversible** so you approve before
the assistant touches them.

## 4. Memory & preferences

Tell Jarwizz facts and it remembers them for the session:

- "remember my name is Aafaque" → stored as a preference.
- "what is my name" → "Aafaque".

For job applications, set your **job-seeker profile** once (API or just ask):

```
POST /job/profile  {"key":"resume_summary","value":"Full-stack engineer, 4 yrs Node.js/React"}
POST /job/profile  {"key":"skills","value":"JavaScript, Node.js, React, Python"}
```

View: `GET /job/profile`. View tracked applications: `GET /job/applications`.

## 5. Job application assist

1. Save your profile (above).
2. Say or type: *"parse this job posting <url> and draft an application then submit it"*.
3. Jarwizz parses the posting (title, company, skills), drafts a tailored cover letter from your
   profile, then **pauses for approval** showing the company, role, and the full cover letter.
4. Approve → it records the application (saved to `Desktop/jarwizz-applications/` and the tracker).

In v1, submission is recorded locally (mock) unless real Gmail is connected (see §6). Parsing works
on any posted URL.

## 6. Connect real Gmail (optional)

By default Gmail is **mock**. To send real email:

1. Google Cloud Console → enable **Gmail API** → create an **OAuth Desktop client** → download
   `credentials.json` into `backend/secrets/` (already git-ignored).
2. Start the backend. Get the consent URL: `curl http://localhost:4000/gmail/auth-url`.
3. Open it, sign in, copy the code, then:
   ```bash
   curl -X POST http://localhost:4000/gmail/callback -H "Content-Type: application/json" \
        -d "{\"code\":\"PASTE_CODE_HERE\"}"
   ```
4. `GET /health` now reports `"gmail":"connected"`. Sending still requires your approval each time.

## 7. Troubleshooting

- **Model won't start / CPU-only:** confirm llama.cpp was built with GPU support
  (`-DGGML_VULKAN=1`, or ROCm/HIP where available) and the server log shows your
  GPU. Choose the highest `--gpu-layers` value that does not run out of memory
  (see `docs/06-SETUP-GUIDE.md` §1c and §9g).
- **Voice not hearing you:** run `python test_mic.py` in `voice-service/` — if amplitude is ~0, select
  the right mic in your system's sound settings.
- **"fetch failed" from voice:** the model runtime died — restart with the launcher script.
- **Gmail still mock:** you skipped §6, or `token.json` isn't in `backend/secrets/`.
- **Push-to-talk not firing (Linux/Wayland):** pynput cannot see keys on Wayland;
  the evdev backend needs your user in the `input` group
  (`sudo usermod -aG input "$USER"`, then log out and back in). Verify with
  `voice-service/venv/bin/python voice-service/hotkey.py`.
- **Wake word not triggering:** v1 defaults to push-to-talk (Ctrl+Shift). Wake-word training is a
  post-v1 item; run `python main.py --wake` only after training a custom model.
