@echo off
REM Yinglima ERP (China Procurement) Standalone Launcher
cd /d "%~dp0"

IF "%1"=="--windows" (
    python run.py --windows
) ELSE (
    python run.py %*
)
