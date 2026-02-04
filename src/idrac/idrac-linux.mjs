import dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';

dotenv.config();

const execAsync = promisify(exec);

/* ======================================================
   ENV VALIDATION
====================================================== */

const {
  IDRAC_HOST,
  IDRAC_USER,
  IDRAC_PASS
} = process.env;

if (!IDRAC_HOST || !IDRAC_USER || !IDRAC_PASS) {
  throw new Error('❌ Missing iDRAC env vars for linux backend');
}

console.log('🧩 iDRAC backend: LINUX (SSH)');

/* ======================================================
   SSH RACADM EXEC
====================================================== */

async function runRacadm(args) {
  const cmd = [
    'sshpass',
    `-p "${IDRAC_PASS}"`,
    'ssh',
    '-o StrictHostKeyChecking=no',
    `${IDRAC_USER}@${IDRAC_HOST}`,
    `"racadm ${args.join(' ')}"`
  ].join(' ');

  const { stdout } = await execAsync(cmd);
  return stdout.trim();
}

/* ======================================================
   STATUS
====================================================== */

export async function getIdracStatus() {
  const out = await runRacadm(['serveraction', 'powerstatus']);

  const match = out.match(/power status:\s*(\w+)/i);
    let state = 'unknown';

  if (power === 'ON') state = 'online';
  if (power === 'OFF') state = 'offline';

  return {
    power: match ? match[1].toUpperCase() : 'UNKNOWN',
    state,
    raw: out
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

  await runRacadm(['serveraction', map[action]]);
}
