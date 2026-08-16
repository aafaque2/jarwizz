import sounddevice as sd
import numpy as np

duration = 3
print("Recording 3 seconds...")
audio = sd.rec(int(duration * 16000), samplerate=16000, channels=1, dtype='float32')
sd.wait()
print("Done. Max amplitude:", np.max(np.abs(audio)))
