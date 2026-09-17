#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "[ERP_Main Backend] Running pre-flight checks..."

# 1. Ensure .env exists
if [ ! -f ".env" ]; then
    if [ -f ".env.defaults" ]; then
        echo "[ERP_Main Backend] Initializing .env from .env.defaults..."
        cp ".env.defaults" ".env"
    elif [ -f ".env.example" ]; then
        echo "[ERP_Main Backend] Copying .env.example to .env..."
        cp ".env.example" ".env"
    fi
fi

# 2. Ensure .venv exists
if [ ! -f ".venv/bin/activate" ]; then
    echo "[ERP_Main Backend] Virtual environment not found. Creating .venv..."
    python3 -m venv .venv || python -m venv .venv
fi

# 3. Activate .venv
echo "[ERP_Main Backend] Activating .venv..."
source .venv/bin/activate

# 4. Check dependencies
if ! python -c "import uvicorn, fastapi, alembic, sqlalchemy" 2>/dev/null; then
    echo "[ERP_Main Backend] Installing dependencies from requirements.txt..."
    python -m pip install --upgrade pip
    python -m pip install -r requirements.txt
fi

# 5. Run Database Migrations
if [ -f "alembic.ini" ]; then
    echo "[ERP_Main Backend] Applying database migrations..."
    python -m alembic upgrade heads || true
fi

# 6. Start Uvicorn Server
echo "[ERP_Main Backend] Starting FastAPI server on http://0.0.0.0:8000 ..."
if [ $# -eq 0 ]; then
    exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
else
    exec python -m uvicorn app.main:app "$@"
fi
