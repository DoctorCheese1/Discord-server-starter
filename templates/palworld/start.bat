@echo off
setlocal
cd /d "%~dp0"

set "PID_FILE=%~dp0server.pid"
if exist "%PID_FILE%" del /f /q "%PID_FILE%" >nul 2>&1

if not exist "PalServer.exe" (
  echo [ERROR] PalServer.exe was not found in %CD%.
  echo [ERROR] Run update.bat first or place these scripts in your Palworld server folder.
  exit /b 1
)

start "" "PalServer.exe"

for /f "tokens=2 delims==" %%P in ('wmic process where "name='PalServer.exe'" get ProcessId /value ^| find "ProcessId="') do set "SERVER_PID=%%P"
if defined SERVER_PID (
  > "%PID_FILE%" echo %SERVER_PID%
  echo [INFO] Started PalServer.exe with PID %SERVER_PID%.
) else (
  echo [WARN] PalServer.exe was launched, but its PID could not be detected.
)

exit /b 0
