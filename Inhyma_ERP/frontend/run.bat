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

REM 3. Clean up any stale listeners on port 5174 and start Vite dev server
if not "%~1"=="" goto custom_start
echo [Inhyma_ERP Frontend] Checking port 5174 for stale dev server processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":5174 .*LISTENING"') do if not "%%a"=="0" taskkill /F /T /PID %%a >nul 2>nul
echo [Inhyma_ERP Frontend] Starting Vite dev server on http://localhost:5174 ...
call npm run dev
goto :eof

:custom_start
echo [Inhyma_ERP Frontend] Starting Vite dev server with custom args...
call npm run dev -- %*
