import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// load .env from project root
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const execAsync = promisify(execFile);

/* ======================================================
   ENV VALIDATION
====================================================== */

const {
  RACADM_PATH,
  IDRAC_HOST,
  IDRAC_USER,
  IDRAC_PASS
} = process.env;

if (!RACADM_PATH || !IDRAC_HOST || !IDRAC_USER || !IDRAC_PASS) {
  throw new Error('❌ Missing iDRAC env vars for windows backend');
}

console.log('🧩 iDRAC backend: WINDOWS (local racadm.exe)');

/* ======================================================
   HELPERS
====================================================== */

function baseArgs() {
  return [
    '-r', IDRAC_HOST,
    '-u', IDRAC_USER,
    '-p', IDRAC_PASS
  ];
}

/* ======================================================
   STATUS
====================================================== */

export async function getIdracStatus() {
  try {
    const { stdout } = await execAsync(
      RACADM_PATH,
      [...baseArgs(), 'serveraction', 'powerstatus'],
      { windowsHide: true, timeout: 8000 }
    );

    const match = stdout.match(/power status:\s*(\w+)/i);
    const power = match ? match[1].toUpperCase() : 'UNKNOWN';

    let state = 'offline';
    if (power === 'ON') state = 'online';

    return {
      power,
      state,
      reachable: true,
      raw: stdout.trim()
    };

  } catch (err) {
    return {
      power: 'UNKNOWN',
      state: 'offline',
      reachable: false,
      error: err.message
    };
  }
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

  await execAsync(
    RACADM_PATH,
    [...baseArgs(), 'serveraction', map[action]],
    { windowsHide: true }
  );
}
