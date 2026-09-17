@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo [Inhyma_ERP Frontend] Running pre-flight checks...

REM 1. Ensure .env exists
if not exist ".env" (
    if exist ".env.defaults" (
        echo [Inhyma_ERP Frontend] Initializing .env from .env.defaults...
        copy /Y ".env.defaults" ".env" >nul
    ) else if exist ".env.example" (
        echo [Inhyma_ERP Frontend] Copying .env.example to .env...
        copy /Y ".env.example" ".env" >nul
    )
)

REM 2. Ensure node_modules exists
if not exist "node_modules\" (
    echo [Inhyma_ERP Frontend] Installing dependencies via npm install...
    call npm install
    if errorlevel 1 (
        echo [Inhyma_ERP Frontend] [ERROR] npm install failed.
        exit /b 1
    )
)

REM 3. Start Vite dev server
echo [Inhyma_ERP Frontend] Starting Vite dev server on http://localhost:5174 ...
if "%~1"=="" goto default_start
call npm run dev -- %*
goto :eof

:default_start
call npm run dev
