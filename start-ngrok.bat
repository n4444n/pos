@echo off
title POS - start
cd /d "%~dp0"

where node >nul 2>nul || (echo [X] Node.js not found - install from https://nodejs.org & pause & exit /b 1)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" || (echo [X] Node.js 22.13+ required - you have & node -v & echo Update from https://nodejs.org & pause & exit /b 1)

rem ---- find ngrok: PATH, winget, this folder, Desktop, Downloads ----
set "NGROK="
where ngrok >nul 2>nul && set "NGROK=ngrok"
if not defined NGROK for %%p in (
  "%LOCALAPPDATA%\Microsoft\WinGet\Links\ngrok.exe"
  "%~dp0ngrok.exe"
  "%USERPROFILE%\Desktop\ngrok.exe"
  "%USERPROFILE%\Downloads\ngrok.exe"
  "%USERPROFILE%\Downloads\ngrok-v3-stable-windows-amd64\ngrok.exe"
) do if not defined NGROK if exist %%p set "NGROK=%%~p"

if defined NGROK (
  echo ngrok = %NGROK%
) else (
  echo [!] ngrok not found - the server will run on http://localhost:3000 only.
  echo     To go online: download ngrok from https://ngrok.com/download
  echo     put ngrok.exe in this folder, run once:  ngrok config add-authtoken YOUR_TOKEN
  echo     then run this file again.
  echo.
)

if not exist node_modules (
  echo [1/3] npm install ...
  call npm install || (pause & exit /b 1)
)

echo [2/3] Build web + start server on port 3000 - window "POS Server"
start "POS Server" cmd /k "npm start"

echo Waiting for server (first build takes about 1 minute) ...
:wait
timeout /t 3 /nobreak >nul
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/auth/config -TimeoutSec 2) | Out-Null; exit 0 } catch { exit 1 }" || goto wait

if not defined NGROK (
  echo.
  echo ==========================================
  echo  Local  : http://localhost:3000
  echo  Online : - ngrok not installed -
  echo ==========================================
  start "" "http://localhost:3000"
  echo To stop: close the "POS Server" window
  pause
  exit /b 0
)

echo [3/3] Start ngrok - window "ngrok"
start "ngrok" cmd /k ""%NGROK%" http 3000"
set "URL="
for /l %%i in (1,1,10) do if not defined URL (
  timeout /t 2 /nobreak >nul
  for /f "usebackq delims=" %%u in (`powershell -NoProfile -Command "try { (Invoke-RestMethod http://127.0.0.1:4040/api/tunnels).tunnels[0].public_url } catch { '' }"`) do set "URL=%%u"
)
> ngrok-url.txt echo %URL%

echo.
echo ==========================================
echo  Local  : http://localhost:3000
echo  Online : %URL%
echo ==========================================
if defined URL (start "" "%URL%") else (echo [!] No ngrok link - check the "ngrok" window. Did you run: ngrok config add-authtoken YOUR_TOKEN ?)
echo To stop: close the "POS Server" and "ngrok" windows
pause
