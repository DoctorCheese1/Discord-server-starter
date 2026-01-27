import path from 'path';

export function buildStartBat(exePath, args = '') {
  const exe = path.basename(exePath);
  return `@echo off
title Steam Server
cd /d "%~dp0"
echo Starting server...
start "" "${exe}" ${args}
`;
}

export function buildStopBat(exePath) {
  const exe = path.basename(exePath);
  return `@echo off
echo Stopping server...
taskkill /IM "${exe}" /F >nul 2>&1
`;
}

export function buildUpdateBat(appid, installDir) {
  return `@echo off
echo Updating server (AppID ${appid})
"C:\\Program Files (x86)\\Steam\\steamcmd.exe" ^
+force_install_dir "${installDir}" ^
+login anonymous ^
+app_update ${appid} validate ^
+quit
`;
}
