import fs from 'fs';
import path from 'path';

export function findExecutables(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(f => f.isFile() && f.name.toLowerCase().endsWith('.exe'))
    .map(f => path.join(dir, f.name));
}
