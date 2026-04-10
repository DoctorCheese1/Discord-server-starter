import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/* ===============================
   PATHS (ABSOLUTE, SAFE)
================================ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// project root = one level up from /src
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data', 'servers.json');
const DEFAULT_SERVERS_DIR = 'C:/Servers';

/* ===============================
   RAW ACCESS
================================ */

function readRawConfig() {
  const raw = fs.existsSync(FILE)
    ? JSON.parse(fs.readFileSync(FILE, 'utf8'))
    : { servers: [] };

  if (!Array.isArray(raw.servers)) {
    raw.servers = [];
  }

  const changed = syncServersFolder(raw);
  if (changed) {
    saveRawConfig(raw);
  }

  return raw;
}

export const loadRawConfig = readRawConfig;

export function saveRawConfig(raw) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(raw, null, 2));
}

/* ===============================
   AUTO-DISCOVERY
================================ */

function getServersRoot() {
  return process.env.BASE_SERVER_DIR || DEFAULT_SERVERS_DIR;
}

function toServerId(folderName) {
  return folderName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'server';
}

function dedupeId(preferredId, usedIds) {
  if (!usedIds.has(preferredId)) return preferredId;

  let i = 2;
  while (usedIds.has(`${preferredId}-${i}`)) {
    i += 1;
  }

  return `${preferredId}-${i}`;
}

function inferServerType(cwd) {
  const files = fs.existsSync(cwd) ? fs.readdirSync(cwd) : [];
  const lowered = files.map(f => f.toLowerCase());

  const hasMinecraftJar = lowered.some(f => f.endsWith('.jar') && f.includes('minecraft'));
  const hasEula = lowered.includes('eula.txt');
  const hasServerProperties = lowered.includes('server.properties');

  if (hasMinecraftJar || hasEula || hasServerProperties) {
    return 'minecraft';
  }

  const hasSteamCmdArtifacts = lowered.some(f =>
    f.includes('steam_appid') ||
    f.includes('steamcmd') ||
    f.endsWith('.acf')
  );

  if (hasSteamCmdArtifacts) {
    return 'steam';
  }

  return 'generic';
}

function syncServersFolder(raw) {
  const rootDir = getServersRoot();

  if (!fs.existsSync(rootDir)) {
    fs.mkdirSync(rootDir, { recursive: true });
    return false;
  }

  const dirs = fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);

  const usedIds = new Set(raw.servers.map(s => s.id));
  const knownCwds = new Set(raw.servers.map(s => path.resolve(s.cwd || '')));

  let changed = false;

  for (const dirName of dirs) {
    const cwd = path.join(rootDir, dirName);
    const resolved = path.resolve(cwd);

    if (knownCwds.has(resolved)) {
      continue;
    }

    const type = inferServerType(cwd);
    const id = dedupeId(toServerId(dirName), usedIds);

    raw.servers.push({
      id,
      name: dirName,
      type,
      enabled: true,
      cwd,
      steam: type === 'steam',
      java: type === 'minecraft'
    });

    usedIds.add(id);
    knownCwds.add(resolved);
    changed = true;
  }

  return changed;
}

/* ===============================
   NORMALIZATION
================================ */

function normalizeServer(s) {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    enabled: s.enabled !== false,
    cwd: s.cwd,

    steam: s.steam === true || s.type === 'steam',
    java: s.java === true,
    group: typeof s.group === 'string' ? s.group : '',
    processName: s.processName,

    startBat: path.join(s.cwd, 'start.bat'),
    stopBat: path.join(s.cwd, 'stop.bat'),
    updateBat: path.join(s.cwd, 'update.bat'),
    pidFile: path.join(s.cwd, 'server.pid')
  };
}

/* ===============================
   RUNTIME ACCESS
================================ */

export function loadServers({ includeDisabled = false } = {}) {
  const raw = readRawConfig();
  let servers = (raw.servers || []).map(normalizeServer);

  if (!includeDisabled) {
    servers = servers.filter(s => s.enabled);
  }

  return servers;
}

export function getServer(idOrName, opts) {
  return loadServers(opts).find(
    s => s.id === idOrName || s.name === idOrName
  );
}

/* ===============================
   COMMAND HELPERS
================================ */

/**
 * Used by slash-command choices
 */
export function serverChoices({ steamOnly = false, includeDisabled = false, group } = {}) {
  const raw = readRawConfig();

  return (raw.servers || [])
    .filter(s => includeDisabled || s.enabled !== false)
    .filter(s => !steamOnly || s.steam === true || s.type === 'steam')
    .filter(s => !group || String(s.group || '').toLowerCase() === String(group).toLowerCase())
    .map(s => ({
      name: s.name,
      value: s.id
    }))
    .slice(0, 25); // Discord hard limit
}

/**
 * Add a new server to servers.json
 */
export function addServer(server) {
  const raw = readRawConfig();

  if (raw.servers.some(s => s.id === server.id)) {
    throw new Error(`Server with id "${server.id}" already exists`);
  }

  raw.servers.push({
    id: server.id,
    name: server.name ?? server.id,
    type: server.type ?? 'generic',
    enabled: server.enabled !== false,
    cwd: server.cwd,
    steam: server.steam === true,
    java: server.java === true,
    group: typeof server.group === 'string' ? server.group : '',
    appid: server.appid,
    processName: server.processName
  });

  saveRawConfig(raw);
}

/**
 * Remove a server from servers.json
 */
export function removeServer(id) {
  const raw = readRawConfig();
  const before = raw.servers.length;

  raw.servers = raw.servers.filter(s => s.id !== id);

  if (raw.servers.length === before) {
    throw new Error(`Server "${id}" not found`);
  }

  saveRawConfig(raw);
}

/**
 * Update fields on an existing server
 */
export function setServer(id, updates = {}) {
  const raw = readRawConfig();
  const server = raw.servers.find(s => s.id === id);

  if (!server) {
    throw new Error(`Server "${id}" not found`);
  }

  Object.assign(server, updates);
  saveRawConfig(raw);
}
