import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILE = path.join(__dirname, 'steam-games.json');

function readStore() {
  const raw = fs.existsSync(FILE)
    ? JSON.parse(fs.readFileSync(FILE, 'utf8'))
    : { version: 1, games: [] };

  if (!Array.isArray(raw.games)) raw.games = [];
  return raw;
}

function writeStore(raw) {
  fs.writeFileSync(FILE, JSON.stringify(raw, null, 2));
}

export function listSteamGames() {
  return readStore().games
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function steamGameChoices() {
  return listSteamGames()
    .slice(0, 25)
    .map(g => ({ name: `${g.name} (${g.appid})`, value: Number(g.appid) }));
}

export function addSteamGame(game) {
  const raw = readStore();
  const appid = Number(game.appid);

  if (!Number.isInteger(appid)) {
    throw new Error('Invalid appid');
  }

  if (raw.games.some(g => Number(g.appid) === appid)) {
    throw new Error(`Steam game with appid ${appid} already exists`);
  }

  raw.games.push({ appid, name: String(game.name || appid) });
  writeStore(raw);
}

export function removeSteamGame(appid) {
  const raw = readStore();
  const before = raw.games.length;
  raw.games = raw.games.filter(g => Number(g.appid) !== Number(appid));

  if (raw.games.length === before) {
    throw new Error(`Steam game ${appid} not found`);
  }

  writeStore(raw);
}
