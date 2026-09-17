#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "[ERP_Main Frontend] Running pre-flight checks..."

# 1. Ensure .env exists
if [ ! -f ".env" ]; then
    if [ -f ".env.defaults" ]; then
        echo "[ERP_Main Frontend] Initializing .env from .env.defaults..."
        cp ".env.defaults" ".env"
    elif [ -f ".env.example" ]; then
        echo "[ERP_Main Frontend] Copying .env.example to .env..."
        cp ".env.example" ".env"
    fi
fi

# 2. Ensure node_modules exists
if [ ! -d "node_modules" ]; then
    echo "[ERP_Main Frontend] Installing dependencies (npm install)..."
    npm install
fi

# 3. Start Vite dev server
echo "[ERP_Main Frontend] Starting Vite dev server on http://localhost:5170 ..."
exec npm run dev "$@"
