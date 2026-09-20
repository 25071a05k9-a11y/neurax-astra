@echo off
title ASTRA - Backend Server (Port 5000)
echo ========================================================
echo Starting Industrial Defect & Simulation Engine (Port 5000)
echo ========================================================
cd /d "%~dp0backend"
python -m uvicorn app.main:app --host 127.0.0.1 --port 5000
pause
