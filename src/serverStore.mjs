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
   Raw access (DEPLOY SAFE)
================================ */

export function loadRawConfig() {
  if (!fs.existsSync(FILE)) {
    console.warn('⚠️ servers.json not found at:', FILE);
    return { servers: [] };
  }

  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

export function saveRawConfig(raw) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(raw, null, 2));
}

/* ===============================
   MUTATION HELPERS (NEW)
================================ */

export function addServer(server) {
  const raw = loadRawConfig();

  if (raw.servers.some(s => s.id === server.id)) {
    throw new Error(`Server with id "${server.id}" already exists`);
  }

  raw.servers.push(server);
  saveRawConfig(raw);
}

export function removeServer(idOrName) {
  const raw = loadRawConfig();
  const before = raw.servers.length;

  raw.servers = raw.servers.filter(
    s => s.id !== idOrName && s.name !== idOrName
  );

  if (raw.servers.length === before) {
    throw new Error(`Server "${idOrName}" not found`);
  }

  saveRawConfig(raw);
}

export function setServer(idOrName, patch) {
  const raw = loadRawConfig();
  const server = raw.servers.find(
    s => s.id === idOrName || s.name === idOrName
  );

  if (!server) {
    throw new Error(`Server "${idOrName}" not found`);
  }

  Object.assign(server, patch);
  saveRawConfig(raw);
}

/* ===============================
   Slash command choices
================================ */

export function serverChoices({ steamOnly = false } = {}) {
  const raw = loadRawConfig();

  return (raw.servers || [])
    .filter(s => s.enabled !== false)
    .filter(s =>
      !steamOnly ||
      s.steam === true ||
      s.type === 'steam'
    )
    .map(s => ({
      name: s.name,
      value: s.id ?? s.name
    }))
    .slice(0, 25); // Discord hard limit
}

/* ===============================
   Runtime normalization
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
   Runtime access
================================ */

export function loadServers({ includeDisabled = false } = {}) {
  const raw = loadRawConfig();
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
