import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const BACKUP_ROOT = path.join(ROOT, 'data', 'backups');
const DEFAULT_EXCLUDES = new Set(['server.pid', 'update.pid']);

function safeName(value) {
  return String(value || 'backup').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function copyRecursive(source, target, options = {}) {
  const excludeNames = options.excludeNames || DEFAULT_EXCLUDES;
  const stat = fs.statSync(source);

  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (excludeNames.has(entry.name)) continue;
      copyRecursive(path.join(source, entry.name), path.join(target, entry.name), options);
    }
    return;
  }

  if (!stat.isFile()) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function removeContents(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

export function createBackup(server, label = '') {
  if (!server?.cwd || !fs.existsSync(server.cwd)) {
    throw new Error('Server folder does not exist');
  }

  const name = `${timestampName()}${label ? `-${safeName(label)}` : ''}`;
  const backupDir = path.join(BACKUP_ROOT, safeName(server.id), name);
  copyRecursive(server.cwd, backupDir);

  const manifest = {
    serverId: server.id,
    serverName: server.name,
    source: server.cwd,
    createdAt: new Date().toISOString(),
    name
  };
  fs.writeFileSync(path.join(backupDir, 'backup-manifest.json'), JSON.stringify(manifest, null, 2));
  return { name, path: backupDir, manifest };
}

export function listBackups(serverId) {
  const dir = path.join(BACKUP_ROOT, safeName(serverId));
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const fullPath = path.join(dir, entry.name);
      const manifestPath = path.join(fullPath, 'backup-manifest.json');
      let manifest = {};
      if (fs.existsSync(manifestPath)) {
        try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {}
      }
      return { name: entry.name, path: fullPath, createdAt: manifest.createdAt || fs.statSync(fullPath).mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function restoreBackup(server, backupName) {
  const backup = listBackups(server.id).find(entry => entry.name === backupName);
  if (!backup) throw new Error('Backup not found');
  if (!server?.cwd) throw new Error('Server folder is not configured');

  fs.mkdirSync(server.cwd, { recursive: true });
  removeContents(server.cwd);
  copyRecursive(backup.path, server.cwd, { excludeNames: new Set(['backup-manifest.json']) });
  return backup;
}

export { BACKUP_ROOT };
