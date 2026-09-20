@echo off
title ASTRA - AI Agent Server (Port 8000)
echo ========================================================
echo Starting ASTRA AI Copilot Agent Server (Port 8000)
echo ========================================================
cd /d "%~dp0frontend"
node agent_server.mjs
pause
