@echo off
rem MOESAS - uploads the changes made in this folder (code, documents, templates) to GitHub on a new
rem branch for review. Never uploaded: your data (.data), the local names file (scripts\*.local.json),
rem packages and build output (.gitignore). Needs Git for Windows (https://git-scm.com); the first
rem upload asks you to sign in to GitHub in the browser.
setlocal
title MOESAS - Upload to GitHub
cd /d "%~dp0"
set "REPO=https://github.com/mohasker/School-Accountant.git"
set "WEB=https://github.com/mohasker/School-Accountant"
set "BASE=claude/vibrant-bell-tj6ext"

where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Git is not installed. Install Git for Windows from the page that opens,
  echo  then double-click Upload-To-GitHub.bat again.
  start "" https://git-scm.com/download/win
  goto end
)

if exist .git goto stage
echo  First upload from this folder: linking it to %REPO% ...
git init -q
git remote add origin %REPO%
git fetch -q --depth=1 origin %BASE%
if errorlevel 1 goto failed
rem The folder's files stay as they are; only the comparison point is set to the version on GitHub.
git reset -q FETCH_HEAD
if errorlevel 1 goto failed

:stage
git config user.email >nul 2>nul || git config user.email "moesas-local@users.noreply.github.com"
git config user.name >nul 2>nul || git config user.name "MOESAS local copy"
git add -A
rem Files the build rewrites by itself are not changes.
git reset -q -- apps/web/tsconfig.json apps/web/tsconfig.tsbuildinfo apps/api/tsconfig.json apps/web/next-env.d.ts >nul 2>nul
rem Last guard: data, secrets and the local names file never leave this computer.
git diff --cached --name-only | findstr /r /c:"^\.data/" /c:"\.local\.json$" /c:"^\.env$" /c:"\.backup$" >nul
if not errorlevel 1 (
  echo  Stopped: data or private files were about to be uploaded. Nothing was sent.
  git reset -q
  goto end
)
git diff --cached --quiet
if not errorlevel 1 (
  echo  No changes to upload: this folder matches the version on GitHub.
  goto end
)
echo.
echo  Files to upload:
git diff --cached --stat
echo.
set "OK="
set /p OK= Upload these changes to GitHub? (Y/N): 
if /i not "%OK%"=="Y" (
  git reset -q
  echo  Cancelled. Nothing was sent.
  goto end
)
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set "STAMP=%%i"
set "BRANCH=local-updates-%STAMP%"
git commit -q -m "Changes from the local copy (%STAMP%)"
if errorlevel 1 goto failed
git push -q origin HEAD:refs/heads/%BRANCH%
if errorlevel 1 goto failed
echo.
echo  ============================================================
echo    Uploaded to GitHub, branch: %BRANCH%
echo    It does not change the main version until it is reviewed.
echo    Review page: %WEB%/compare/%BASE%...%BRANCH%
echo  ============================================================
start "" "%WEB%/compare/%BASE%...%BRANCH%"
goto end

:failed
echo.
echo  Upload failed (no internet, no GitHub sign-in, or no permission on the repository).
echo  Take a screenshot of this window and send it. Your files and data are unchanged.
:end
pause
