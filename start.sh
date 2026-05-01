#!/bin/bash
# Twin Workspace — start both servers

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Starting Twin Workspace development servers..."
echo ""

# Backend
cd "$ROOT/backend"
uvicorn main:app --port 8000 --reload &
BACKEND_PID=$!
echo "Backend  → http://localhost:8000  (pid $BACKEND_PID)"

# Frontend
cd "$ROOT"
npm run dev &
FRONTEND_PID=$!
echo "Frontend → http://localhost:5175  (pid $FRONTEND_PID)"

echo ""
echo "Use a valid Hermes API key when signing in."
echo "Scheduled jobs run only while the backend process stays online."
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
