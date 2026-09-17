#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "==============================================================================="
echo "               Inhyma ERP (India Distribution) Standalone Runner"
echo "==============================================================================="
echo "Backend:  http://127.0.0.1:8002 (Docs: http://127.0.0.1:8002/docs)"
echo "Frontend: http://127.0.0.1:5174"
echo "==============================================================================="

(cd backend && ./run.sh) &
BACKEND_PID=$!

(cd frontend && ./run.sh) &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true" SIGINT SIGTERM EXIT
wait
