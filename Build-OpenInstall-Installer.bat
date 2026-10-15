@echo off
setlocal
cd /d "%~dp0"
title Build OpenInstall Windows Installer
echo.
echo OpenInstall - Windows installer builder
echo This script builds the setup EXE from source.
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js LTS is required to build the app.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)
echo Step 1 of 3: install dependencies using npm 10...
call npx --yes npm@10 install
if errorlevel 1 goto failed
echo.
echo Step 2 of 3: syntax check...
call npx --yes npm@10 run check
if errorlevel 1 goto failed
echo.
echo Step 3 of 3: build Windows setup...
call npx --yes npm@10 run dist:win
if errorlevel 1 goto failed
echo.
echo Build complete. Opening release folder...
if exist "%~dp0release" explorer "%~dp0release"
pause
exit /b 0
:failed
echo.
echo Build failed. Review the error above; no installer is guaranteed to exist.
pause
exit /b 1
