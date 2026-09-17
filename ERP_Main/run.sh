#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "==============================================================================="
echo "               ERP_Main - Global Control Plane Standalone Runner"
echo "==============================================================================="
echo "Backend:  http://127.0.0.1:8000 (Docs: http://127.0.0.1:8000/docs)"
echo "Frontend: http://127.0.0.1:5170"
echo "==============================================================================="

(cd backend && ./run.sh) &
BACKEND_PID=$!

(cd frontend && ./run.sh) &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true" SIGINT SIGTERM EXIT
wait
