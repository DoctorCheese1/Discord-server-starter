@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title Palworld Server Start

set "SERVER_DIR=%CD%"
set "PID_FILE=%SERVER_DIR%\server.pid"
set "PALSERVER_EXE=PalServer.exe"
set "PALSERVER_ARGS="

if not exist "%SERVER_DIR%\%PALSERVER_EXE%" (
  echo [ERROR] %PALSERVER_EXE% was not found in %SERVER_DIR%.
  echo [ERROR] Run update.bat first or place these scripts in your Palworld server folder.
  exit /b 1
)

REM ================= CLEAN OLD PID =================
if exist "%PID_FILE%" del /f /q "%PID_FILE%" >nul 2>&1

echo [INFO] Launching Palworld...
echo Exe: %SERVER_DIR%\%PALSERVER_EXE%
echo Args: %PALSERVER_ARGS%

REM ================= LAUNCH + CAPTURE REAL SERVER PID =================
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$wd = '%SERVER_DIR%';" ^
  "$exe = Join-Path $wd '%PALSERVER_EXE%';" ^
  "$argList = '%PALSERVER_ARGS%';" ^
  "if ([string]::IsNullOrWhiteSpace($argList)) { $p = Start-Process -FilePath $exe -WorkingDirectory $wd -PassThru; } else { $p = Start-Process -FilePath $exe -ArgumentList $argList -WorkingDirectory $wd -PassThru; };" ^
  "Start-Sleep -Milliseconds 800;" ^
  "$real = $null;" ^
  "for($i=0;$i -lt 25 -and -not $real;$i++){ " ^
  "  $kids = Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $p.Id) -ErrorAction SilentlyContinue; " ^
  "  foreach($k in $kids){ if($k.Name -like 'PalServer*.exe'){ $real = $k.ProcessId } } " ^
  "  if(-not $real){ Start-Sleep -Milliseconds 200 } " ^
  "}" ^
  "if(-not $real){ " ^
  "  $candidate = Get-CimInstance Win32_Process -Filter \"Name LIKE 'PalServer%%.exe'\" -ErrorAction SilentlyContinue | Sort-Object CreationDate -Descending | Select-Object -First 1; " ^
  "  if($candidate){ $real = $candidate.ProcessId } " ^
  "}" ^
  "if(-not $real){ $real = $p.Id }" ^
  "Set-Content -Path '%PID_FILE%' -Value $real -NoNewline -Encoding ascii;" ^
  "Write-Host ('[INFO] Launched PID ' + $real)"

REM ================= WAIT FOR PID FILE =================
set "tries=0"
:wait_pid
set /a tries+=1

if not exist "%PID_FILE%" (
  if !tries! lss 30 (
    timeout /t 1 >nul
    goto wait_pid
  ) else (
    echo [WARN] PID file not found: %PID_FILE%
    goto done
  )
)

for %%A in ("%PID_FILE%") do set "size=%%~zA"
if "!size!"=="0" (
  if !tries! lss 30 (
    timeout /t 1 >nul
    goto wait_pid
  ) else (
    echo [WARN] PID file is empty: %PID_FILE%
    goto done
  )
)

set /p PID=<"%PID_FILE%"
set "PID=!PID: =!"

if "!PID!"=="" (
  echo [WARN] Failed to capture PID (empty).
) else (
  echo [INFO] Palworld server launched. PID=!PID!
)

:done
exit /b 0
