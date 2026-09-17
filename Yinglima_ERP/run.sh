#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "==============================================================================="
echo "               Yinglima ERP (China Procurement) Standalone Runner"
echo "==============================================================================="
echo "Backend:  http://127.0.0.1:8001 (Docs: http://127.0.0.1:8001/docs)"
echo "Frontend: http://127.0.0.1:5173"
echo "==============================================================================="

(cd backend && ./run.sh) &
BACKEND_PID=$!

(cd frontend && ./run.sh) &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true" SIGINT SIGTERM EXIT
wait
