import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILE = path.join(__dirname, 'steam-games.json');

/* ---------- helpers ---------- */
function load() {
  if (!fs.existsSync(FILE)) return { version: 1, games: [] };
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}
function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

/* ---------- public ---------- */
export function listSteamGames() {
  return load().games;
}

export function addSteamGame({ name, appid }) {
  const data = load();
  if (data.games.some(g => g.appid === Number(appid))) {
    throw new Error('Game already exists');
  }
  data.games.push({ name, appid: Number(appid) });
  save(data);
}

export function removeSteamGame(appid) {
  const data = load();
  const before = data.games.length;
  data.games = data.games.filter(g => g.appid !== Number(appid));
  if (before === data.games.length) {
    throw new Error('Game not found');
  }
  save(data);
}

export function steamGameChoices() {
  return listSteamGames()
    .slice(0, 25)
    .map(g => ({ name: g.name, value: g.appid }));
}
