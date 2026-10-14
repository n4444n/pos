@echo off
title Clothing POS - build desktop installer (.exe)
cd /d "%~dp0"
set "LOG=%~dp0build-desktop.log"
> "%LOG%" echo ===== build %date% %time% =====

echo [1/4] Build web (expo export) ...
call npm run build:web >> "%LOG%" 2>&1 || goto :fail

echo [2/4] Copy Node.js runtime into the app ...
if not exist desktop\runtime mkdir desktop\runtime
set "NODEEXE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODEEXE set "NODEEXE=%%i"
if not defined NODEEXE (echo [X] node.exe not found >> "%LOG%" & goto :fail)
copy /y "%NODEEXE%" desktop\runtime\node.exe >> "%LOG%" 2>&1 || goto :fail
"%NODEEXE%" -v >> "%LOG%" 2>&1

echo [3/4] Install Electron (first time takes a few minutes) ...
pushd desktop
call npm install --no-audit --no-fund >> "%LOG%" 2>&1 || (popd & goto :fail)

echo [4/4] Build installer (electron-builder) ...
call npx electron-builder --win nsis --x64 >> "%LOG%" 2>&1 || (popd & goto :fail)
popd

echo.
echo ==========================================
echo  DONE: desktop\release\ClothingPOS-Setup-0.0.0.exe
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
