@echo off
setlocal
cd /d "%~dp0"

set "APPID=2394010"
set "ENV_STEAMCMD_EXE=%STEAMCMD_EXE%"
set "STEAMCMD_EXE="

if defined ENV_STEAMCMD_EXE (
  if exist "%ENV_STEAMCMD_EXE%" (
    set "STEAMCMD_EXE=%ENV_STEAMCMD_EXE%"
  ) else (
    where "%ENV_STEAMCMD_EXE%" >nul 2>&1
    if not errorlevel 1 set "STEAMCMD_EXE=%ENV_STEAMCMD_EXE%"
  )
)

if not defined STEAMCMD_EXE if exist "%~dp0steamcmd.exe" set "STEAMCMD_EXE=%~dp0steamcmd.exe"
if not defined STEAMCMD_EXE if exist "%~dp0..\steamcmd\steamcmd.exe" set "STEAMCMD_EXE=%~dp0..\steamcmd\steamcmd.exe"
if not defined STEAMCMD_EXE if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\SteamCMD\steamcmd.exe" set "STEAMCMD_EXE=%ProgramFiles(x86)%\SteamCMD\steamcmd.exe"
if not defined STEAMCMD_EXE (
  where steamcmd >nul 2>&1
  if not errorlevel 1 set "STEAMCMD_EXE=steamcmd"
)

if not defined STEAMCMD_EXE (
  echo [ERROR] Could not find steamcmd.
  echo [ERROR] Set STEAMCMD_EXE or place steamcmd.exe next to update.bat.
  exit /b 1
)

echo [INFO] Using steamcmd: %STEAMCMD_EXE%
echo [INFO] Installing/updating Palworld Dedicated Server AppID %APPID% in %CD%
"%STEAMCMD_EXE%" +force_install_dir "%CD%" +login anonymous +app_update %APPID% validate +quit
exit /b %errorlevel%
