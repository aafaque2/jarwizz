#!/usr/bin/env bash
# Jarwizz v1 stopper (Linux). Kills what start-jarwizz.sh started.
# Prefers the recorded PIDs; falls back to command-line matching so it only
# stops Jarwizz processes, not every node/llama on the box.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_ROOT/.run"

kill_pidfile() {
  local name="$1" file="$LOG_DIR/$2.pid"
  [[ -f "$file" ]] || return 0
  local pid; pid=$(cat "$file")
  if kill -0 "$pid" 2>/dev/null; then
    echo "[STOP] killing $name PID $pid"
    kill "$pid" 2>/dev/null
    for _ in {1..10}; do kill -0 "$pid" 2>/dev/null || break; sleep 0.3; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
  fi
  rm -f "$file"
}

kill_pattern() {
  local name="$1" pattern="$2"
  # -f matches the full command line; anchored on this repo so other projects
  # running node/llama-server are untouched.
  for pid in $(pgrep -f "$pattern" 2>/dev/null); do
    [[ "$pid" == "$$" ]] && continue
    echo "[STOP] killing $name PID $pid"
    kill "$pid" 2>/dev/null
  done
}

kill_pidfile 'frontend'     frontend
kill_pidfile 'voice'        voice
kill_pidfile 'backend'      backend
kill_pidfile 'llama-server' llama-server

kill_pattern 'backend'      "node .*${REPO_ROOT}/backend/src/server.js"
kill_pattern 'voice'        "${REPO_ROOT}/voice-service/.*main\.py"
kill_pattern 'llama-server' 'llama-server .*--model .*\.gguf'

printf '\033[0;32m%s\033[0m\n' '[STOP] Done.'
