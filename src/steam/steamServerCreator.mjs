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
  const startBat = `@echo off\r\ncd /d "%~dp0"\r\nif exist start_server.bat (\r\n  call start_server.bat\r\n  exit /b %errorlevel%\r\n)\r\necho [WARN] start_server.bat not found. Edit start.bat for your game.\r\nexit /b 1\r\n`;

  const stopBat = `@echo off\r\nif exist stop_server.bat (\r\n  call stop_server.bat\r\n  exit /b %errorlevel%\r\n)\r\necho [WARN] stop_server.bat not found. Edit stop.bat for your game.\r\nexit /b 0\r\n`;

  const updateBat = `@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nset "APPID=${quoteForBat(appid)}"\r\nset "STEAMCMD_EXE=%STEAMCMD_EXE%"\r\nif not defined STEAMCMD_EXE set "STEAMCMD_EXE=steamcmd"\r\nwhere "%STEAMCMD_EXE%" >nul 2>&1\r\nif errorlevel 1 (\r\n  echo [ERROR] Could not find steamcmd. Set STEAMCMD_EXE env var or add steamcmd to PATH.\r\n  exit /b 1\r\n)\r\necho [INFO] Installing/updating AppID %APPID% in %CD%\r\n"%STEAMCMD_EXE%" +force_install_dir "%CD%" +login anonymous +app_update %APPID% validate +quit\r\nexit /b %errorlevel%\r\n`;

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

  const cwd = path.resolve(serverDir);

  scaffoldSteamScripts({ serverDir: cwd, appid });

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
