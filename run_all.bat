@echo off
REM Multi-ERP Ecosystem Launcher
cd /d "%~dp0"

IF "%1"=="--windows" (
    python run_all.py --windows
) ELSE (
    python run_all.py %*
)
