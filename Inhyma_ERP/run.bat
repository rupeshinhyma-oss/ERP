@echo off
REM Inhyma ERP (India Distribution) Standalone Launcher
cd /d "%~dp0"

IF "%1"=="--windows" (
    python run.py --windows
) ELSE (
    python run.py %*
)
