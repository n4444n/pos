@echo off
title Clothing POS - test printing (local)
cd /d "%~dp0"
rem Runs everything locally for testing receipt printing without a real printer:
rem   POS server (local test database)  -> http://localhost:3000
rem   Printer emulator (ESC/POS)         -> port 9100, results at http://localhost:9101
rem   Desktop app (dev mode)
rem Does NOT touch the real shop data on the VPS.

where node >nul 2>nul || (echo [X] Node.js not found - install from https://nodejs.org & pause & exit /b 1)

if not exist node_modules (
  echo [1/4] npm install ...
  call npm install || (pause & exit /b 1)
)
echo [2/4] Build web (about 1 minute) ...
call npm run build:web || (pause & exit /b 1)
if not exist desktop\node_modules (
  echo [3/4] Install desktop app packages ...
  pushd desktop
  call npm install || (popd & pause & exit /b 1)
  popd
)

echo [4/4] Start server, printer emulator and app ...
start "POS Server (local)" cmd /k "npm run dev:api"
start "Printer emulator" cmd /k "npm run printer:emulator"
timeout /t 4 /nobreak >nul
start "" "http://localhost:9101"
start "Desktop app" cmd /k "cd desktop && npm start"

echo.
echo ================================================================
echo  In the app: menu (Alt) - settings (Ctrl+,)
echo    Server  : http://localhost:3000
echo    Print   : ESC/POS  -  LAN/WiFi  -  IP 127.0.0.1  port 9100
echo  Then press "Test print" / sell something, and watch
echo  http://localhost:9101 for the printed receipts.
echo  Manager PIN for the local test database is shown in the
echo  "POS Server (local)" window.
echo  When done: set the server back to https://pos.sh0p.tech
echo ================================================================
pause
