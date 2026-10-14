@echo off
title POS - restart server
cd /d "%~dp0"
rem Stop whatever is serving port 3000 (the old POS server), then rebuild + start again.
rem ngrok keeps running, so the online link stays the same.
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
echo Building web + starting server on port 3000 ...
start "POS Server" cmd /k "npm start"
exit /b 0
