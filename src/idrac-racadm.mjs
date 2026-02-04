// import dotenv from 'dotenv';
// import path from 'path';
// import { fileURLToPath } from 'url';
// import { execFile } from 'child_process';
// import { promisify } from 'util';

// /* ======================================================
//    LOAD .env (guaranteed)
// ====================================================== */

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// // Load .env from project root
// dotenv.config({ path: path.join(__dirname, '..', '.env') });

// /* ======================================================
//    ENV VALIDATION
// ====================================================== */

// const {
//   RACADM_PATH,
//   IDRAC_HOST,
//   IDRAC_USER,
//   IDRAC_PASS
// } = process.env;

// if (!RACADM_PATH) {
//   throw new Error('❌ RACADM_PATH is not set in .env');
// }
// if (!IDRAC_HOST) {
//   throw new Error('❌ IDRAC_HOST is not set in .env');
// }
// if (!IDRAC_USER) {
//   throw new Error('❌ IDRAC_USER is not set in .env');
// }
// if (!IDRAC_PASS) {
//   throw new Error('❌ IDRAC_PASS is not set in .env');
// }

// console.log('🧩 iDRAC enabled via racadm');
// console.log('🧩 racadm path:', RACADM_PATH);
// console.log('🧩 iDRAC host:', IDRAC_HOST);

// /* ======================================================
//    EXEC HELPER
// ====================================================== */

// const exec = promisify(execFile);

// function baseArgs() {
//   return [
//     '-r', IDRAC_HOST,
//     '-u', IDRAC_USER,
//     '-p', IDRAC_PASS
//   ];
// }

// /* ======================================================
//    STATUS
// ====================================================== */

// export async function getIdracStatus() {
//   const { stdout } = await exec(
//     RACADM_PATH,
//     [...baseArgs(), 'serveraction', 'powerstatus'],
//     { windowsHide: true }
//   );

//   // Example output:
//   // "Server power status: ON"
//   const match = stdout.match(/power status:\s*(\w+)/i);

//   return {
//     power: match ? match[1].toUpperCase() : 'UNKNOWN',
//     raw: stdout.trim()
//   };
// }

// /* ======================================================
//    POWER CONTROL
// ====================================================== */

// export async function idracPower(action) {
//   const map = {
//     on: 'powerup',
//     off: 'powerdown',
//     reboot: 'powercycle'
//   };

//   if (!map[action]) {
//     throw new Error(`❌ Invalid iDRAC action: ${action}`);
//   }

//   await exec(
//     RACADM_PATH,
//     [...baseArgs(), 'serveraction', map[action]],
//     { windowsHide: true }
//   );
// }
