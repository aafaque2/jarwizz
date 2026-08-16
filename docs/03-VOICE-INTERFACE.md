# Voice Interface Spec

## 1. Goals

- Zero-cost, fully local voice pipeline.
- Low false-trigger rate on the wake word.
- Fast enough round-trip (wake → transcribed command) to feel responsive, not laggy.
- Clear audible + visual feedback at every stage so the user always knows Jarwizz's listening state.

## 2. Components

| Stage | Tool (free/local) | Notes |
|---|---|---|
| Wake-word detection | openWakeWord (fully open-source) or Porcupine (free tier, easier setup, custom wake words) | Runs continuously in background, very low CPU footprint. Porcupine's free tier supports a custom wake word like "Jarwizz" — worth using early for reliability, switch to openWakeWord later if you want zero vendor dependency. |
| Speech-to-text | faster-whisper (local, quantized Whisper) | Only runs after wake word triggers — not continuously, to save CPU/GPU. |
| Text-to-speech | Piper (local, fast, good quality for a local model) | Used for spoken confirmations/responses. |
| Audio I/O | sounddevice or PyAudio (Python) | Handles mic capture and speaker output. |

## 3. Listening states (drive both audio cues and the UI orb)

1. **Idle / passive listening** — wake-word model running, orb is a dim/steady green, no mic recording of full audio.
2. **Woken / actively listening** — after wake word detected: soft confirm tone plays, orb brightens and pulses, short recording window opens (e.g. 5–8 seconds, or until silence detected).
3. **Processing** — orb shows a "thinking" animation (subtle rotation/shimmer) while STT transcribes and the orchestrator plans.
4. **Awaiting approval** — orb turns amber/gold (breaks from the green theme intentionally, as a clear "needs you" signal) if the planned action is irreversible tier.
5. **Executing** — orb shows active pulsing green while a step runs.
6. **Response** — TTS speaks the result; orb returns to idle.

## 4. Wake-word setup steps

1. Pick the phrase: "Jarwizz, wake up" (or shorter "Hey Jarwizz" if the full phrase proves less reliable — test both).
2. If using Porcupine: use their free console to train a custom wake-word model file for your chosen phrase, download the `.ppn` file.
3. If using openWakeWord: use their provided training notebook/scripts to generate a custom model, or start with a close built-in phrase while testing the pipeline, then swap in the custom one.
4. Load the model in `voice-service/wakeword/listener.py`, running a continuous loop against the live mic stream.
5. On detection, emit an event that the main voice-service loop picks up to start the recording window.

## 5. Command capture window

- Start recording immediately after wake-word detection.
- End recording on: silence detected for ~1.5s, OR a hard max of ~10s, whichever comes first.
- Feed the captured audio to faster-whisper for transcription.
- Send the resulting text to the backend orchestrator exactly as if typed into the dashboard's command box — this keeps voice and text input using the exact same downstream pipeline, so nothing needs to be built twice.

## 6. Handling misheard commands

- If STT confidence is low or the transcribed text is nonsensical, Jarwizz should ask for clarification via TTS ("Sorry, I didn't catch that — can you repeat?") rather than guessing and acting.
- Never auto-execute an irreversible-tier action based on a low-confidence transcription, even with approval-gate logic layered on top — flag it for extra-clear confirmation ("Just to confirm, you want me to delete the file named [X]?").

## 7. Stop command

- "Jarwizz, stop" (or similar) should be recognized as a priority phrase that immediately halts any in-progress task, independent of the normal wake-word → command flow. Treat it almost like a second, always-armed wake word tied directly to the kill switch in `05-SAFETY-AND-GUARDRAILS.md`.

## 8. Performance notes

- Keep the wake-word model resident and lightweight — this is what runs 24/7, so it must not meaningfully load your CPU/GPU at idle.
- Only load/run the (heavier) STT model on-demand after a wake event, and consider unloading it after a period of inactivity if memory is tight.
- Piper TTS is fast enough to feel conversational on most modern hardware without a GPU.

## 9. Later upgrade path (funded)

- Swap faster-whisper for a cloud STT API if local accuracy proves insufficient for your accent/environment — this is a drop-in replacement behind the same interface, same pattern as the model-runtime swap described in `02-ARCHITECTURE.md`.
- Cloud TTS (more natural voices) is a nice-to-have, not a priority — Piper is genuinely good enough for v1.
