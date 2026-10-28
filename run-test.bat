@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title Clothing POS - รันทดสอบบนเครื่องนี้
cd /d "%~dp0"
rem =====================================================================
rem  รันระบบทั้งชุดบนเครื่องนี้เพื่อพัฒนา/ทดสอบ (ไม่แตะ VPS และไม่แตะแอปที่ติดตั้งจริง)
rem
rem    run-test.bat           เปิดทุกอย่าง + แอปเดสก์ท็อป
rem    run-test.bat web       เปิดเฉพาะเซิร์ฟเวอร์ (ทดสอบในเบราว์เซอร์)
rem    run-test.bat ngrok     เปิดผ่าน ngrok ด้วย (ให้เครื่องอื่น/มือถือเข้าได้)
rem    run-test.bat reset     ลบข้อมูลทดสอบทั้งหมด แล้วเริ่มใหม่
rem
rem  โครงสร้างเหมือนบน VPS ทุกอย่างอยู่หลังพอร์ต 3100 พอร์ตเดียว
rem    :3000  ร้านหลัก (ข้อมูล data\pos.db)
rem    :3100  ประตู + แผงควบคุม license   /admin = แผงควบคุม · / = ร้านหลัก
rem    :3101+ ร้านทดลองที่สร้างจากแผงควบคุม (ข้อมูล license-server\data\trials\<ร้าน>)
rem =====================================================================

set "MODE=%~1"
set "BASE=http://localhost:3100"

if /i "%MODE%"=="reset" goto :reset

where node >nul 2>nul || (echo [X] ไม่พบ Node.js - ติดตั้งจาก https://nodejs.org & pause & exit /b 1)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set "NODEMAJOR=%%v"
if !NODEMAJOR! LSS 22 (echo [X] ต้องใช้ Node.js 22 ขึ้นไป ^(ตอนนี้ !NODEMAJOR!^) & pause & exit /b 1)

if not exist node_modules (
  echo [1/4] ติดตั้งแพ็กเกจ ^(ครั้งแรกใช้เวลาสักครู่^) ...
  call npm install --no-audit --no-fund || (echo [X] npm install ไม่สำเร็จ & pause & exit /b 1)
)
if not exist dist\index.html (
  echo [2/4] build หน้าเว็บ ...
  call npm run build:web || (echo [X] build ไม่สำเร็จ & pause & exit /b 1)
)
if /i not "%MODE%"=="web" if not exist desktop\node_modules\electron\dist\electron.exe (
  echo [3/4] ติดตั้งแอปเดสก์ท็อป ...
  pushd desktop
  call npm install --no-audit --no-fund
  popd
)

echo [4/4] เปิดเซิร์ฟเวอร์ ...
rem หน้าต่างลูกรับค่า environment จากตรงนี้ไป (ตั้งก่อน start จะได้ไม่ต้องใส่เครื่องหมายคำพูดซ้อนกัน)

rem ---- ร้านหลัก :3000 (ประตูเรียกใช้ตัวนี้)
set "PORT=3000"
set "POS_HOST=127.0.0.1"
start "ร้านหลัก :3000" cmd /k node --experimental-strip-types --disable-warning=ExperimentalWarning server\index.ts

rem ---- ประตู + แผงควบคุม :3100
rem    MAIN_SLUG/MAIN_PORT = ร้านหลักเข้าระบบ license เหมือนบน VPS
rem    LEGACY_MAIN=1       = เปิดร้านหลักในเบราว์เซอร์ได้เลยตอนพัฒนา (บน VPS ปิดไว้)
set "PORT="
set "POS_HOST="
set "MAIN_SLUG=main"
set "MAIN_PORT=3000"
set "MAIN_NAME=ร้านหลัก (ทดสอบ)"
set "LEGACY_MAIN=1"
cd license-server
start "ประตู + แผงควบคุม :3100" cmd /k node --experimental-strip-types --disable-warning=ExperimentalWarning server.ts
cd ..
timeout /t 5 /nobreak >nul

if /i "%MODE%"=="ngrok" call :ngrok || (pause & exit /b 1)

rem ---- รหัสผ่านแผงควบคุม + license ของร้านหลัก (ไว้กรอกในแอป)
set "ADMINPW="
if exist license-server\data\admin-password.txt for /f "usebackq delims=" %%p in ("license-server\data\admin-password.txt") do set "ADMINPW=%%p"
set "MAINCODE="
for /f "usebackq delims=" %%c in (`node -e "try{const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('license-server/data/license.db',{readOnly:true});const r=d.prepare('SELECT code FROM licenses WHERE slug = ?').get('main');if(r)console.log(r.code)}catch(e){}" 2^>nul`) do set "MAINCODE=%%c"

start "" "%BASE%/admin"
echo.
echo  ===================================================================
echo   แผงควบคุม license   %BASE%/admin
if defined ADMINPW echo   รหัสผ่าน            !ADMINPW!
echo   ร้านหลัก (เบราว์เซอร์) %BASE%/
if defined MAINCODE echo   license ร้านหลัก     !MAINCODE!   ^(กรอกในแอปเมื่อขึ้นหน้าเปิดใช้งาน^)
echo.
echo   แก้หน้าจอแล้วให้รัน build-web.bat แล้วกด Ctrl+R ในแอป/เบราว์เซอร์
echo   แก้ฝั่งเซิร์ฟเวอร์ (server\ หรือ license-server\) ให้ปิดหน้าต่างนั้นแล้วรันใหม่
echo   ปิดทั้งหมด: ปิดหน้าต่างสีดำทุกบาน   ลบข้อมูลทดสอบ: run-test.bat reset
echo  ===================================================================
echo.

if /i "%MODE%"=="web" (
  echo  โหมด web - ไม่เปิดแอปเดสก์ท็อป
  pause
  exit /b 0
)
cd desktop
set "POS_SERVER_URL=%BASE%"
call npx electron .
exit /b 0

rem ---------------------------------------------------------------- ลบข้อมูลทดสอบ
:reset
echo จะลบข้อมูลทดสอบทั้งหมดในโฟลเดอร์นี้:
echo   data\                      ข้อมูลร้านหลัก
echo   license-server\data\       license + ร้านทดลอง + ไฟล์สำรอง
echo   %%APPDATA%%\Clothing POS Dev  ค่าตั้งของแอปตอนพัฒนา
echo.
choice /c YN /m "ยืนยันลบ"
if errorlevel 2 exit /b 0
rmdir /s /q data 2>nul
rmdir /s /q license-server\data 2>nul
rmdir /s /q "%APPDATA%\Clothing POS Dev" 2>nul
echo ลบแล้ว - รัน run-test.bat ใหม่เพื่อเริ่มจากศูนย์
pause
exit /b 0

rem ---------------------------------------------------------------- ngrok
:ngrok
set "NGROK="
if exist "%~dp0ngrok.exe" set "NGROK=%~dp0ngrok.exe"
if not defined NGROK for /f "delims=" %%N in ('where ngrok 2^>nul') do if not defined NGROK set "NGROK=%%N"
if not defined NGROK for /d %%D in ("%~dp0..\*") do if exist "%%D\ngrok.exe" if not defined NGROK set "NGROK=%%D\ngrok.exe"
if not defined NGROK (
  echo [X] ไม่พบ ngrok - ติดตั้ง: winget install ngrok.ngrok  แล้ว  ngrok config add-authtoken ...
  exit /b 1
)
call :ngrokUrl
if defined NGROK_URL goto :ngrokReady
powershell -NoProfile -Command "try{Invoke-RestMethod http://127.0.0.1:4040/api/tunnels -TimeoutSec 2 | Out-Null; exit 0}catch{exit 1}" >nul 2>nul
if not errorlevel 1 (
  echo [X] มี ngrok ตัวอื่นเปิดอยู่ - ปิดหน้าต่าง ngrok เดิมก่อน แล้วรันใหม่
  exit /b 1
)
start "ngrok :3100" cmd /k ""%NGROK%" http 3100"
for /l %%i in (1,1,20) do (
  timeout /t 1 /nobreak >nul
  call :ngrokUrl
  if defined NGROK_URL goto :ngrokReady
)
echo [X] ไม่ได้ลิงก์จาก ngrok - ดูข้อความในหน้าต่าง ngrok
exit /b 1
:ngrokReady
set "BASE=%NGROK_URL%"
echo   ngrok               %NGROK_URL%
exit /b 0

:ngrokUrl
set "NGROK_URL="
for /f "usebackq delims=" %%u in (`powershell -NoProfile -Command "try{(Invoke-RestMethod http://127.0.0.1:4040/api/tunnels -TimeoutSec 2).tunnels | Where-Object { $_.config.addr -match ':3100$' -and $_.public_url -like 'https*' } | Select-Object -First 1 -ExpandProperty public_url}catch{}"`) do set "NGROK_URL=%%u"
exit /b 0
