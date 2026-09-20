@echo off
title ASTRA - System Launcher
echo ========================================================
echo Launching ASTRA Manufacturing Intelligence Platform
echo ========================================================

echo 1. Starting Backend Engine on Port 5000...
start "ASTRA Backend (Port 5000)" cmd /c "cd /d %~dp0backend && python -m uvicorn app.main:app --host 127.0.0.1 --port 5000"

timeout /t 2 /nobreak >nul

echo 2. Starting AI Agent Server on Port 8000...
start "ASTRA Agent Server (Port 8000)" cmd /c "cd /d %~dp0frontend && node agent_server.mjs"

timeout /t 2 /nobreak >nul

echo 3. Opening Frontend in Browser (Port 5173)...
start http://localhost:5173

echo 4. Starting Frontend Dev Server...
cd /d "%~dp0frontend"
npm run dev
