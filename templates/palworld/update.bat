@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Updating Palworld

set "APPID=2394010"
set "INSTALL_DIR=%CD%"
set "COMPLETION_MARKER=%INSTALL_DIR%\update_complete.txt"
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

echo Checking for Palworld updates...
echo [INFO] Using SteamCMD: %STEAMCMD_EXE%
echo [INFO] Install directory: %INSTALL_DIR%
echo.

REM --- Update SteamCMD itself ---
echo Updating SteamCMD...
"%STEAMCMD_EXE%" +quit
if errorlevel 1 exit /b %errorlevel%
echo.

REM --- Update Palworld Dedicated Server ---
echo Updating Palworld Dedicated Server...
"%STEAMCMD_EXE%" +force_install_dir "%INSTALL_DIR%" ^
 +login anonymous ^
 +app_update %APPID% validate ^
 +quit
if errorlevel 1 exit /b %errorlevel%
echo.

REM --- Completion marker (ABSOLUTE PATH) ---
echo DONE > "%COMPLETION_MARKER%"
echo [INFO] Update complete. Wrote marker: %COMPLETION_MARKER%
exit /b 0
