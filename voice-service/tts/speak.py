"""
Piper TTS wrapper for Jarwizz voice service.
Speaks text through the default audio output device.
"""
import os
import numpy as np
import sounddevice as sd

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
DEFAULT_MODEL = "en_US-lessac-medium.onnx"
_model = None


def _get_model():
    global _model
    if _model is None:
        from piper import PiperVoice
        model_path = os.path.join(MODEL_DIR, DEFAULT_MODEL)
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Piper model not found at {model_path}. "
                f"Download from: https://huggingface.co/rhasspy/piper-voices"
            )
        _model = PiperVoice.load(model_path)
    return _model


def speak_piper(text, speed=1.0):
    """Synthesize text with Piper and play through speakers."""
    if not text or not text.strip():
        return

    voice = _get_model()

    # Synthesize via AudioChunk iterator
    chunks = []
    sample_rate = voice.config.sample_rate
    for chunk in voice.synthesize(text):
        chunks.append(chunk.audio_int16_bytes)

    if not chunks:
        return

    # Concatenate and convert to float32
    raw = b"".join(chunks)
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

    sd.play(audio, samplerate=sample_rate)
    sd.wait()


if __name__ == "__main__":
    import sys
    text = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "Hello, I am Jarwizz."
    print(f"Speaking: '{text}'")
    speak_piper(text)
    print("Done.")
