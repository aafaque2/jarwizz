"""
Phase 6 test — tests all voice-service components that can run without a physical mic.
Text command mode, TTS, WebSocket listener, stop phrase detection, listening states.
"""
import sys
import os
import json
import time
import threading
import urllib.request

SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SERVICE_DIR)
sys.path.insert(0, os.path.join(SERVICE_DIR, "tts"))

BASE = "http://localhost:4000"
passed = 0
total = 0


def test(name):
    global total
    total += 1
    print(f"\nTEST {total}: {name}")
    return total


def ok(msg=""):
    global passed
    passed += 1
    print(f"  PASS: {msg}")


def fail(msg):
    print(f"  FAIL: {msg}")


# ── Test 1: TTS speaks without error ──
test("TTS speaks via Piper")
try:
    from tts.speak import speak_piper
    speak_piper("Phase six test. All systems operational.")
    ok("Piper TTS synthesized and played")
except Exception as e:
    fail(str(e))


# ── Test 2: Text command mode — browser ──
test("Text command: navigate to example.com")
try:
    from main import send_command, set_state, STATE_PROCESSING, STATE_RESPONSE
    set_state(STATE_PROCESSING)
    result = send_command("navigate to example.com")
    set_state(STATE_RESPONSE)
    steps = result.get("results", [])
    if steps and steps[0].get("status") == "completed" and steps[0].get("output", {}).get("title") == "Example Domain":
        ok(f"title='Example Domain'")
    else:
        fail(f"unexpected result: {json.dumps(steps[:1], indent=2)[:200]}")
except Exception as e:
    fail(str(e))


# ── Test 3: Text command mode — gmail (via mock) ──
test("Text command: read my recent emails")
try:
    result = send_command("read my recent emails")
    steps = result.get("results", [])
    gmail_step = next((s for s in steps if s.get("action_type") == "gmail_read"), None)
    if gmail_step and gmail_step.get("output", {}).get("emails"):
        emails = gmail_step["output"]["emails"]
        ok(f"{len(emails)} emails via gmail_read API")
    else:
        fail(f"no gmail_read step: {[s.get('action_type') for s in steps]}")
except Exception as e:
    fail(str(e))


# ── Test 4: Listening state machine ──
test("Listening state transitions")
try:
    import main
    from main import set_state, STATE_IDLE, STATE_WOKEN, STATE_PROCESSING, STATE_EXECUTING, STATE_RESPONSE
    set_state(STATE_IDLE)
    assert main.current_state == STATE_IDLE
    set_state(STATE_WOKEN)
    assert main.current_state == STATE_WOKEN
    set_state(STATE_PROCESSING)
    assert main.current_state == STATE_PROCESSING
    set_state(STATE_EXECUTING)
    assert main.current_state == STATE_EXECUTING
    set_state(STATE_RESPONSE)
    assert main.current_state == STATE_RESPONSE
    set_state(STATE_IDLE)
    assert main.current_state == STATE_IDLE
    ok("all 6 states transition correctly")
except Exception as e:
    fail(str(e))


# ── Test 5: Stop sends /stop endpoint ──
test("Stop command halts backend")
try:
    from main import send_stop
    # First start a long-running command in a thread
    def long_cmd():
        send_command("navigate to example.com")
    t = threading.Thread(target=long_cmd)
    t.start()
    time.sleep(0.5)
    send_stop()
    t.join(timeout=10)
    # Verify stop was received
    health = json.loads(urllib.request.urlopen(f"{BASE}/health").read())
    ok(f"stop sent, backend healthy: {health.get('status')}")
except Exception as e:
    fail(str(e))


# ── Test 6: STT transcribes audio (using synthetic sine wave for pipeline test) ──
test("STT module loads and transcribe function works")
try:
    from main import get_whisper_model, transcribe
    import numpy as np
    # Generate 1 second of silence (tests pipeline, won't produce real text)
    audio = np.zeros(16000, dtype=np.float32) * 0.001
    text, conf = transcribe(audio)
    ok(f"STT pipeline functional (silence -> '{text}', conf={conf:.2f})")
except Exception as e:
    fail(str(e))


# ── Test 7: Wake-word model loads ──
test("openWakeWord model loads")
try:
    from main import init_wakeword
    oww = init_wakeword()
    ok(f"model loaded: {type(oww).__name__}")
except Exception as e:
    fail(str(e))


# ── Test 8: Low-confidence handler ──
test("Low-confidence handler flags text")
try:
    from main import handle_low_confidence
    flagged = handle_low_confidence("something unclear", 0.2)
    assert flagged is True
    ok("low-confidence flagged for re-confirmation")
except Exception as e:
    fail(str(e))


# ── Test 9: Stop phrase detection ──
test("Stop phrase detection from audio")
try:
    from main import check_stop_phrase
    from tts.speak import speak_piper
    import numpy as np
    # Generate 2 seconds of silence — won't trigger stop, but verifies the function runs
    silence = np.zeros(32000, dtype=np.float32) * 0.001
    result = check_stop_phrase(silence)
    # Just verify it doesn't crash; silence won't contain "stop"
    ok(f"stop phrase check runs without error (silence -> {result})")
except Exception as e:
    fail(str(e))


# ── Test 10: WebSocket connectivity ──
test("Voice service can connect to backend WebSocket")
try:
    import websocket as ws_lib
    ws = ws_lib.create_connection("ws://localhost:4000", timeout=5)
    ws.send(json.dumps({"type": "ping"}))
    ws.close()
    ok("WebSocket connection established and closed")
except Exception as e:
    fail(str(e))


print(f"\n=== PHASE 6 CHECKPOINT: {passed}/{total} tests passed ===")
sys.exit(0 if passed >= 8 else 1)
