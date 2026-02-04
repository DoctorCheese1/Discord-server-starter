import dotenv from 'dotenv';
dotenv.config();

/* ======================================================
   PLATFORM SELECTOR
====================================================== */

const { IDRAC_PLATFORM } = process.env;

if (!IDRAC_PLATFORM) {
  throw new Error('❌ IDRAC_PLATFORM not set (linux | windows)');
}

let backend;

switch (IDRAC_PLATFORM.toLowerCase()) {
  case 'linux':
    backend = await import('./idrac-linux.mjs');
    break;

  case 'windows':
    backend = await import('./idrac-windows.mjs');
    break;

  default:
    throw new Error(`❌ Invalid IDRAC_PLATFORM: ${IDRAC_PLATFORM}`);
}

/* ======================================================
   UNIFIED EXPORT
====================================================== */

export const getIdracStatus = backend.getIdracStatus;
export const idracPower = backend.idracPower;
