#!/usr/bin/env bash
# Jarwizz v1 launcher (Linux).
# Starts the local model runtime (llama.cpp, Vulkan) and the backend together.
#
# Usage:
#   ./scripts/start-jarwizz.sh              # model + backend
#   ./scripts/start-jarwizz.sh --voice      # + voice service
#   ./scripts/start-jarwizz.sh --ui         # + Vite dev server (dashboard)
#   ./scripts/start-jarwizz.sh --voice --ui # everything
#
# Services run detached with their output in .run/*.log. When tmux is available
# the logs are also opened as live tiled panes in a `jarwizz-logs` window
# (--no-tmux to skip, --logs to only open the panes for services already up).
#
# Stop everything with: ./scripts/stop-jarwizz.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
VOICE_DIR="$REPO_ROOT/voice-service"
FRONTEND_DIR="$REPO_ROOT/frontend"
LOG_DIR="$REPO_ROOT/.run"
mkdir -p "$LOG_DIR"

WANT_VOICE=0
WANT_UI=0
WANT_TMUX=1
LOGS_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --voice)    WANT_VOICE=1 ;;
    --ui)       WANT_UI=1 ;;
    --no-tmux)  WANT_TMUX=0 ;;
    --tmux)     WANT_TMUX=1 ;;
    --logs)     LOGS_ONLY=1 ;;
    -h|--help)  sed -n '2,18p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

# ---- Config (backend/.env is the single source of truth; env vars win) ----
if [[ -f "$BACKEND_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^[A-Z_]+=' "$BACKEND_DIR/.env")
  set +a
fi
LLAMA_SERVER_BIN="${LLAMA_SERVER_BIN:-$HOME/opt/llama.cpp/build/bin/llama-server}"
MODEL_PATH="${MODEL_PATH:-$HOME/models/Qwen3VL-8B-Instruct-Q4_K_M.gguf}"
MMPROJ_PATH="${MMPROJ_PATH:-$HOME/models/mmproj-Qwen3VL-8B-Instruct-F16.gguf}"
LLAMA_GPU_LAYERS="${LLAMA_GPU_LAYERS:-99}"
LLAMA_CTX_SIZE="${LLAMA_CTX_SIZE:-8192}"
LLAMA_PORT="${LLAMA_PORT:-8080}"
BACKEND_PORT="${PORT:-4000}"

# Set by --logs: attach panes to whatever is already running and exit without
# touching any service.
run_logs_only() {
  local panes=(llama-server backend)
  [[ -f "$LOG_DIR/voice.log" ]]    && panes+=(voice)
  [[ -f "$LOG_DIR/frontend.log" ]] && panes+=(frontend)
  open_log_panes "${panes[@]}"
  exit 0
}

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
cyan()  { printf '\033[0;36m%s\033[0m\n' "$1"; }
gray()  { printf '\033[0;90m%s\033[0m\n' "$1"; }
warn()  { printf '\033[0;33m%s\033[0m\n' "$1" >&2; }

# Start a long-running process detached, record its real PID, and do not keep a
# handle on this script's stdout.
#
# The obvious spelling — ( cd "$dir" && nohup cmd > log 2>&1 & echo $! ) — is a
# trap: `cd && nohup cmd` is backgrounded as a *unit*, so bash forks an
# intermediate subshell that runs cmd in the foreground and blocks on it forever.
# That subshell inherits this script's stdout, so a caller piping us (`| tail`)
# never sees EOF, and $! is the subshell's PID rather than the process we want to
# be able to stop later. Backgrounding the whole subshell and `exec`ing inside it
# means the PID we record *is* the process.
start_bg() {
  local name="$1" workdir="$2"
  shift 2
  ( cd "$workdir" && exec "$@" ) > "$LOG_DIR/$name.log" 2>&1 < /dev/null &
  local pid=$!
  echo "$pid" > "$LOG_DIR/$name.pid"
  disown "$pid" 2>/dev/null || true
}

TMUX_SESSION="jarwizz"
TMUX_WINDOW="jarwizz-logs"

# Open one live-tailing tmux pane per service, tiled in a dedicated window.
#
# Services are deliberately detached (see start_bg), which means their output
# only ever reaches .run/*.log — nothing is printed to whoever ran this script.
# These panes are how you actually watch them.
open_log_panes() {
  local names=("$@")
  (( ${#names[@]} )) || return 0

  if ! command -v tmux >/dev/null 2>&1; then
    warn "tmux not found — follow the logs with: tail -F $LOG_DIR/*.log"
    return 0
  fi

  local target sess
  if [[ -n "${TMUX:-}" ]]; then
    # Already inside tmux: put the panes in a dedicated window of this session,
    # replacing a previous one so repeat runs don't pile windows up.
    sess=$(tmux display-message -p '#S')
    tmux kill-window -t "${sess}:${TMUX_WINDOW}" 2>/dev/null || true
    target=$(tmux new-window -d -P -F '#{session_name}:#{window_index}' \
             -n "$TMUX_WINDOW" -c "$REPO_ROOT" \
             "tail -n 200 -F '$LOG_DIR/${names[0]}.log'")
  else
    tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
    tmux new-session -d -s "$TMUX_SESSION" -n "$TMUX_WINDOW" -c "$REPO_ROOT" \
         "tail -n 200 -F '$LOG_DIR/${names[0]}.log'"
    target="${TMUX_SESSION}:${TMUX_WINDOW}"
  fi

  tmux select-pane -t "$target" -T "${names[0]}" 2>/dev/null || true
  local i
  for (( i = 1; i < ${#names[@]}; i++ )); do
    # -F retries missing files, so a service started later still gets tailed.
    tmux split-window -t "$target" -c "$REPO_ROOT" \
         "tail -n 200 -F '$LOG_DIR/${names[i]}.log'"
    tmux select-pane -t "$target" -T "${names[i]}" 2>/dev/null || true
    tmux select-layout -t "$target" tiled >/dev/null
  done

  # Label each pane in its border — once tiled, four tails look identical.
  tmux set-option -w -t "$target" pane-border-status top >/dev/null 2>&1 || true
  tmux set-option -w -t "$target" pane-border-format ' #{pane_title} ' >/dev/null 2>&1 || true
  tmux select-layout -t "$target" tiled >/dev/null

  if [[ -n "${TMUX:-}" ]]; then
    # Only steal focus for a human at a terminal; a piped/scripted caller keeps
    # its output and can switch over when it wants to.
    if [[ -t 1 ]]; then
      tmux select-window -t "$target"
    else
      gray "[LAUNCH] Logs in tmux window '$TMUX_WINDOW' — switch with: tmux select-window -t $TMUX_WINDOW"
    fi
  else
    gray "[LAUNCH] Logs in tmux session '$TMUX_SESSION' — attach with: tmux attach -t $TMUX_SESSION"
  fi
}

(( LOGS_ONLY )) && run_logs_only

# Total VRAM currently allocated across GPUs, in bytes. Used to prove the model
# really landed on the GPU: llama-server does not log its backend at the default
# verbosity, so grepping the log for "vulkan" reports a false alarm on a
# perfectly good full-offload run.
# True if the process recorded in .run/<name>.pid is still alive. Voice and the
# dashboard have no health endpoint to probe, so without this a second
# `--voice --ui` run would happily start duplicates of both.
pid_alive() {
  local pid
  [[ -f "$LOG_DIR/$1.pid" ]] || return 1
  read -r pid < "$LOG_DIR/$1.pid" || return 1
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

vram_used_bytes() {
  local total=0 f val found=0
  for f in /sys/class/drm/card*/device/mem_info_vram_used; do
    [[ -r "$f" ]] || continue
    read -r val < "$f" || continue
    total=$(( total + val ))
    found=1
  done
  if (( ! found )) && command -v nvidia-smi >/dev/null 2>&1; then
    val=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null | awk '{s+=$1} END{print s*1024*1024}')
    [[ -n "$val" ]] && { total="$val"; found=1; }
  fi
  (( found )) || return 1
  printf '%s' "$total"
}

wait_for_url() {
  local url="$1"
  local timeout="${2:-120}"
  # Separate lines on purpose: bash expands every word of a `local` command
  # before performing any of its assignments, so folding this into the line
  # above would evaluate $timeout while it is still unset (fatal under `set -u`).
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    curl -fsS --max-time 3 "$url" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

# ---- 1. Model runtime ----
if wait_for_url "http://127.0.0.1:$LLAMA_PORT/health" 2; then
  gray '[LAUNCH] llama-server already running, skipping start.'
else
  cyan '[LAUNCH] Starting llama.cpp (Vulkan)...'
  [[ -x "$LLAMA_SERVER_BIN" ]] || { echo "llama-server not found at $LLAMA_SERVER_BIN (set LLAMA_SERVER_BIN)" >&2; exit 1; }
  [[ -f "$MODEL_PATH" ]]       || { echo "model not found at $MODEL_PATH (set MODEL_PATH)" >&2; exit 1; }

  # --mmproj loads the vision projector; without it Qwen3-VL is text-only and
  # read_screen / describeScreen fail at request time rather than at startup.
  llama_args=(
    --model "$MODEL_PATH"
    --ctx-size "$LLAMA_CTX_SIZE"
    --gpu-layers "$LLAMA_GPU_LAYERS"
    --host 127.0.0.1 --port "$LLAMA_PORT"
    --jinja
  )
  [[ -f "$MMPROJ_PATH" ]] && llama_args+=(--mmproj "$MMPROJ_PATH") \
                          || warn "mmproj not found at $MMPROJ_PATH — vision (read_screen) will be unavailable."

  vram_before=$(vram_used_bytes || echo 0)
  start_bg llama-server "$REPO_ROOT" "$LLAMA_SERVER_BIN" "${llama_args[@]}"
  gray "[LAUNCH] llama-server PID $(cat "$LOG_DIR/llama-server.pid")  (log: .run/llama-server.log)"
  if ! wait_for_url "http://127.0.0.1:$LLAMA_PORT/health" 180; then
    warn 'llama.cpp did not become healthy in time. Check .run/llama-server.log. Continuing anyway.'
  else
    # Confirm the GPU is actually carrying the model — a CPU-only fallback still
    # answers, just far too slowly to use by voice. Measured, not grepped.
    vram_after=$(vram_used_bytes || echo 0)
    vram_delta=$(( (vram_after - vram_before) / 1024 / 1024 ))
    if (( vram_delta > 512 )); then
      gray "[LAUNCH] GPU offload confirmed: +${vram_delta} MiB VRAM while loading."
    elif grep -qi 'vulkan' "$LOG_DIR/llama-server.log"; then
      gray '[LAUNCH] Vulkan backend reported in log.'
    else
      warn "VRAM only grew ${vram_delta} MiB — llama.cpp may be running CPU-only. Check .run/llama-server.log."
    fi
  fi
fi

# ---- 2. Backend ----
if wait_for_url "http://127.0.0.1:$BACKEND_PORT/health" 2; then
  gray '[LAUNCH] backend already running, skipping start.'
else
  cyan '[LAUNCH] Starting backend (node src/server.js)...'
  start_bg backend "$BACKEND_DIR" node src/server.js
  gray "[LAUNCH] backend PID $(cat "$LOG_DIR/backend.pid")  (log: .run/backend.log)"
  if ! wait_for_url "http://127.0.0.1:$BACKEND_PORT/health" 45; then
    echo 'Backend failed to start. Check .run/backend.log.' >&2
    exit 1
  fi
fi
gmail_state=$(curl -fsS "http://127.0.0.1:$BACKEND_PORT/health" | sed -n 's/.*"gmail":"\([^"]*\)".*/\1/p')
green "[LAUNCH] Backend up. gmail=${gmail_state:-unknown}"

# ---- 3. Voice (optional) ----
if (( WANT_VOICE )); then
  VENV_PY="$VOICE_DIR/venv/bin/python"
  if pid_alive voice; then
    gray "[LAUNCH] voice service already running (PID $(cat "$LOG_DIR/voice.pid")), skipping start."
  elif [[ -x "$VENV_PY" ]]; then
    cyan '[LAUNCH] Starting voice service...'
    # -u: without it Python block-buffers stdout when it is not a TTY, so
    # .run/voice.log (and its log pane) stays empty until the buffer fills.
    start_bg voice "$VOICE_DIR" "$VENV_PY" -u main.py
    green "[LAUNCH] Voice service PID $(cat "$LOG_DIR/voice.pid"). Hold Ctrl+Shift to talk.  (log: .run/voice.log)"
  else
    warn "Voice venv not found at $VENV_PY — skipping voice launch."
  fi
fi

# ---- 4. Dashboard (optional) ----
if (( WANT_UI )); then
  if pid_alive frontend; then
    gray "[LAUNCH] dashboard already running (PID $(cat "$LOG_DIR/frontend.pid")), skipping start."
  else
    cyan '[LAUNCH] Starting dashboard...'
    start_bg frontend "$FRONTEND_DIR" npm run app:dev
    green "[LAUNCH] Dashboard PID $(cat "$LOG_DIR/frontend.pid")  (log: .run/frontend.log — Vite prints its URL there; it moves off 5173 if taken)"
  fi
fi

echo
green '[LAUNCH] Jarwizz v1 is running.'
gray "  Model:  http://127.0.0.1:$LLAMA_PORT   Backend: http://127.0.0.1:$BACKEND_PORT"
gray "  Logs:   $LOG_DIR/{llama-server,backend,voice,frontend}.log"
gray '  Stop everything with: ./scripts/stop-jarwizz.sh'

if (( WANT_TMUX )); then
  panes=(llama-server backend)
  (( WANT_VOICE )) && panes+=(voice)
  (( WANT_UI ))    && panes+=(frontend)
  open_log_panes "${panes[@]}"
fi
