@echo off
title WhatsApp Message Scheduler
echo ===================================================
echo   WhatsApp Message Scheduler wird gestartet...
echo ===================================================
timeout /t 2 /nobreak >nul
start http://localhost:3000
npm start
pause
