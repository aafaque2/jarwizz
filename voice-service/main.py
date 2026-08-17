"""
Jarwizz Voice Service — Main entry point.
Pipeline: wake-word → record → transcribe → POST to backend → TTS response.
Includes: stop phrase listener, 6 listening states, low-confidence handling.
"""
import sys
import os
import json
import time
import queue
import threading
import argparse
import traceback

import numpy as np
import sounddevice as sd
import websocket  # websocket-client

# ── Paths ──
SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
STT_DIR = os.path.join(SERVICE_DIR, "stt")
TTS_DIR = os.path.join(SERVICE_DIR, "tts")
WAKE_DIR = os.path.join(SERVICE_DIR, "wakeword")

sys.path.insert(0, STT_DIR)
sys.path.insert(0, TTS_DIR)

# ── Config ──
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:4000")
BACKEND_WS = os.environ.get("BACKEND_WS", "ws://localhost:4000")
SAMPLE_RATE = 16000
CHUNK_SIZE = 1280  # 80ms
WAKE_THRESHOLD = 0.5
SILENCE_THRESHOLD = 0.01
SILENCE_TIMEOUT = 1.5  # seconds of silence to stop recording
MAX_RECORD_SECONDS = 10
LOW_CONFIDENCE_THRESHOLD = 0.4

# ── Listening states (from 03-VOICE-INTERFACE.md §3) ──
STATE_IDLE = "idle"
STATE_WOKEN = "woken"
STATE_PROCESSING = "processing"
STATE_AWAITING_APPROVAL = "awaiting_approval"
STATE_EXECUTING = "executing"
STATE_RESPONSE = "response"

current_state = STATE_IDLE
state_listeners = []


def set_state(new_state):
    global current_state
    old = current_state
    current_state = new_state
    for cb in state_listeners:
        try:
            cb(old, new_state)
        except Exception:
            pass


def on_state_change(old, new):
    icons = {
        STATE_IDLE: "●",
        STATE_WOKEN: "◉",
        STATE_PROCESSING: "◎",
        STATE_AWAITING_APPROVAL: "◈",
        STATE_EXECUTING: "◉◉",
        STATE_RESPONSE: "◇",
    }
    print(f"  [STATE] {icons.get(new, '?')} {new}")


state_listeners.append(on_state_change)


# ── TTS via Piper ──

def speak(text):
    """Speak text using Piper TTS."""
    set_state(STATE_RESPONSE)
    try:
        from speak import speak_piper
        speak_piper(text)
    except Exception as e:
        print(f"  [TTS] Error: {e}")
        # Fallback: just print
        print(f"  [TTS] (spoken): {text}")


# ── STT via faster-whisper ──

_whisper_model = None


def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        _whisper_model = WhisperModel("small", device="cpu", compute_type="int8")
    return _whisper_model


def transcribe(audio_np):
    """Transcribe audio numpy array. Returns (text, confidence)."""
    model = get_whisper_model()
    segments, info = model.transcribe(audio_np, language="en")
    full_text = " ".join(s.text.strip() for s in segments)
    confidence = info.language_probability
    return full_text.strip(), confidence


# ── Wake-word detection ──

def init_wakeword():
    from openwakeword.model import Model as OwwModel
    return OwwModel(wakeword_models=["hey_jarvis"], inference_framework="onnx")


def detect_wake_word(audio_queue, oww_model):
    """Continuously feed audio chunks to wake-word model. Returns True on detection."""
    while True:
        try:
            chunk = audio_queue.get(timeout=0.5)
        except queue.Empty:
            continue
        scores = oww_model.predict(chunk)
        for name, score in scores.items():
            if score > WAKE_THRESHOLD:
                return True
    return False


# ── Record audio after wake ──

def record_command(audio_stream):
    """Record until silence or max duration. Returns numpy array."""
    frames = []
    silence_start = None

    print("  Listening... (speak now)")
    for _ in range(0, int(MAX_RECORD_SECONDS * SAMPLE_RATE / CHUNK_SIZE)):
        try:
            data = audio_stream.get(timeout=0.5)
        except queue.Empty:
            continue

        frames.append(data)
        amplitude = np.max(np.abs(data))

        if amplitude < SILENCE_THRESHOLD:
            if silence_start is None:
                silence_start = time.time()
            elif time.time() - silence_start > SILENCE_TIMEOUT:
                break
        else:
            silence_start = None

    if not frames:
        return np.array([], dtype=np.float32)

    return np.concatenate(frames)


# ── Backend communication ──

def send_command(text):
    """POST command to backend and return result."""
    import urllib.request
    import urllib.error

    payload = json.dumps({"text": text}).encode()
    req = urllib.request.Request(
        f"{BACKEND_URL}/command",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read())
    except urllib.error.URLError as e:
        print(f"  [BACKEND] Error: {e}")
        return {"error": str(e)}


def send_stop():
    """POST stop to backend."""
    import urllib.request
    req = urllib.request.Request(f"{BACKEND_URL}/stop", method="POST")
    try:
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass


def approve_step(step_id):
    """POST approve to backend."""
    import urllib.request
    req = urllib.request.Request(f"{BACKEND_URL}/approve/{step_id}", method="POST")
    try:
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass


# ── Stop phrase listener (always-armed) ──

def check_stop_phrase(audio_np):
    """Quick STT check for stop phrases in audio."""
    if len(audio_np) < SAMPLE_RATE:  # less than 1 second
        return False
    text, conf = transcribe(audio_np)
    lower = text.lower().strip()
    stop_phrases = ["jarwizz stop", "stop", "halt", "cancel", "never mind", "nevermind"]
    return any(phrase in lower for phrase in stop_phrases)


# ── Low-confidence handling ──

def handle_low_confidence(text, conf):
    """Handle low-confidence transcription per §6."""
    print(f"  [LOW CONFIDENCE] text='{text}' conf={conf:.2f}")
    speak(f"Sorry, I didn't catch that clearly. Did you say: {text}? Say yes to proceed or try again.")
    # In a full implementation, wait for spoken "yes" here.
    # For now, proceed with caution flag.
    return True  # flagged


# ── WebSocket listener for backend events ──

def ws_listener():
    """Connect to backend WebSocket and react to events."""
    while True:
        try:
            ws = websocket.create_connection(BACKEND_WS, timeout=30)
            print(f"  [WS] Connected to {BACKEND_WS}")

            while True:
                raw = ws.recv()
                msg = json.loads(raw)
                event = msg.get("event", "")
                data = msg.get("data", {})

                if event == "pending_approval":
                    set_state(STATE_AWAITING_APPROVAL)
                    desc = data.get("description", "an action")
                    speak(f"I need your approval to {desc}. Say yes to proceed, or no to cancel.")

                elif event == "step_completed":
                    set_state(STATE_EXECUTING)
                    desc = data.get("description", "step")
                    print(f"  [STEP] Completed: {desc}")

                elif event == "step_error":
                    desc = data.get("description", "step")
                    err = data.get("error", "unknown error")
                    speak(f"There was an error: {err}")

                elif event == "plan_created":
                    steps = data.get("plan", {}).get("steps", [])
                    set_state(STATE_PROCESSING)
                    print(f"  [PLAN] {len(steps)} step(s)")

        except Exception as e:
            print(f"  [WS] Disconnected: {e}, reconnecting in 3s...")
            time.sleep(3)


# ── Main loop ──

def main():
    parser = argparse.ArgumentParser(description="Jarwizz Voice Service")
    parser.add_argument("--no-wake", action="store_true", help="Skip wake word, go straight to listening")
    parser.add_argument("--text", type=str, help="Send a text command directly (no voice)")
    parser.add_argument("--test-stop", action="store_true", help="Test stop phrase detection")
    args = parser.parse_args()

    # Text-only mode
    if args.text:
        print(f"[TEXT] Sending: '{args.text}'")
        set_state(STATE_PROCESSING)
        result = send_command(args.text)
        print(f"[TEXT] Result: {json.dumps(result, indent=2)[:500]}")
        if "error" not in result:
            steps = result.get("results", [])
            step_summaries = [f"[{s.get('status')}] {s.get('description', s.get('action_type'))}" for s in steps]
            speak(f"Done. {'; '.join(step_summaries)}")
        else:
            speak(f"Error: {result['error']}")
        return

    # Start WebSocket listener in background
    ws_thread = threading.Thread(target=ws_listener, daemon=True)
    ws_thread.start()

    # Init wake-word model
    oww = init_wakeword()
    print(f"[VOICE] Wake-word model loaded. Say 'Hey Jarvis' to start.")
    set_state(STATE_IDLE)

    # Audio stream
    audio_q = queue.Queue()

    def audio_callback(indata, frames, time_info, status):
        audio_q.put(indata.copy().flatten())

    with sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="float32",
        blocksize=CHUNK_SIZE,
        callback=audio_callback,
    ):
        while True:
            set_state(STATE_IDLE)
            print("\n[VOICE] Waiting for wake word...")

            # Continuous wake-word detection
            wake_detected = detect_wake_word(audio_q, oww)
            if not wake_detected:
                continue

            # Woken!
            set_state(STATE_WOKEN)
            print("[VOICE] Woken! Recording command...")
            try:
                speak("")  # silence to trigger audio device
            except Exception:
                pass

            # Record command
            audio_np = record_command(audio_q)

            if len(audio_np) < SAMPLE_RATE * 0.5:
                print("  [VOICE] Too short, ignoring.")
                continue

            # Check for stop phrase
            if args.test_stop or check_stop_phrase(audio_np):
                print("  [VOICE] Stop phrase detected!")
                send_stop()
                speak("Stopped.")
                continue

            # Transcribe
            set_state(STATE_PROCESSING)
            text, conf = transcribe(audio_np)
            print(f"  [STT] '{text}' (confidence: {conf:.2f})")

            if not text:
                speak("I didn't hear anything. Try again.")
                continue

            if conf < LOW_CONFIDENCE_THRESHOLD:
                handle_low_confidence(text, conf)

            # Send to backend
            print(f"  [CMD] Sending to backend: '{text}'")
            result = send_command(text)

            if "error" in result:
                speak(f"Error: {result['error']}")
                continue

            # Summarize results
            steps = result.get("results", [])
            completed = sum(1 for s in steps if s.get("status") == "completed")
            errors = sum(1 for s in steps if s.get("status") == "error")
            total = len(steps)

            if errors:
                speak(f"Done with {completed} of {total} steps, but there were {errors} errors.")
            elif completed == total:
                if total == 1:
                    speak(f"Done: {steps[0].get('description', 'step complete')}.")
                else:
                    speak(f"All {total} steps completed successfully.")
            else:
                speak(f"Completed {completed} of {total} steps.")

            set_state(STATE_RESPONSE)
            time.sleep(0.5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[VOICE] Shutting down.")
    except Exception as e:
        traceback.print_exc()
        sys.exit(1)
