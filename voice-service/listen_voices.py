"""
Jarwizz voice previewer.
Downloads short sample clips for a set of candidate Piper voices and opens the
folder so you can listen, then tell the assistant which one you want.

Usage:
  venv\Scripts\python.exe listen_voices.py
  venv\Scripts\python.exe listen_voices.py en_US-ryan-medium en_GB-alan-medium
"""
import os
import sys
import shutil
import webbrowser

from huggingface_hub import hf_hub_download

REPO = "rhasspy/piper-voices"
SAMPLES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tts", "samples")
os.makedirs(SAMPLES_DIR, exist_ok=True)

# Curated male / deep English voices to audition (override via argv).
DEFAULT_CANDIDATES = [
    "en_US-ryan-medium",
    "en_US-john-medium",
    "en_US-mike-medium",
    "en_US-norman-medium",
    "en_US-joe-medium",
    "en_US-hfc_male-medium",
    "en_US-arctic-medium",
    "en_US-bryce-medium",
    "en_GB-northern_english_male-medium",
    "en_GB-alan-medium",
]


def locale_and_folder(base):
    locale, _, folder = base.replace("-medium", "").rpartition("-")
    return locale, folder


def main():
    candidates = sys.argv[1:] or DEFAULT_CANDIDATES
    print("Downloading sample clips (this needs internet, one time)...\n")
    for base in candidates:
        locale, folder = locale_and_folder(base)
        sample = f"en/{locale}/{folder}/medium/samples/speaker_0.mp3"
        try:
            src = hf_hub_download(repo_id=REPO, filename=sample, local_dir=SAMPLES_DIR)
            dst = os.path.join(SAMPLES_DIR, base + ".mp3")
            shutil.move(src, dst)
            print(f"  [ok]   {base}")
        except Exception as e:
            print(f"  [skip] {base}: {e}")

    print(f"\nSamples saved to: {SAMPLES_DIR}")
    print("Open the folder and listen to each .mp3, then tell me which voice you want.")
    try:
        os.startfile(SAMPLES_DIR) if hasattr(os, "startfile") else webbrowser.open(SAMPLES_DIR)
    except Exception:
        pass


if __name__ == "__main__":
    main()
