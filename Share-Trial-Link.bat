@echo off
rem MOESAS - a temporary internet link to the TRIAL running on this computer (Start-Madar-Trial.bat),
rem so others can open it from any browser or phone until the system is published on a server.
rem Uses a free Cloudflare quick tunnel: no account, no router settings. The link works while this
rem window and the trial window stay open, and changes every time it starts.
setlocal
title MOESAS - Trial share link
cd /d "%~dp0"

powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing http://localhost:3000 -TimeoutSec 3 | Out-Null; exit 0}catch{exit 1}"
if errorlevel 1 (
  echo.
  echo  The trial is not running. Start Start-Madar-Trial.bat first, wait until it opens,
  echo  then run Share-Trial-Link.bat again.
  goto end
)

set "TOOL=%~dp0.data\tools\cloudflared.exe"
if exist "%TOOL%" goto run
echo  First use: downloading Cloudflare Tunnel (about 60 MB, once only)...
if not exist "%~dp0.data\tools" mkdir "%~dp0.data\tools"
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe -OutFile '%TOOL%'"
if not exist "%TOOL%" (
  echo  Download failed. Check the internet connection and try again.
  goto end
)

:run
echo.
echo  ============================================================
echo    Starting the share link. In a few seconds a box appears below
echo    with a link like:  https://xxxx-xxxx.trycloudflare.com
echo    Copy that link and send it with the shared account:
echo    guest (or the Arabic name) / 112233
echo    TRIAL DATA ONLY - never share your real data this way.
echo    To stop sharing: close this window.
echo  ============================================================
echo.
"%TOOL%" tunnel --no-autoupdate --url http://127.0.0.1:3000

:end
echo.
pause
