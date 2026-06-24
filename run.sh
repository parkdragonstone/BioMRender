#!/usr/bin/env bash
# Launch BioM Render: FastAPI backend (8137) + Vite frontend (5173) on macOS / Linux.
# Usage:  bash run.sh        (or  chmod +x run.sh  then  ./run.sh)
# Windows users: use run.ps1 instead.
#
# On first run this creates backend/venv and installs Python + npm deps. The
# venv shipped in the repo is Windows-only, so a fresh one is built here.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 1

# --- locate a Python interpreter ---------------------------------------------
PY="${PYTHON:-python3}"
command -v "$PY" >/dev/null 2>&1 || PY=python
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "Python 3.10+ not found. Install it (or set \$PYTHON) and retry." >&2
  exit 1
fi

VENV_DIR="$ROOT/backend/venv"
VENV_PY="$VENV_DIR/bin/python"

# --- one-time backend setup --------------------------------------------------
if [ ! -x "$VENV_PY" ]; then
  echo "Setting up backend venv (first run on this OS)…"
  "$PY" -m venv "$VENV_DIR" || { echo "Failed to create venv." >&2; exit 1; }
  "$VENV_PY" -m pip install --upgrade pip >/dev/null
  "$VENV_PY" -m pip install -r "$ROOT/backend/requirements.txt" || {
    echo "Failed to install Python dependencies." >&2; exit 1; }
fi

# --- one-time frontend setup -------------------------------------------------
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "Installing frontend dependencies (first run)…"
  ( cd "$ROOT/frontend" && npm install ) || {
    echo "npm install failed. Is Node.js installed?" >&2; exit 1; }
fi

# --- launch ------------------------------------------------------------------
echo "Starting backend on http://127.0.0.1:8137 ..."
( cd "$ROOT/backend" && exec "$VENV_PY" -m uvicorn app.main:app --port 8137 ) &
BACKEND_PID=$!

echo "Starting frontend on http://localhost:5173 ..."
( cd "$ROOT/frontend" && exec npm run dev ) &
FRONTEND_PID=$!

cleanup() {
  echo ""
  echo "Stopping servers…"
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup INT TERM EXIT

echo ""
echo "Open http://localhost:5173 in your browser."
echo "Press Ctrl+C to stop both servers."

# Wait on the frontend; when it exits (or Ctrl+C), cleanup kills the backend.
wait "$FRONTEND_PID"
