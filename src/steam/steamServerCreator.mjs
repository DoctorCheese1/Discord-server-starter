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
  const startBat = `@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nif not exist start_server.bat (\r\n  echo [WARN] start_server.bat not found. Edit start.bat for your game.\r\n  exit /b 1\r\n)\r\nset "START_SCRIPT=%~dp0start_server.bat"\r\nset "PID_FILE=%~dp0server.pid"\r\nfor /f %%I in ('powershell -NoProfile -Command "$p = Start-Process -FilePath ''cmd.exe'' -ArgumentList ''/c'', $env:START_SCRIPT -WorkingDirectory $env:CD -PassThru; $p.Id"') do set "SERVER_PID=%%I"\r\nif not defined SERVER_PID (\r\n  echo [ERROR] Failed to capture server PID from start_server.bat launch.\r\n  exit /b 1\r\n)\r\n> "%PID_FILE%" echo %SERVER_PID%\r\necho [INFO] Started server wrapper with PID %SERVER_PID%\r\nexit /b 0\r\n`;

  const stopBat = `@echo off\r\nif exist stop_server.bat (\r\n  call stop_server.bat\r\n  exit /b %errorlevel%\r\n)\r\necho [WARN] stop_server.bat not found. Edit stop.bat for your game.\r\nexit /b 0\r\n`;

  const updateBat = `@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nset "APPID=${quoteForBat(appid)}"\r\nset "STEAMCMD_EXE=%STEAMCMD_EXE%"\r\nif defined STEAMCMD_EXE goto steamcmd_ready\r\nif exist "%~dp0steamcmd.exe" set "STEAMCMD_EXE=%~dp0steamcmd.exe"\r\nif not defined STEAMCMD_EXE if exist "%~dp0..\\steamcmd.exe" set "STEAMCMD_EXE=%~dp0..\\steamcmd.exe"\r\nif not defined STEAMCMD_EXE if exist "C:\\steamcmd\\steamcmd.exe" set "STEAMCMD_EXE=C:\\steamcmd\\steamcmd.exe"\r\nif not defined STEAMCMD_EXE if exist "C:\\SteamCMD\\steamcmd.exe" set "STEAMCMD_EXE=C:\\SteamCMD\\steamcmd.exe"\r\nif not defined STEAMCMD_EXE (\r\n  where steamcmd >nul 2>&1\r\n  if not errorlevel 1 set "STEAMCMD_EXE=steamcmd"\r\n)\r\n:steamcmd_ready\r\nif not defined STEAMCMD_EXE (\r\n  echo [ERROR] Could not find steamcmd. Set STEAMCMD_EXE env var, place steamcmd.exe in this folder, or add steamcmd to PATH.\r\n  exit /b 1\r\n)\r\necho [INFO] Installing/updating AppID %APPID% in %CD%\r\n"%STEAMCMD_EXE%" +force_install_dir "%CD%" +login anonymous +app_update %APPID% validate +quit\r\nexit /b %errorlevel%\r\n`;

  fs.writeFileSync(path.join(serverDir, 'start.bat'), startBat);
  fs.writeFileSync(path.join(serverDir, 'stop.bat'), stopBat);
  fs.writeFileSync(path.join(serverDir, 'update.bat'), updateBat);
}

export function scaffoldSteamScripts({ serverDir, appid }) {
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
  const { cwd } = scaffoldSteamScripts({ serverDir, appid });

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
