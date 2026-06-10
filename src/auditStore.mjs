import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const AUDIT_FILE = path.join(ROOT, 'data', 'audit.jsonl');
const MAX_READ_LINES = 500;

export function appendAuditEntry(entry) {
  const normalized = {
    at: entry.at || new Date().toISOString(),
    user: entry.user || 'unknown',
    userId: entry.userId || '',
    action: entry.action || 'unknown',
    status: entry.status || 'ok',
    details: entry.details || ''
  };

  fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
  fs.appendFileSync(AUDIT_FILE, `${JSON.stringify(normalized)}\n`, 'utf8');
  return normalized;
}

export function readRecentAuditEntries(limit = 20) {
  if (!fs.existsSync(AUDIT_FILE)) return [];

  const raw = fs.readFileSync(AUDIT_FILE, 'utf8').trim();
  if (!raw) return [];

  return raw
    .split(/\r?\n/)
    .slice(-MAX_READ_LINES)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse()
    .slice(0, limit);
}

export { AUDIT_FILE };
