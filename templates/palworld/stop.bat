@echo off
setlocal
cd /d "%~dp0"

set "PID_FILE=%~dp0server.pid"

if exist "%PID_FILE%" (
  for /f "usebackq delims=" %%P in ("%PID_FILE%") do set "SERVER_PID=%%P"
)

if defined SERVER_PID (
  taskkill /PID %SERVER_PID% /F >nul 2>&1
  if not errorlevel 1 (
    del /f /q "%PID_FILE%" >nul 2>&1
    echo [INFO] Stopped PalServer.exe PID %SERVER_PID%.
    exit /b 0
  )
)

taskkill /IM PalServer.exe /F
set "EXIT_CODE=%errorlevel%"
if "%EXIT_CODE%"=="0" del /f /q "%PID_FILE%" >nul 2>&1
exit /b %EXIT_CODE%
