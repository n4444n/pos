@echo off
title Clothing POS - build desktop installer (.exe)
cd /d "%~dp0desktop"
set "LOG=%~dp0build-desktop.log"
> "%LOG%" echo ===== build %date% %time% =====

where node >nul 2>nul || (echo [X] Node.js not found - install from https://nodejs.org & timeout /t 30 & exit /b 1)
for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set "VER=%%v"
echo Building Clothing POS %VER%  (app opens the central server - no local database)
echo To release a new version: change "version" in desktop\package.json first.
echo.

echo [1/2] Install Electron (first time takes a few minutes) ...
call npm install --no-audit --no-fund >> "%LOG%" 2>&1 || goto :fail

echo [2/2] Build installer (electron-builder) ...
call npx electron-builder --win nsis --x64 --publish never >> "%LOG%" 2>&1 || goto :fail

echo.
echo ==========================================
echo  DONE: desktop\release\ClothingPOS-Setup-%VER%.exe
echo  Send to all shops (auto-update): publish-update.bat
echo ==========================================
>> "%LOG%" echo ===== DONE =====
start "" explorer "%~dp0desktop\release"
timeout /t 20
exit /b 0

:fail
>> "%LOG%" echo ===== FAILED =====
echo.
echo [X] Build failed - see build-desktop.log
timeout /t 30
exit /b 1
