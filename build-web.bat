@echo off
REM Rebuild the web pages only (the running POS server picks up the new build - just refresh the browser)
cd /d "%~dp0"
call npm run build:web
echo.
echo === Build finished - refresh the browser ===
timeout /t 15
