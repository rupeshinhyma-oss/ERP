@echo off
title Starting Yinglima ERP...
cd /d "%~dp0"

echo ========================================================
echo   STARTING YINGLIMA ERP
echo ========================================================
echo.

echo [1/2] Launching Backend (Port 8001)...
start "Yinglima Backend (8001)" cmd /k "cd /d ""%~dp0backend"" && .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload"

echo [2/2] Launching Frontend (Port 5173)...
start "Yinglima Frontend (5173)" cmd /k "cd /d ""%~dp0frontend"" && npm run dev"

echo.
echo Waiting for servers to initialize...
timeout /t 4 /nobreak >nul

echo Opening browser at http://localhost:5173 ...
start http://localhost:5173

echo.
echo ========================================================
echo   YINGLIMA ERP IS RUNNING!
echo   Frontend : http://localhost:5173
echo   Backend  : http://localhost:8001/docs
echo ========================================================
