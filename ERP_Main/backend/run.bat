@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo [ERP_Main Backend] Running pre-flight checks...

REM 1. Ensure .env exists
if not exist ".env" (
    if exist ".env.defaults" (
        echo [ERP_Main Backend] Initializing .env from .env.defaults...
        copy /Y ".env.defaults" ".env" >nul
    ) else if exist ".env.example" (
        echo [ERP_Main Backend] Copying .env.example to .env...
        copy /Y ".env.example" ".env" >nul
    )
)

REM 2. Ensure .venv exists
if not exist ".venv\Scripts\activate.bat" (
    echo [ERP_Main Backend] Virtual environment not found. Creating .venv...
    python -m venv .venv
    if errorlevel 1 (
        py -m venv .venv
    )
)

if not exist ".venv\Scripts\activate.bat" (
    echo [ERP_Main Backend] [ERROR] Failed to locate or create .venv\Scripts\activate.bat.
    echo Please ensure Python 3.11+ is installed and added to PATH.
    exit /b 1
)

REM 3. Activate .venv
echo [ERP_Main Backend] Activating .venv...
call ".venv\Scripts\activate.bat"

REM 4. Check dependencies
python -c "import uvicorn, fastapi, alembic, sqlalchemy" >nul 2>nul
if errorlevel 1 (
    echo [ERP_Main Backend] Installing dependencies from requirements.txt...
    python -m pip install --upgrade pip
    python -m pip install -r requirements.txt
    if errorlevel 1 (
        echo [ERP_Main Backend] [ERROR] Dependency installation failed.
        exit /b 1
    )
)

REM 5. Run Database Migrations
if exist "alembic.ini" (
    echo [ERP_Main Backend] Applying database migrations...
    python -m alembic upgrade heads
)

REM 6. Start Uvicorn Server
echo [ERP_Main Backend] Starting FastAPI server on http://0.0.0.0:8000 ...
if "%~1"=="" goto default_start
python -m uvicorn app.main:app %*
goto :eof

:default_start
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
