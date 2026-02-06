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

/* ===============================
   RAW ACCESS
================================ */

export function loadRawConfig() {
  if (!fs.existsSync(FILE)) {
    return { servers: [] };
  }

  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { servers: [] };
  }
}

export function saveRawConfig(raw) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(raw, null, 2));
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
  let raw;

  try {
    raw = loadRawConfig();
  } catch {
    raw = { servers: [] };
  }

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
export function serverChoices({ steamOnly = false } = {}) {
  const raw = loadRawConfig();

  return (raw.servers || [])
    .filter(s => s.enabled !== false)
    .filter(s => !steamOnly || s.steam === true || s.type === 'steam')
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
  const raw = loadRawConfig();

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
    appid: server.appid
  });

  saveRawConfig(raw);
}

/**
 * Remove a server from servers.json
 */
export function removeServer(id) {
  const raw = loadRawConfig();
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
  const raw = loadRawConfig();
  const server = raw.servers.find(s => s.id === id);

  if (!server) {
    throw new Error(`Server "${id}" not found`);
  }

  Object.assign(server, updates);
  saveRawConfig(raw);
}
