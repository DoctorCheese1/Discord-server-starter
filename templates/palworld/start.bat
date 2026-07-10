@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Palworld Server Start

set "SERVER_DIR=%CD%"
set "PID_FILE=server.pid"
set "PALSERVER_EXE=PalServer.exe"
set "PALSERVER_ARGS="

if not exist "%SERVER_DIR%\%PALSERVER_EXE%" (
  echo [ERROR] %PALSERVER_EXE% was not found in %SERVER_DIR%.
  echo [ERROR] Run update.bat first or place these scripts in your Palworld server folder.
  exit /b 1
)

if exist "%SERVER_DIR%\%PID_FILE%" del /f /q "%SERVER_DIR%\%PID_FILE%" >nul 2>&1

echo Starting Palworld server...
echo Exe: %SERVER_DIR%\%PALSERVER_EXE%
echo Args: %PALSERVER_ARGS%

start "" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command ^
  "$wd='%SERVER_DIR%';" ^
  "$exe=Join-Path $wd '%PALSERVER_EXE%';" ^
  "$pidPath=Join-Path $wd '%PID_FILE%';" ^
  "$argList='%PALSERVER_ARGS%';" ^
  "if ([string]::IsNullOrWhiteSpace($argList)) { $p=Start-Process -FilePath $exe -WorkingDirectory $wd -PassThru; } else { $p=Start-Process -FilePath $exe -ArgumentList $argList -WorkingDirectory $wd -PassThru; };" ^
  "if (!(Test-Path $pidPath)) { New-Item -Path $pidPath -ItemType File -Force | Out-Null };" ^
  "Set-Content -Path $pidPath -Value $p.Id -NoNewline -Encoding ascii;"

echo [INFO] Start command sent.
exit /b 0
