import fs from 'fs';
import path from 'path';
import { execFileSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import { findExecutables } from './steamExeScanner.mjs';
import { buildStartBat, buildStopBat, buildUpdateBat } from './steamBatTemplates.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const STEAM_GAMES_FILE = path.join(__dirname, 'steam-games.json');
const STEAM_IDS_FILE = path.join(__dirname, 'steamIds.json');
const SERVERS_FILE = path.join(ROOT, 'data', 'servers.json');

let cachedSteamCmdPath = '';

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
  }

  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function normalizeSteamCmdPath(rawValue = '') {
  const trimmed = String(rawValue).trim();
  const unwrapped = trimmed.replace(/^[\s'"`]+|[\s'"`]+$/g, '');
  const windowsExeMatch = unwrapped.match(/[a-zA-Z]:[\\/][^\r\n"']+?\.exe/i);
  return windowsExeMatch ? windowsExeMatch[0] : unwrapped;
}

function lookupSteamCmdFromPath() {
  if (process.platform !== 'win32') {
    return '';
  }

  try {
    const out = execSync('where steamcmd.exe', { stdio: 'pipe' }).toString();
    const found = out
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line && fs.existsSync(line));

    return found || '';
  } catch {
    return '';
  }
}

function resolveSteamCmdPath() {
  if (cachedSteamCmdPath) {
    return cachedSteamCmdPath;
  }

  const envPathRaw = process.env.STEAMCMD_EXE;
  if (envPathRaw) {
    const envPath = normalizeSteamCmdPath(envPathRaw);
    if (envPath && fs.existsSync(envPath)) {
      cachedSteamCmdPath = envPath;
      return cachedSteamCmdPath;
    }

    console.warn(`⚠️ STEAMCMD_EXE is set but not found: ${envPath}`);
  }

  const candidates = [
    path.join(ROOT, 'steamcmd', 'steamcmd.exe'),
    'C:\\steamcmd\\steamcmd.exe',
    'C:\\Program Files (x86)\\Steam\\steamcmd.exe',
    lookupSteamCmdFromPath()
  ].filter(Boolean);

  const discovered = candidates.find(candidate => fs.existsSync(candidate));
  if (!discovered) {
    throw new Error('SteamCMD not found. Set STEAMCMD_EXE in .env or install steamcmd.');
  }

  cachedSteamCmdPath = discovered;
  return cachedSteamCmdPath;
}

function runSteamCmdInstall(appid, serverDir) {
  const steamcmdPath = resolveSteamCmdPath();
  const args = [
    '+force_install_dir',
    serverDir,
    '+login',
    'anonymous',
    '+app_update',
    String(appid),
    'validate',
    '+quit'
  ];

  execFileSync(steamcmdPath, args, { stdio: 'inherit' });
}

function writeBats(entry) {
  const exePath = path.join(entry.dir, entry.exe);
  const steamcmdPath = resolveSteamCmdPath();

  fs.writeFileSync(path.join(entry.dir, 'start.bat'), buildStartBat(exePath, entry.args || ''));
  fs.writeFileSync(path.join(entry.dir, 'stop.bat'), buildStopBat(exePath));
  fs.writeFileSync(path.join(entry.dir, 'update.bat'), buildUpdateBat(steamcmdPath, entry.appid, entry.dir));
}

function autoAddToServersJson(id, name, dir) {
  const cfg = loadJson(SERVERS_FILE, { version: 1, servers: [] });

  if (cfg.servers.some(server => server.id === id)) {
    return;
  }

  cfg.servers.push({
    id,
    name,
    type: 'steam',
    enabled: true,
    cwd: dir,
    steam: true,
    java: false
  });

  saveJson(SERVERS_FILE, cfg);
}

function createSteamServer({
  serverId,
  appid,
  serverDir,
  chosenExe,
  launchArgs = '',
  serverName
}) {
  if (!fs.existsSync(serverDir)) {
    fs.mkdirSync(serverDir, { recursive: true });
  }

  const games = loadJson(STEAM_GAMES_FILE, { games: [] }).games;
  const game = games.find(g => Number(g.appid) === Number(appid));
  const steamIds = loadJson(STEAM_IDS_FILE, { servers: {} });

  console.log(`[STEAM] Installing AppID ${appid} to ${serverDir}`);
  runSteamCmdInstall(appid, serverDir);

  const exes = findExecutables(serverDir);
  if (!exes.length) {
    throw new Error('No executable found after install. This server may require srcds.exe or manual selection.');
  }

  const preferredExe =
    exes.find(exe => /srcds\.exe$/i.test(exe)) ||
    exes.find(exe => /server\.exe$/i.test(exe)) ||
    exes[0];

  if (!chosenExe && exes.length > 1 && !preferredExe) {
    return { needsExeChoice: true, exes };
  }

  const selectedExe = chosenExe || preferredExe;

  steamIds.servers[serverId] = {
    appid: Number(appid),
    name: game ? game.name : 'Unknown Steam Server',
    dir: serverDir,
    exe: path.basename(selectedExe),
    args: launchArgs
  };

  saveJson(STEAM_IDS_FILE, steamIds);

  writeBats(steamIds.servers[serverId]);
  autoAddToServersJson(serverId, serverName || serverId, serverDir);

  return {
    success: true,
    game: game ? game.name : 'Unknown',
    exe: selectedExe,
    steamcmd: resolveSteamCmdPath()
  };
}

function rebuildSteamServer(serverId) {
  const steamIds = loadJson(STEAM_IDS_FILE, { servers: {} });
  const entry = steamIds.servers[serverId];

  if (!entry) {
    throw new Error('Steam server not found');
  }

  writeBats(entry);
  return true;
}

function removeSteamServer(serverId, { deleteFiles = false } = {}) {
  const steamIds = loadJson(STEAM_IDS_FILE, { servers: {} });
  const entry = steamIds.servers[serverId];

  if (!entry) {
    throw new Error('Steam server not found');
  }

  delete steamIds.servers[serverId];
  saveJson(STEAM_IDS_FILE, steamIds);

  const serversCfg = loadJson(SERVERS_FILE, { version: 1, servers: [] });
  serversCfg.servers = serversCfg.servers.filter(server => server.id !== serverId);
  saveJson(SERVERS_FILE, serversCfg);

  if (deleteFiles && fs.existsSync(entry.dir)) {
    fs.rmSync(entry.dir, { recursive: true, force: true });
  }

  return true;
}

export {
  createSteamServer,
  rebuildSteamServer,
  removeSteamServer
};
