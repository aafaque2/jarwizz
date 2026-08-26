"""
Piper TTS wrapper for Jarwizz voice service.
Speaks text through the default audio output device.

Voice selection and speed are env-configurable:
  JARWIZZ_VOICE  model file name in tts/models/   (default: en_US-bryce-medium.onnx)
  JARWIZZ_SPEED  speaking rate multiplier          (default: 0.9)
                 < 1.0 speaks faster, > 1.0 slower (Piper's length_scale)
"""
import os
import numpy as np
import sounddevice as sd
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")

DEFAULT_MODEL = os.environ.get("JARWIZZ_VOICE", "en_US-bryce-medium.onnx")
DEFAULT_SPEED = float(os.environ.get("JARWIZZ_SPEED", "0.9"))
_model = None
_syn_config = None


def _get_model():
    global _model, _syn_config
    if _model is None:
        from piper import PiperVoice
        from piper.config import SynthesisConfig

        model_path = os.path.join(MODEL_DIR, DEFAULT_MODEL)
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Piper model not found at {model_path}. "
                f"Download from: https://huggingface.co/rhasspy/piper-voices"
            )
        _model = PiperVoice.load(model_path)
        _syn_config = SynthesisConfig(length_scale=DEFAULT_SPEED)
    return _model


def speak_piper(text, speed=None):
    """Synthesize text with Piper and play through speakers."""
    if not text or not text.strip():
        return

    voice = _get_model()
    if speed is not None and speed != DEFAULT_SPEED:
        from piper.config import SynthesisConfig
        cfg = SynthesisConfig(length_scale=speed)
    else:
        cfg = _syn_config

    chunks = []
    sample_rate = voice.config.sample_rate
    for chunk in voice.synthesize(text, syn_config=cfg):
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
    print(f"Speaking at {DEFAULT_SPEED}x length scale: '{text}'")
    speak_piper(text)
    print("Done.")
