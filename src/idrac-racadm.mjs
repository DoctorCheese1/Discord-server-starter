import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';

/* ======================================================
   LOAD .env
====================================================== */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/* ======================================================
   ENV
====================================================== */

const {
  RACADM_PATH,   // Windows only
  IDRAC_HOST,
  IDRAC_USER,
  IDRAC_PASS    // Windows only
} = process.env;

if (!IDRAC_HOST) throw new Error('❌ IDRAC_HOST missing');
if (!IDRAC_USER) throw new Error('❌ IDRAC_USER missing');

const isWindows = process.platform === 'win32';

console.log(`🧩 iDRAC mode: ${isWindows ? 'Windows (local racadm)' : 'Linux (SSH racadm)'}`);
console.log('🧩 iDRAC host:', IDRAC_HOST);

/* ======================================================
   EXEC HELPERS
====================================================== */

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/* ======================================================
   RUN RACADM (AUTO MODE)
====================================================== */

async function runRacadm(args) {
  if (isWindows) {
    if (!RACADM_PATH) throw new Error('❌ RACADM_PATH missing (Windows)');
    if (!IDRAC_PASS) throw new Error('❌ IDRAC_PASS missing (Windows)');

    return execFileAsync(
      RACADM_PATH,
      ['-r', IDRAC_HOST, '-u', IDRAC_USER, '-p', IDRAC_PASS, ...args.split(' ')],
      { windowsHide: true, timeout: 15000 }
    );
  }

  // Linux / Raspberry Pi → SSH into iDRAC
  return execAsync(
    `ssh ${IDRAC_USER}@${IDRAC_HOST} racadm ${args}`,
    { timeout: 15000 }
  );
}

/* ======================================================
   STATUS
====================================================== */

export async function getIdracStatus() {
  const { stdout } = await runRacadm('serveraction powerstatus');

  const match = stdout.match(/power status:\s*(\w+)/i);

  return {
    power: match ? match[1].toUpperCase() : 'UNKNOWN',
    raw: stdout.trim()
  };
}

/* ======================================================
   POWER CONTROL
====================================================== */

export async function idracPower(action) {
  const map = {
    on: 'powerup',
    off: 'powerdown',
    reboot: 'powercycle'
  };

  if (!map[action]) {
    throw new Error(`❌ Invalid iDRAC action: ${action}`);
  }

  await runRacadm(`serveraction ${map[action]}`);
}
