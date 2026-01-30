import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/* ======================================================
   ENV
====================================================== */

const {
  IDRAC_HOST,
  IDRAC_USER
} = process.env;

if (!IDRAC_HOST) {
  throw new Error('❌ IDRAC_HOST is not set in .env');
}
if (!IDRAC_USER) {
  throw new Error('❌ IDRAC_USER is not set in .env');
}

console.log('🧩 iDRAC control via SSH');
console.log('🧩 iDRAC host:', IDRAC_HOST);

/* ======================================================
   HELPER
====================================================== */

async function runRacadm(cmd) {
  return execAsync(
    `ssh ${IDRAC_USER}@${IDRAC_HOST} racadm ${cmd}`,
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
