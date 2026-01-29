import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deployCommands, getCommandSignature } from './deploy-commands.mjs';

/* ================= PATHS ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env') });

const DATA_DIR = path.join(ROOT, 'data'); // ✅ unified folder
const HASH_FILE = path.join(DATA_DIR, 'commands.hash');

/* ================= HASH ================= */
function readHash() {
  try {
    if (!fs.existsSync(HASH_FILE)) return null;
    return fs.readFileSync(HASH_FILE, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function writeHash(hash) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HASH_FILE, hash, 'utf8');
}

/* ================= AUTO DEPLOY ================= */
export async function autoDeployIfEnabled() {
  const enabled =
    String(process.env.AUTO_DEPLOY || '').toLowerCase() === 'true';

  if (!enabled) {
    console.log('🟦 AUTO_DEPLOY=false (skipping slash command deploy)');
    return;
  }

  const current = getCommandSignature();
  const previous = readHash();

  // ✅ If hash is missing, force deploy
  if (!previous) {
    console.log('🟨 No command hash found — deploying commands...');
  } else if (current === previous) {
    console.log('🟩 Slash commands unchanged (auto-deploy skipped)');
    return;
  } else {
    console.log('🟨 Slash commands changed — deploying now...');
  }

  try {
    await deployCommands();
    writeHash(current);
    console.log('🟩 Auto-deploy complete (signature written)');
  } catch (err) {
    console.error('❌ Auto-deploy failed:', err);
    // ❗ Intentionally do NOT write hash on failure
    throw err;
  }
}
