import fs from 'fs';

export function log(message) {
  fs.appendFileSync('./data/logs.txt', `[${new Date().toISOString()}] ${message}\n`);
}
