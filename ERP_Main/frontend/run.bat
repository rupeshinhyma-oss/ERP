@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo [ERP_Main Frontend] Running pre-flight checks...

REM 1. Ensure .env exists
if not exist ".env" (
    if exist ".env.defaults" (
        echo [ERP_Main Frontend] Initializing .env from .env.defaults...
        copy /Y ".env.defaults" ".env" >nul
    ) else if exist ".env.example" (
        echo [ERP_Main Frontend] Copying .env.example to .env...
        copy /Y ".env.example" ".env" >nul
    )
)

REM 2. Ensure node_modules exists
if not exist "node_modules\" (
    echo [ERP_Main Frontend] Installing dependencies via npm install...
    call npm install
    if errorlevel 1 (
        echo [ERP_Main Frontend] [ERROR] npm install failed.
        exit /b 1
    )
)

REM 3. Start Vite dev server
echo [ERP_Main Frontend] Starting Vite dev server on http://localhost:5170 ...
if "%~1"=="" goto default_start
call npm run dev -- %*
goto :eof

:default_start
call npm run dev
