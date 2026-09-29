@echo off
rem MOESAS - one-click start on Windows (your real data, kept in the .data\moesas folder; a daily copy goes to .data\backups).
rem Needs Node.js 22.12+ (https://nodejs.org). Keep this window open while using the system.
title MOESAS V0 - Government Schools Accountants System
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
rem Rebuild after an update: the prepared version is recorded next to the build.
set "WANT="
set "HAVE="
if exist VERSION set /p WANT=<VERSION
if exist apps\web\.next\madar-version set /p HAVE=<apps\web\.next\madar-version
if exist apps\web\.next\BUILD_ID if exist dist\main.js if "%HAVE%"=="%WANT%" goto run
echo  Preparing the application (first run or new version)...
call npm run build
if errorlevel 1 goto failed
if exist VERSION copy /y VERSION apps\web\.next\madar-version >nul
:run

echo.
echo  ============================================================
echo    MOESAS is starting. The browser opens by itself when ready.
echo    Address : http://localhost:3000
echo    First time: create the system administrator account on the page.
echo    Your data: %~dp0.data\moesas   (daily copies in .data\backups)
echo    To stop : close this window
echo  ============================================================
echo.
start "" /b powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){try{Invoke-WebRequest -UseBasicParsing http://localhost:3000 -TimeoutSec 2 | Out-Null; Start-Process 'http://localhost:3000'; break}catch{Start-Sleep 2}}"
call npm run local
goto end

:failed
echo.
echo  Setup failed. Take a screenshot of this window and send it.
:end
pause
