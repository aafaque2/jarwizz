# Local Setup Guide (100% Free Stack)

Follow in order. Each step is independently testable before moving on.

## 0. Prerequisites

- Node.js 20+, npm
- Python 3.10+
- Git
- A working microphone and speakers
- GPU with 8GB+ VRAM is a strong nice-to-have, not required to start — on the current dev machine (AMD RX 5500M, Navi 14 / gfx1012) llama.cpp with the **Vulkan** backend is the supported local path (ROCm is not officially supported on this GPU; see `02-ARCHITECTURE.md` §2). Vulkan drivers must be installed and up to date.
- Vulkan runtime/drivers: on Windows install the latest AMD Adrenalin driver (includes Vulkan); on Linux install `mesa-vulkan-drivers` / `vulkan-tools` for your distro and confirm `vulkaninfo` runs.

```bash
node -v && npm -v && python3 --version && git --version
vulkaninfo --summary   # should list your GPU — if this fails, fix Vulkan before continuing
```

## 1. Install llama.cpp with Vulkan (local model runtime)

Do **not** use ROCm on the RX 5500M — it is not officially supported on this GPU. The correct local path is llama.cpp with the Vulkan backend (cross-vendor, no ROCm/CUDA needed).

### 1a. Build llama.cpp with Vulkan support

**Windows (MSVC or MinGW) — Vulkan enabled:**
```bash
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
# Option A: CMake (recommended)
cmake -B build -DGGML_VULKAN=1
cmake --build build --config Release
# Binaries land in build/bin/ — e.g. build/bin/llama-server.exe and llama-cli.exe
```
On Linux the same CMake flags apply (`-DGGML_VULKAN=1`). Prebuilt Vulkan-enabled binaries are also published on the llama.cpp releases page — if you use a prebuilt zip, verify the filename/build notes explicitly mention Vulkan; a CPU-only build will silently run without GPU offload.

Verify the build reports Vulkan at startup — running `llama-server --help` should list `--vulkan` / Vulkan-related flags, and starting the server (step 1c) must log `vulkan` device detection, not just `cpu`.

### 1b. Download Qwen3-VL-4B GGUF (Q4_K_M)

The MVP model is **Qwen3-VL-4B, GGUF Q4_K_M** quantization — vision-capable, Apache 2.0 licensed, runs in ~3–6 GB at Q4, a good fit for 8 GB total RAM. Use the Q4_K_M quantized file (not the full-precision model).

```bash
# Example using huggingface-cli (or download manually from Hugging Face):
pip install -U "huggingface_hub[cli]"
huggingface-cli download Qwen/Qwen3-VL-4B-GGUF --include "*Q4_K_M*" --local-dir ./models
# Result should be a single .gguf file such as: qwen3-vl-4b-q4_k_m.gguf
# Place it at e.g. C:\models\qwen3-vl-4b-q4_k_m.gguf  (Windows)  or  ~/models/  (Linux/macOS)
```

> If the exact repo/filename differs, pick the **Qwen3-VL-4B Q4_K_M GGUF** published by Qwen — the key properties are: Qwen3-VL-4B base, GGUF container, `Q4_K_M` quantization.

### 1c. Smoke test — confirm Vulkan GPU offload is actually active

This test has two mandatory checks. Do not skip (a): a CPU-only llama.cpp build will still generate text, but without GPU offload latency will be far worse and you will mistakenly think the GPU is being used.

**Start the server with Vulkan offload:**
```bash
# Adjust paths to where you built/downloaded:
./build/bin/llama-server \
  --model /path/to/qwen3-vl-4b-q4_k_m.gguf \
  --vulkan \
  --gpu-layers 99 \
  --ctx-size 8192 \
  --host 127.0.0.1 --port 8080
# On Windows: .\build\bin\Release\llama-server.exe --model C:\models\qwen3-vl-4b-q4_k_m.gguf --vulkan --gpu-layers 99 --ctx-size 8192 --host 127.0.0.1 --port 8080
```
> **Dev-machine note (AMD RX 5500M, 4 GB VRAM):** `--gpu-layers 99` **OOMs** on this GPU.
> The validated config is `--gpu-layers 5 --device Vulkan1 --ctx-size 2048` (Vulkan1 = the discrete
> AMD GPU; Vulkan0 is the integrated adapter). The launcher `scripts/start-jarwizz.ps1` uses this.
> Pick the highest `--gpu-layers` that does **not** OOM on your GPU.

**(a) Verify Vulkan is actually in use (not silently CPU-only):**
- The server log on startup must mention `vulkan` / `Vulkan` and enumerate your GPU (e.g. `AMD Radeon RX 5500M` / `gfx1012`). If the log only mentions `cpu` or shows `0 layers offloaded`, the build is CPU-only — rebuild with `-DGGML_VULKAN=1` or use a known Vulkan-enabled binary.
- Optional extra confirmation: observe GPU utilization while the server is generating (Task Manager → Performance → GPU, or `radeontop` / `nvtop` on Linux) — it should spike during generation. No GPU activity means offload is not active.

**(b) Text-only prompt test:**
```bash
curl http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"qwen3-vl-4b\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hello in one sentence.\"}],\"temperature\":0.2}"
# Expect: JSON with choices[0].message.content containing a hello sentence. Note the wall-clock latency.
```

**(c) Vision (image+prompt) test — same server, same model:**
```bash
# Encode any small test image as base64 (e.g. a screenshot or photo):
# Linux/macOS:
IMAGE_B64=$(base64 -w 0 /path/to/test-image.png)
# Windows PowerShell:
# $IMAGE_B64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\test-image.png"))

curl http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"qwen3-vl-4b\",\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"Describe what is visible in this image in one sentence.\"},{\"type\":\"image_url\",\"image_url\":{\"url\":\"data:image/png;base64,'$IMAGE_B64'\"}}]]},\"temperature\":0.2}"
# Expect: a one-sentence description of the image. If the server returns an error about images/unsupported content, the model file or server version does not support vision — re-check you downloaded Qwen3-VL (not text-only Qwen3) and are on a recent llama.cpp build.
```

**Latency check:** both calls should complete in a time that feels interactive on this hardware (seconds, not minutes). There is no fixed millisecond threshold — judge whether the delay would be tolerable mid-task while voice-controlling Jarwizz. If either call takes unreasonably long or Vulkan offload is not active, stop and reassess quantization/model choice before continuing — see `07-IMPLEMENTATION-PLAN.md` Phase 0.5.

Keep this server running for subsequent phases — the orchestrator will call it via `LLAMACPP_URL` (see §2 below). Stop it with Ctrl+C when done testing.

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
MODEL_PROVIDER=llamacpp
LLAMACPP_URL=http://127.0.0.1:8080
MODEL_PATH=/path/to/qwen3-vl-4b-q4_k_m.gguf
# Optional tuning for the server process (if you launch it from Node):
# LLAMACPP_ARGS=--vulkan --gpu-layers 99 --ctx-size 8192
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

## 5. Gmail API (free tier) — real email sending

The backend already ships a full Gmail OAuth client (`backend/src/integrations/gmail/client.js`)
with a `credentials.json` + `token.json` flow and a mock fallback when unconfigured.
Follow these steps to connect **real** Gmail:

1. **Google Cloud Console** → create a project → **Enable APIs & Services** → enable **Gmail API**.
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Desktop app**.
   - Create, then **Download JSON**. Save it as `backend/secrets/credentials.json`.
   - `backend/secrets/` is already in `.gitignore` (never commit `credentials.json` or `token.json`).
3. Install the dependency (already in `package.json`): `npm install googleapis`.
4. **Start the backend** (`node src/server.js`). It logs `[GMAIL] No token found — running in MOCK mode`
   until you complete the one-time auth below.
5. **One-time auth** (copies a code back):
   ```bash
   # Get the consent URL
   curl http://localhost:4000/gmail/auth-url
   # → open the "url" in a browser, sign in, grant access, copy the code
   curl -X POST http://localhost:4000/gmail/callback -H "Content-Type: application/json" \
        -d "{\"code\":\"PASTE_CODE_HERE\"}"
   # → { "status": "connected" }
   ```
   The token is written to `backend/secrets/token.json` and the backend switches to real Gmail
   (confirmed by `GET /health` → `"gmail":"connected"`).
6. **Sending requires confirmation** — `gmail_send` is an *irreversible* tier, so the assistant
   always pauses for your approval before any email goes out.

Wire read/draft first, send-after-confirm second.

## 6. Voice service setup

```bash
cd ../voice-service
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install faster-whisper piper-tts sounddevice numpy
```

### Wake word — openWakeWord (recommended default: fully open-source, free forever, no account)
```bash
pip install openwakeword
```
Note: Picovoice/Porcupine's personal free tier was discontinued in mid-2026 (it's now a 7-day trial gated behind a company email, aimed at product teams evaluating a paid plan) — don't build against it. openWakeWord has no account, no time limit, and no usage cap, so it's the right free/local default for this project.

1. Start by testing with one of openWakeWord's built-in pretrained models (e.g. "hey jarvis") to validate your mic → wake-word → recording pipeline works before training anything custom.
2. Once that works, use openWakeWord's training notebook (runs locally or in a free Colab notebook) to generate a custom "Jarwizz" model — it synthesizes training audio via TTS + noise augmentation, so you don't need to record hundreds of samples yourself.
3. Drop the resulting model file into `voice-service/wakeword/`.

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

1. llama.cpp server health + Vulkan offload confirmed and `curl` to `LLAMACPP_URL/v1/chat/completions` returns text for **both** a text-only prompt and an image+prompt (vision) call with reasonable latency → model runtime OK. If Vulkan is not active or either call fails/slow, do not proceed — revisit the build/model choice (see §1c and `07-IMPLEMENTATION-PLAN.md` Phase 0.5).
2. `node test-playwright.js` opens a browser and navigates → automation OK.
3. Express server on port 4000 responds to `/health` → backend OK.
4. `test_mic.py` shows non-zero amplitude → mic capture OK.
5. Wake-word script detects "Jarwizz" reliably in a quiet room → wake word OK.
6. faster-whisper transcribes a test phrase correctly → STT OK.
7. Piper produces audible speech → TTS OK.

Only once all seven pass independently should orchestration wiring begin — see `07-IMPLEMENTATION-PLAN.md` Phase 1 (and Phase 0.5 validation before it).

## 8. When you add a cloud API later

1. Add `CLOUD_MODEL_PROVIDER` and `CLOUD_MODEL_API_KEY` to `backend/.env`.
2. In `backend/src/model/`, add a second client implementing the same interface as the llama.cpp client (e.g. `generatePlan(prompt)` and `describeScreen(imageBuffer, prompt)`).
3. In the router, add a rule: steps flagged `requires_vision` or `high_complexity` call the cloud client; everything else keeps using the local model runtime (llama.cpp + Qwen3-VL).

No architecture change required — this is a config-level swap by design. The local Qwen3-VL model already handles vision, so cloud fallback is for hard reasoning or cases where local quality proves insufficient — not a mandatory vision path.
