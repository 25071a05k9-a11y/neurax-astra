@echo off
title ASTRA - Frontend UI (Port 5173)
echo ========================================================
echo Starting ASTRA 3D Digital Twin UI (Port 5173)
echo ========================================================
cd /d "%~dp0frontend"
start http://localhost:5173
npm run dev
pause
