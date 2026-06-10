@echo off
setlocal

cd /d "%~dp0"

echo ========================================
echo Server Control Bot updater
echo ========================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git is required to update the bot.
  echo Install Git from https://git-scm.com/downloads and try again.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm is required to update the bot.
  echo Install Node.js from https://nodejs.org/ and try again.
  echo.
  pause
  exit /b 1
)

echo [1/3] Pulling latest bot files...
call npm run update:bot
if errorlevel 1 (
  echo.
  echo [ERROR] Bot update failed.
  echo Check the messages above, fix the problem, and run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo [2/3] Installing/updating npm dependencies...
call npm install
if errorlevel 1 (
  echo.
  echo [ERROR] Dependency install failed.
  echo The bot files may have updated, but dependencies did not install cleanly.
  echo.
  pause
  exit /b 1
)

echo.
echo [3/3] Verifying dependencies...
call npm run verify:deps
if errorlevel 1 (
  echo.
  echo [ERROR] Dependency verification failed.
  echo Run npm install manually, then run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo ========================================
echo Bot update complete.
echo Restart the bot if it is already running.
echo ========================================
echo.
pause
exit /b 0
