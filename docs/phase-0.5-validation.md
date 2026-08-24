# Phase 0.5 — Hardware & Model Validation — Results 2026-08-25

**Machine:** AMD RX 5500M (Navi 14 / gfx1012) + AMD Radeon Integrated Graphics, Vulkan Instance 1.3.301, 8GB system RAM, Windows

**Vulkan detection:**
- `vulkaninfo --summary` shows:
  - `GPU0: AMD Radeon(TM) Graphics 0x1002:0x1638 INTEGRATED 4036 MiB` driver 2.0.262 api 1.3.246
  - `GPU1: Radeon RX 5500M 0x1002:0x7340 DISCRETE 4080 MiB (2575 MiB free)` driver 2.0.310 api 1.3.287
- `llama-server --list-devices` confirms:
  ```
  Vulkan0: AMD Radeon(TM) Graphics (4036 MiB, 3834 free)
  Vulkan1: Radeon RX 5500M (4080 MiB, 2575 free)
  ```
- **Vulkan GPU offload active?** YES with caveat: `--gpu-layers 99` (docs example) **OOMs** (`vk::Device::allocateMemory: ErrorOutOfDeviceMemory` 353 MB + 10 KB) on this 4GB discrete card. With `--gpu-layers 5 --device Vulkan1 --ctx-size 2048` the model loads and inference succeeds; `--gpu-layers 15` also loads but decode OOMs (161 KB). Working config for this hardware is **5 layers on Vulkan1**, not 99. The 4GB VRAM is insufficient for full offload of Qwen3-VL-4B Q4_K_M + 8k ctx; 8GB VRAM card would fit 99 as docs assumed.

**Model:**
- `Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M` via `--hf-repo` auto-download (Hugging Face cache `C:\Users\aafaq\.cache\huggingface\hub\models--Qwen--Qwen3-VL-4B-Instruct-GGUF`)
- Files: `Qwen3VL-4B-Instruct-Q4_K_M.gguf` (~2.6 GB) + `mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf` (~433 MB) — correctly auto-selected via `mmproj` Q8_0.

**Server:** `llama-b10612-bin-win-vulkan-x64` prebuilt (`ggml-vulkan.dll` 54 MB) listening on `http://127.0.0.1:8080`, `n_ctx_slot 2048`, `n_slots 4`, `llama threadpool 6 threads`.

**Step 3 — Text-only planning prompt:**
- Request: `POST /v1/chat/completions` `{"model":"qwen3-vl-4b","messages":[{"role":"system","content":"You are a task planner..."},{"role":"user","content":"Given the command \"draft a reply to the last email from Raj saying I will be there at 5pm,\" return JSON..."}]}` (77 prompt tokens)
- Response: `200 OK` in **15403 ms** (prompt eval 1915 ms / 77 tokens, eval 13185 ms / 100 tokens, total 15100 ms per server log; client-measured 15403 ms). Body:
  ```json
  {"steps":[{"description":"Draft a reply email to Raj.","action_type":"compose_email","payload":{"to":"raj@example.com","subject":"Re: [Last Email]","body":"Hi Raj, I will be there at 5pm..."},"tier":"basic"}]}
  ```
  Valid JSON but `action_type`/`tier` not canonical — post-processing in `llamacppClient.js` will coerce.

**Step 3b — Simple hello (for baseline):**
- `POST {"messages":[{"role":"user","content":"Say hello in one sentence."}]}` → `200 OK` **2492 ms** (prompt 1929 ms /14 tok, eval 280 ms /3 tok, total 2209 ms server; client 2492 ms) → `Hello!`

**Step 4 — Vision (image+prompt):**
- Request: 1×1 white PNG base64 `iVBOR...` + `Describe what is visible in this image in one sentence.` (30 prompt tokens)
- Response: `200 OK` **4134 ms** (prompt 2261 ms /30 tok, eval 1764 ms /14 tok, total 4025 ms server; client 4134 ms) → `The image is entirely white and contains no visible content or details.` — correctly describes image, not hallucinated.

**Latencies recorded:**
- `hello (14 tok)` — **2.5 s** — judgment: **usable** for interactive voice (seconds, not minutes)
- `vision 1×1 PNG (30 tok)` — **4.1 s** — **usable**, within voice turn
- `planning JSON (77 tok prompt, 100 tok gen)` — **15.4 s** — **borderline** — several seconds longer than ideal for voice, but succeeds; dominated by eval (13 s). With full `SYSTEM_PROMPT` (+ examples, ~300 tok) will be slower. **Flagged as judgment call:** tolerable for Phase 1 dry-run, but consider quantization `Q4_0` or shorter prompt/context for production, or keep planning on CPU with fewer offloaded layers to free VRAM for KV.

**Checkpoint verdict:** **PASS with condition** — both text and vision calls succeed, Vulkan offload confirmed active on `Vulkan1` with `5 layers` (not 99). The `99 layers` example in docs is too aggressive for 4GB VRAM; recommend updating `06-SETUP-GUIDE.md:1c` and `.env` `LLAMACPP_ARGS` to ` --gpu-layers 20-30` or auto-fit, and `ctx-size 2048` for this hardware. Do not proceed to Phase 1 with `99`; proceed with `5` (or tuned) after documenting.

**Next:** Phase 1 can proceed using `backend/src/model/llamacppClient.js` (`generatePlan` + `describeScreen`) against this running server. Keep server alive: `C:\Users\aafaq\AppData\Local\Temp\opencode\llama-b10612-vulkan\llama-server.exe --hf-repo Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M --ctx-size 2048 --host 127.0.0.1 --port 8080 --gpu-layers 5 --device Vulkan1`
