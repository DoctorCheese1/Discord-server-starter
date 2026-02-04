import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import { findExecutables } from './steamExeScanner.mjs';
import {
  buildStartBat,
  buildStopBat,
  buildUpdateBat
} from './steamBatTemplates.mjs';

/* ================= PATH RESOLUTION ================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

/* ================= FILES ================= */

const STEAM_GAMES_FILE = path.join(__dirname, 'steam-games.json');
const STEAM_IDS_FILE   = path.join(__dirname, 'steamIds.json');
const SERVERS_FILE    = path.join(ROOT, 'data', 'servers.json');

/* ================= STEAMCMD DETECTION ================= */

function detectSteamCmd() {
  // 1️⃣ ENV
  if (process.env.STEAMCMD_EXE) {
    if (fs.existsSync(process.env.STEAMCMD_EXE)) {
      return process.env.STEAMCMD_EXE;
    }
    throw new Error(`STEAMCMD_EXE set but not found: ${process.env.STEAMCMD_EXE}`);
  }

  // 2️⃣ Common locations
  const candidates = [
    path.join(ROOT, 'steamcmd', 'steamcmd.exe'),
    'C:\\steamcmd\\steamcmd.exe',
    'C:\\Program Files (x86)\\Steam\\steamcmd.exe',
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // 3️⃣ PATH lookup
  try {
    const out = execSync('where steamcmd.exe', { stdio: 'pipe' })
      .toString()
      .split('\n')[0]
      .trim();
    if (out && fs.existsSync(out)) return out;
  } catch {
    // ignore
  }

  throw new Error(
    'SteamCMD not found. Set STEAMCMD_EXE in .env or install steamcmd.'
  );
}

const STEAMCMD_EXE = detectSteamCmd();

/* ================= HELPERS ================= */

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/* ================= CREATE ================= */

export function createSteamServer({
  serverId,
  appid,
  serverDir,
  chosenExe,
  launchArgs = ''
}) {
  if (!fs.existsSync(serverDir)) {
    fs.mkdirSync(serverDir, { recursive: true });
  }

  const games = loadJson(STEAM_GAMES_FILE, { games: [] }).games;
  const game = games.find(g => g.appid === Number(appid));

  const steamIds = loadJson(STEAM_IDS_FILE, { servers: {} });


const exes = findExecutables(serverDir);

if (!exes.length) {
  throw new Error(
    'No executable found after install. ' +
    'This server may require srcds.exe or manual selection.'
  );
}

// auto-pick common server exe
const preferred =
  exes.find(e => /srcds\.exe$/i.test(e)) ||
  exes.find(e => /server\.exe$/i.test(e)) ||
  exes[0];

if (!chosenExe && exes.length > 1 && !preferred) {
  return { needsExeChoice: true, exes };
}

const exePath = chosenExe || preferred;

// ================= RUN STEAMCMD INSTALL =================
console.log(`[STEAM] Installing AppID ${appid} to ${serverDir}`);

execSync(
  `"${STEAMCMD_EXE}" +force_install_dir "${serverDir}" +login anonymous +app_update ${appid} validate +quit`,
  { stdio: 'inherit' }
);


  steamIds.servers[serverId] = {
    appid: Number(appid),
    name: game?.name || 'Unknown Steam Server',
    dir: serverDir,
    exe: path.basename(exePath),
    args: launchArgs
  };

  saveJson(STEAM_IDS_FILE, steamIds);

  writeBats(steamIds.servers[serverId]);
  autoAddToServersJson(serverId, game?.name || serverId, serverDir);

  return {
    success: true,
    game: game?.name || 'Unknown',
    exe: exePath,
    steamcmd: STEAMCMD_EXE
  };
}

/* ================= REBUILD ================= */

export function rebuildSteamServer(serverId) {
  const steamIds = loadJson(STEAM_IDS_FILE, { servers: {} });
  const entry = steamIds.servers[serverId];
  if (!entry) throw new Error('Steam server not found');

  writeBats(entry);
  return true;
}

/* ================= REMOVE ================= */

export function removeSteamServer(serverId, { deleteFiles = false } = {}) {
  const steamIds = loadJson(STEAM_IDS_FILE, { servers: {} });
  const entry = steamIds.servers[serverId];
  if (!entry) throw new Error('Steam server not found');

  delete steamIds.servers[serverId];
  saveJson(STEAM_IDS_FILE, steamIds);

  const serversCfg = loadJson(SERVERS_FILE, { version: 1, servers: [] });
  serversCfg.servers = serversCfg.servers.filter(s => s.id !== serverId);
  saveJson(SERVERS_FILE, serversCfg);

  if (deleteFiles && fs.existsSync(entry.dir)) {
    fs.rmSync(entry.dir, { recursive: true, force: true });
  }

  return true;
}

/* ================= INTERNAL ================= */

function writeBats(entry) {
  const exePath = path.join(entry.dir, entry.exe);

  fs.writeFileSync(
    path.join(entry.dir, 'start.bat'),
    buildStartBat(exePath, entry.args || '')
  );

  fs.writeFileSync(
    path.join(entry.dir, 'stop.bat'),
    buildStopBat(exePath)
  );

  fs.writeFileSync(
    path.join(entry.dir, 'update.bat'),
    buildUpdateBat(STEAMCMD_EXE, entry.appid, entry.dir)
  );
}

function autoAddToServersJson(id, name, dir) {
  const cfg = loadJson(SERVERS_FILE, { version: 1, servers: [] });

  if (cfg.servers.some(s => s.id === id)) return;

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
