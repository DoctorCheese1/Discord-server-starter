import dotenv from 'dotenv';
dotenv.config();

/* ======================================================
   PLATFORM SELECTOR
====================================================== */

const { IDRAC_PLATFORM } = process.env;

let backend;

if (IDRAC_PLATFORM) {
  try {
    switch (IDRAC_PLATFORM.toLowerCase()) {
      case 'linux':
        backend = await import('./idrac-linux.mjs');
        break;

      case 'windows':
        backend = await import('./idrac-windows.mjs');
        break;

      default:
        throw new Error(`Invalid IDRAC_PLATFORM: ${IDRAC_PLATFORM}`);
    }
  } catch (error) {
    console.error(`❌ iDRAC backend init failed: ${error.message}`);
  }
}

if (!backend) {
  console.warn('⚠ iDRAC backend disabled. Set IDRAC_PLATFORM + backend env vars to enable it.');

  backend = {
    async getIdracStatus() {
      return {
        power: 'UNKNOWN',
        state: 'offline',
        reachable: false,
        error: 'iDRAC backend not configured'
      };
    },
    async idracPower() {
      throw new Error('iDRAC backend not configured');
    }
  };
}

/* ======================================================
   UNIFIED EXPORT
====================================================== */

export const getIdracStatus = backend.getIdracStatus;
export const idracPower = backend.idracPower;
