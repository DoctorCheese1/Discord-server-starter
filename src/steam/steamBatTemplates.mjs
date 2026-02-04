import path from 'path';
import { spawn } from 'child_process';

export function runUpdateDetached(serverDir) {
  const child = spawn(
    'cmd.exe',
    [
      '/c',
      'start',
      '""',          // 👈 REQUIRED empty title
      'cmd.exe',
      '/k',
      'update.bat'
    ],
    {
      cwd: serverDir,
      detached: true,
      stdio: 'ignore',
      shell: false
    }
  );

  child.unref();
}
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
+force_install_dir "%~dp0" ^
+login anonymous ^
+app_update APPID_HERE validate ^
+quit
`;
}
