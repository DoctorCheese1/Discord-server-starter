import fs from 'fs';
import path from 'path';
import { addServer } from '../serverStore.mjs';

function sanitizeId(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'steam-server';
}

function quoteForBat(value) {
  return String(value).replace(/"/g, '');
}

function writeScripts(serverDir, appid) {
  const startBat = `@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nset "PID_FILE=%~dp0server.pid"\r\nif exist "%PID_FILE%" del /f /q "%PID_FILE%" >nul 2>&1\r\nif not exist start_server.bat (\r\n  echo [WARN] start_server.bat not found. Edit start.bat for your game.\r\n  exit /b 1\r\n)\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process cmd.exe -ArgumentList '/c','call ""%~dp0start_server.bat""' -WorkingDirectory '%CD%' -PassThru; $p.Id | Out-File -FilePath '%PID_FILE%' -Encoding ascii"\r\nif errorlevel 1 (\r\n  echo [ERROR] Failed to launch start_server.bat via PowerShell.\r\n  exit /b 1\r\n)\r\nfor /f "usebackq delims=" %%P in ("%PID_FILE%") do set "SERVER_PID=%%P"\r\nif defined SERVER_PID echo [INFO] Started wrapper process with PID %SERVER_PID% (saved to server.pid).\r\nexit /b 0\r\n`;

  const stopBat = `@echo off\r\nif exist stop_server.bat (\r\n  call stop_server.bat\r\n  exit /b %errorlevel%\r\n)\r\necho [WARN] stop_server.bat not found. Edit stop.bat for your game.\r\nexit /b 0\r\n`;

  const updateBat = `@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nset "APPID=${quoteForBat(appid)}"\r\nset "ENV_STEAMCMD_EXE=%STEAMCMD_EXE%"\r\nset "STEAMCMD_EXE="\r\nif defined ENV_STEAMCMD_EXE (\r\n  if exist "%ENV_STEAMCMD_EXE%" (\r\n    set "STEAMCMD_EXE=%ENV_STEAMCMD_EXE%"\r\n  ) else (\r\n    where "%ENV_STEAMCMD_EXE%" >nul 2>&1\r\n    if not errorlevel 1 set "STEAMCMD_EXE=%ENV_STEAMCMD_EXE%"\r\n  )\r\n)\r\nif not defined STEAMCMD_EXE if exist "%~dp0steamcmd.exe" set "STEAMCMD_EXE=%~dp0steamcmd.exe"\r\nif not defined STEAMCMD_EXE if exist "%~dp0..\\steamcmd\\steamcmd.exe" set "STEAMCMD_EXE=%~dp0..\\steamcmd\\steamcmd.exe"\r\nif not defined STEAMCMD_EXE if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\\SteamCMD\\steamcmd.exe" set "STEAMCMD_EXE=%ProgramFiles(x86)%\\SteamCMD\\steamcmd.exe"\r\nif not defined STEAMCMD_EXE (\r\n  where steamcmd >nul 2>&1\r\n  if not errorlevel 1 set "STEAMCMD_EXE=steamcmd"\r\n)\r\nif not defined STEAMCMD_EXE (\r\n  echo [ERROR] Could not find steamcmd.\r\n  echo [ERROR] Set STEAMCMD_EXE or place steamcmd.exe next to update.bat.\r\n  exit /b 1\r\n)\r\necho [INFO] Using steamcmd: %STEAMCMD_EXE%\r\necho [INFO] Installing/updating AppID %APPID% in %CD%\r\n"%STEAMCMD_EXE%" +force_install_dir "%CD%" +login anonymous +app_update %APPID% validate +quit\r\nexit /b %errorlevel%\r\n`;

  fs.writeFileSync(path.join(serverDir, 'start.bat'), startBat);
  fs.writeFileSync(path.join(serverDir, 'stop.bat'), stopBat);
  fs.writeFileSync(path.join(serverDir, 'update.bat'), updateBat);
}

export function scaffoldSteamScripts({ serverDir, appid }) {
  if (!serverDir) {
    throw new Error('Missing serverDir');
  }

  if (!appid) {
    throw new Error('Missing AppID');
  }

  const cwd = path.resolve(serverDir);
  fs.mkdirSync(cwd, { recursive: true });
  writeScripts(cwd, appid);

  return {
    cwd,
    appid: Number(appid)
  };
}

export function createSteamServer({ serverId, appid, serverDir, serverName }) {
  if (!appid) {
    throw new Error('Missing AppID');
  }

  const id = sanitizeId(serverId || serverName);
  const cwd = path.resolve(serverDir);

  scaffoldSteamScripts({ serverDir: cwd, appid });

  addServer({
    id,
    name: serverName || id,
    type: 'steam',
    steam: true,
    java: false,
    enabled: true,
    cwd,
    appid: Number(appid)
  });

  return {
    id,
    cwd,
    appid: Number(appid)
  };
}
