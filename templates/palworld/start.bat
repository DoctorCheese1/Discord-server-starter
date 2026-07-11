@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title Palworld Server Start

set "SERVER_DIR=%CD%"
set "PID_FILE=%SERVER_DIR%\server.pid"
set "PALSERVER_EXE=PalServer.exe"
set "PALSERVER_ARGS="
set "LAUNCH_PS1=%TEMP%\palworld-launch-%RANDOM%-%RANDOM%.ps1"

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
REM Write the PowerShell launcher one line at a time so cmd.exe never has to
REM parse PowerShell parentheses or quotes inside a parenthesized batch block.
>"%LAUNCH_PS1%" echo $ErrorActionPreference = 'Stop'
>>"%LAUNCH_PS1%" echo $wd = $env:PALWORLD_SERVER_DIR
>>"%LAUNCH_PS1%" echo $exe = Join-Path -Path $wd -ChildPath $env:PALWORLD_SERVER_EXE
>>"%LAUNCH_PS1%" echo $argList = $env:PALWORLD_SERVER_ARGS
>>"%LAUNCH_PS1%" echo if ([string]::IsNullOrWhiteSpace($argList^)^) {
>>"%LAUNCH_PS1%" echo   $p = Start-Process -FilePath $exe -WorkingDirectory $wd -PassThru
>>"%LAUNCH_PS1%" echo } else {
>>"%LAUNCH_PS1%" echo   $p = Start-Process -FilePath $exe -ArgumentList $argList -WorkingDirectory $wd -PassThru
>>"%LAUNCH_PS1%" echo }
>>"%LAUNCH_PS1%" echo Start-Sleep -Milliseconds 800
>>"%LAUNCH_PS1%" echo $real = $null
>>"%LAUNCH_PS1%" echo for($i=0; $i -lt 25 -and -not $real; $i++^) {
>>"%LAUNCH_PS1%" echo   $kids = Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $p.Id^) -ErrorAction SilentlyContinue
>>"%LAUNCH_PS1%" echo   foreach($k in $kids^) { if($k.Name -like 'PalServer*.exe'^) { $real = $k.ProcessId } }
>>"%LAUNCH_PS1%" echo   if(-not $real^) { Start-Sleep -Milliseconds 200 }
>>"%LAUNCH_PS1%" echo }
>>"%LAUNCH_PS1%" echo if(-not $real^) {
>>"%LAUNCH_PS1%" echo   $candidate = Get-CimInstance Win32_Process -Filter "Name LIKE 'PalServer%%.exe'" -ErrorAction SilentlyContinue ^| Sort-Object CreationDate -Descending ^| Select-Object -First 1
>>"%LAUNCH_PS1%" echo   if($candidate^) { $real = $candidate.ProcessId }
>>"%LAUNCH_PS1%" echo }
>>"%LAUNCH_PS1%" echo if(-not $real^) { $real = $p.Id }
>>"%LAUNCH_PS1%" echo Set-Content -Path $env:PALWORLD_PID_FILE -Value $real -NoNewline -Encoding ascii
>>"%LAUNCH_PS1%" echo Write-Host ('[INFO] Launched PID ' + $real^)

set "PALWORLD_SERVER_DIR=%SERVER_DIR%"
set "PALWORLD_SERVER_EXE=%PALSERVER_EXE%"
set "PALWORLD_SERVER_ARGS=%PALSERVER_ARGS%"
set "PALWORLD_PID_FILE=%PID_FILE%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%LAUNCH_PS1%"
set "LAUNCH_EXIT=%ERRORLEVEL%"
del /f /q "%LAUNCH_PS1%" >nul 2>&1
if not "%LAUNCH_EXIT%"=="0" exit /b %LAUNCH_EXIT%

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
