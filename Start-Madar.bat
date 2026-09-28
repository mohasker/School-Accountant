@echo off
rem Madar V0 - one-click trial on Windows (synthetic data, stored in the .data folder).
rem Needs Node.js 22.12+ (https://nodejs.org). Keep this window open while using the system.
title Madar V0
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Install the LTS version from the page that opens,
  echo  then double-click Start-Madar.bat again.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

rem Checks the installed tools themselves, so an interrupted first run is completed next time.
if not exist node_modules\.bin\prisma.cmd goto install
if not exist node_modules\.bin\next.cmd goto install
if not exist node_modules\.bin\tsx.cmd goto install
goto build
:install
echo  First run: installing packages - this takes a few minutes, once only...
call npm ci --include=dev --no-audit --no-fund
if errorlevel 1 goto failed
:build
if exist apps\web\.next\BUILD_ID if exist dist\main.js goto run
echo  First run: preparing the application...
call npm run build
if errorlevel 1 goto failed
:run

if "%DEMO_PASSWORD%"=="" set "DEMO_PASSWORD=Madar-Trial-2026"
echo.
echo  ============================================================
echo    Madar is starting. The browser opens by itself when ready.
echo    Address : http://localhost:3000
echo    Users   : accountant / admin / other
echo    Password: %DEMO_PASSWORD%
echo    To stop : close this window
echo  ============================================================
echo.
start "" /b powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){try{Invoke-WebRequest -UseBasicParsing http://localhost:3000 -TimeoutSec 2 | Out-Null; Start-Process 'http://localhost:3000'; break}catch{Start-Sleep 2}}"
call npm run demo
goto end

:failed
echo.
echo  Setup failed. Take a screenshot of this window and send it.
:end
pause
