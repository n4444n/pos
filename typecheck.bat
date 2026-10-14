@echo off
title POS - typecheck
cd /d "%~dp0"
echo Running TypeScript check ...
call npx tsc --noEmit > typecheck.log 2>&1
if errorlevel 1 (echo FAILED>> typecheck.log) else (echo PASSED>> typecheck.log)
type typecheck.log
timeout /t 15
