@echo off
title Clothing POS - publish update to server
cd /d "%~dp0desktop"
rem ---- server that hosts https://<server>/updates/ (see deploy/README.md) ----
set "SERVER=root@pos.sh0p.tech"
set "DEST=/var/www/pos-updates/"

for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set "VER=%%v"
set "EXE=release\ClothingPOS-Setup-%VER%.exe"
if not exist "%EXE%" (echo [X] %EXE% not found - run build-desktop.bat first & timeout /t 30 & exit /b 1)
if not exist "release\latest.yml" (echo [X] release\latest.yml not found & timeout /t 30 & exit /b 1)

echo Publish Clothing POS %VER% to %SERVER%:%DEST%
echo Every shop will get the update notification within 4 hours (or on next start).
choice /m "Continue"
if errorlevel 2 exit /b 0

rem installer first, latest.yml last - shops only see the new version once the file is complete
scp "%EXE%" "%EXE%.blockmap" %SERVER%:%DEST% || goto :fail
scp "release\latest.yml" %SERVER%:%DEST% || goto :fail
echo.
echo ==========================================
echo  Published %VER%
echo  Check: https://pos.sh0p.tech/updates/latest.yml
echo ==========================================
timeout /t 20
exit /b 0

:fail
echo [X] Upload failed - check SSH access to %SERVER%
timeout /t 30
exit /b 1
