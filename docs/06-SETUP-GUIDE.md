# Local Setup Guide (100% Free Stack)

Follow in order. Each step is independently testable before moving on.

## 0. Prerequisites

- Node.js 20+, npm
- Python 3.10+
- Git
- A working microphone and speakers
- GPU with 8GB+ VRAM is a strong nice-to-have, not required to start

```bash
node -v && npm -v && python3 --version && git --version
```

## 1. Install Ollama (local model runtime)

```bash
curl -fsSL https://ollama.com/install.sh | sh   # macOS/Linux
# Windows: installer from https://ollama.com/download
ollama pull llama3.1:8b
```

Test:
```bash
curl http://localhost:11434/api/generate -d '{"model":"llama3.1:8b","prompt":"Say hello in one sentence."}'
```

## 2. Scaffold the repo

```bash
mkdir jarwizz && cd jarwizz
mkdir backend frontend voice-service
```

### Backend init
```bash
cd backend
npm init -y
npm install express cors dotenv ws
npm install -D nodemon
```

`.env`:
```
PORT=4000
MODEL_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
# Filled in later when funded:
# CLOUD_MODEL_PROVIDER=anthropic
# CLOUD_MODEL_API_KEY=
```

### Frontend init
```bash
cd ../frontend
npm create vite@latest . -- --template react
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

Add the color tokens from `04-UI-DESIGN-SYSTEM.md` into `tailwind.config.js` under `theme.extend.colors`, e.g.:
```javascript
theme: {
  extend: {
    colors: {
      'bg-void': '#0a0d0b',
      'bg-panel': '#121710',
      'green-primary': '#33FFA4',
      'green-dim': '#1f9e68',
      'amber-approval': '#E8B339',
      'red-error': '#E85B4E',
      'text-primary': '#E8F5EE',
      'text-secondary': '#8FA89B',
    }
  }
}
```

## 3. Install Playwright (browser automation)

```bash
cd ../backend
npm install playwright
npx playwright install
```

Smoke test — `test-playwright.js`:
```javascript
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('https://example.com');
  console.log(await page.title());
  await browser.close();
})();
```
```bash
node test-playwright.js
```

## 4. Local memory / vector store

```bash
npm install better-sqlite3 vectra
```

## 5. Gmail API (free tier)

1. Google Cloud Console → new project → enable Gmail API.
2. Create OAuth 2.0 credentials (Desktop app type).
3. Download credentials JSON → store in `backend/secrets/` → add to `.gitignore`.
4. `npm install googleapis`

Wire read/draft first, send-after-confirm second.

## 6. Voice service setup

```bash
cd ../voice-service
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install faster-whisper piper-tts sounddevice numpy
```

### Wake word — Porcupine (recommended to start, free tier, easiest custom wake word)
```bash
pip install pvporcupine pvrecorder
```
- Go to Picovoice Console (free account), create a custom wake word for "Jarwizz" (or "Hey Jarwizz"), download the `.ppn` model file into `voice-service/wakeword/`.

### Alternative — openWakeWord (fully open-source, no account needed)
```bash
pip install openwakeword
```
Use their training script/notebook to create a custom model if you want to avoid any third-party account dependency later.

### Test the mic pipeline
Create `voice-service/test_mic.py`:
```python
import sounddevice as sd
import numpy as np

duration = 3
print("Recording 3 seconds...")
audio = sd.rec(int(duration * 16000), samplerate=16000, channels=1, dtype='float32')
sd.wait()
print("Done. Max amplitude:", np.max(np.abs(audio)))
```
```bash
python3 test_mic.py
```
A non-zero max amplitude confirms the mic is being captured correctly.

### Test faster-whisper
```python
from faster_whisper import WhisperModel
model = WhisperModel("base", device="cpu")  # use "cuda" if you have a GPU
segments, info = model.transcribe("path_to_a_test_wav_file.wav")
for s in segments:
    print(s.text)
```

### Test Piper TTS
```bash
echo "Jarwizz is online." | piper --model en_US-lessac-medium --output_file test.wav
```
Play `test.wav` to confirm audio output works.

## 7. Verify each pillar independently before wiring together

1. `curl` to Ollama returns text → model runtime OK.
2. `node test-playwright.js` opens a browser and navigates → automation OK.
3. Express server on port 4000 responds to `/health` → backend OK.
4. `test_mic.py` shows non-zero amplitude → mic capture OK.
5. Wake-word script detects "Jarwizz" reliably in a quiet room → wake word OK.
6. faster-whisper transcribes a test phrase correctly → STT OK.
7. Piper produces audible speech → TTS OK.

Only once all seven pass independently should orchestration wiring begin — see `07-IMPLEMENTATION-PLAN.md` Phase 1.

## 8. When you add a cloud API later

1. Add `CLOUD_MODEL_PROVIDER` and `CLOUD_MODEL_API_KEY` to `backend/.env`.
2. In `backend/src/model/`, add a second client implementing the same interface as the Ollama client (e.g. `generatePlan(prompt)`).
3. In the router, add a rule: steps flagged `requires_vision` or `high_complexity` call the cloud client; everything else keeps using Ollama.

No architecture change required — this is a config-level swap by design.
