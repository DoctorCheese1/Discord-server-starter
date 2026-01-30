import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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

console.log('🧩 iDRAC control: SSH (non-interactive)');
console.log('🧩 iDRAC host:', IDRAC_HOST);
console.log('🧩 iDRAC user:', IDRAC_USER);

/* ======================================================
   INTERNAL HELPER
====================================================== */

async function runRacadm(cmd) {
  return execFileAsync(
    'ssh',
    [
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'ConnectTimeout=5',
      '-T', // disable pseudo-tty (prevents hangs)
      `${IDRAC_USER}@${IDRAC_HOST}`,
      'racadm',
      ...cmd.split(' ')
    ],
    {
      timeout: 8000
    }
  );
}

/* ======================================================
   STATUS
====================================================== */

export async function getIdracStatus() {
  const { stdout } = await runRacadm('serveraction powerstatus');

  // Expected output:
  // "Server power status: ON"
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
