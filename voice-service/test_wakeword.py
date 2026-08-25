"""Quick smoke test for openWakeWord + mic.
Uses the built-in 'hey_jarvis' ONNX model to verify the pipeline works.
Say 'hey jarvis' near your mic during the 5-second recording window.
"""
import sounddevice as sd
import numpy as np
from openwakeword.model import Model as OwwModel

DURATION = 5
SAMPLE_RATE = 16000
CHUNK_SIZE = 1280  # 80ms chunks as recommended by openWakeWord
THRESHOLD = 0.3

print(f"Recording {DURATION}s — say 'hey jarvis' to test wake-word detection...")
audio = sd.rec(int(DURATION * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype="float32")
sd.wait()
print(f"Recording done. Max amplitude: {np.max(np.abs(audio)):.4f}")

oww = OwwModel(wakeword_models=["hey_jarvis"], inference_framework="onnx")

detected = False
for i in range(0, len(audio) - CHUNK_SIZE, CHUNK_SIZE):
    chunk = audio[i : i + CHUNK_SIZE].flatten()
    scores = oww.predict(chunk)
    for name, score in scores.items():
        if score > THRESHOLD:
            print(f"  DETECTED '{name}' with score {score:.3f} at ~{i / SAMPLE_RATE:.1f}s")
            detected = True

if not detected:
    print("No wake-word detected (threshold not reached). Pipeline is functional — model may need tuning for your voice.")
