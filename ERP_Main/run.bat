@echo off
REM ERP_Main Control Plane Standalone Launcher
cd /d "%~dp0"

IF "%1"=="--windows" (
    python run.py --windows
) ELSE (
    python run.py %*
)
