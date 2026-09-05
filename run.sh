#!/usr/bin/env bash
# Start Featuremania locally: FastAPI on :8000 and Next.js on :3000.
# Safe to run again: starts only whichever side is not already up.
# Usage: ./run.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing '$1'. Install it, then run ./run.sh again." >&2
    exit 1
  fi
}

port_busy() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

api_up() {
  curl -sf --max-time 2 "http://127.0.0.1:8000/health" >/dev/null 2>&1
}

web_up() {
  # Next redirects unauthenticated / to /login (307). Any HTTP answer counts.
  curl -sS --max-time 2 -o /dev/null "http://127.0.0.1:3000/" >/dev/null 2>&1
}

need pnpm
need uv
need curl
need lsof

if [[ ! -f apps/web/.env.local ]]; then
  echo "Warning: apps/web/.env.local is missing. Copy GitHub OAuth + NEXTAUTH_* from .env.example." >&2
fi
if [[ ! -f .env ]]; then
  echo "Warning: repo-root .env is missing. FastAPI needs OTARI_API_KEY for preflight and load." >&2
fi

if [[ ! -d node_modules ]]; then
  pnpm install
fi

STARTED_API=0
API_PID=""

cleanup() {
  trap - EXIT INT TERM
  if [[ "$STARTED_API" -eq 1 && -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

start_api() {
  echo "Starting API on :8000"
  (
    cd "$ROOT/apps/api"
    uv sync
    exec uv run uvicorn src.main:app --reload --host 127.0.0.1 --port 8000
  ) &
  API_PID=$!
  STARTED_API=1
  local n
  for n in $(seq 1 40); do
    if api_up; then
      return 0
    fi
    if ! kill -0 "$API_PID" 2>/dev/null; then
      echo "API exited before /health answered." >&2
      return 1
    fi
    sleep 0.5
  done
  echo "API started but /health did not answer yet. It may still be installing." >&2
}

if api_up; then
  echo "API already running on http://127.0.0.1:8000/health"
elif port_busy 8000; then
  echo "Port 8000 is in use, but /health did not answer. Leaving that process alone." >&2
else
  start_api
fi

echo "API  http://127.0.0.1:8000/health"
echo "Web  http://localhost:3000/login"

if web_up || port_busy 3000; then
  echo "Web already running."
  if [[ "$STARTED_API" -eq 1 ]]; then
    echo "Ctrl+C stops the API this script started. Existing web stays up."
    wait "$API_PID"
  else
    echo "Both already running. Nothing to start."
  fi
  exit 0
fi

echo "Starting web on :3000"
if [[ "$STARTED_API" -eq 1 ]]; then
  echo "Ctrl+C stops the API this script started and the web."
else
  echo "Ctrl+C stops the web. Existing API stays up."
fi
pnpm --filter web dev
