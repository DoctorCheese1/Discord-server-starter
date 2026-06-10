import fs from 'fs';
import path from 'path';

export function folderSizeBytes(folder) {
  if (!folder || !fs.existsSync(folder)) return 0;
  let total = 0;

  function walk(current) {
    const stat = fs.statSync(current);
    if (stat.isFile()) {
      total += stat.size;
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(current)) {
      walk(path.join(current, entry));
    }
  }

  walk(folder);
  return total;
}

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
