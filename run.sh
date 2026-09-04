#!/usr/bin/env bash
# Start Featuremania locally: FastAPI on :8000 and Next.js on :3000.
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

need pnpm
need uv

if port_busy 8000; then
  echo "Port 8000 is already in use. Stop the other API process, then run ./run.sh again." >&2
  exit 1
fi
if port_busy 3000; then
  echo "Port 3000 is already in use. Stop the other Next.js process, then run ./run.sh again." >&2
  exit 1
fi

if [[ ! -f apps/web/.env.local ]]; then
  echo "Warning: apps/web/.env.local is missing. Copy GitHub OAuth + NEXTAUTH_* from .env.example." >&2
fi
if [[ ! -f .env ]]; then
  echo "Warning: repo-root .env is missing. FastAPI needs OTARI_API_KEY for preflight and load." >&2
fi

if [[ ! -d node_modules ]]; then
  pnpm install
fi

API_PID=""
cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

(
  cd "$ROOT/apps/api"
  uv sync
  exec uv run uvicorn src.main:app --reload --host 127.0.0.1 --port 8000
) &
API_PID=$!

echo "API  http://127.0.0.1:8000/health"
echo "Web  http://localhost:3000/login"
echo "Ctrl+C stops both."

pnpm --filter web dev
