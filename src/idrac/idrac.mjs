import dotenv from 'dotenv';
dotenv.config();

/* ======================================================
   PLATFORM SELECTOR
====================================================== */

const { IDRAC_PLATFORM } = process.env;

let backend = {
  async getIdracStatus() {
    return {
      power: 'UNKNOWN',
      state: 'offline',
      reachable: false,
      error: 'IDRAC_PLATFORM not set (linux | windows)'
    };
  },
  async idracPower() {
    throw new Error('IDRAC backend unavailable: set IDRAC_PLATFORM (linux | windows)');
  }
};

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
    backend = {
      async getIdracStatus() {
        return {
          power: 'UNKNOWN',
          state: 'offline',
          reachable: false,
          error: error?.message || 'iDRAC backend load failed'
        };
      },
      async idracPower() {
        throw new Error(error?.message || 'iDRAC backend load failed');
      }
    };
  }
}

/* ======================================================
   UNIFIED EXPORT
====================================================== */

export const getIdracStatus = backend.getIdracStatus;
export const idracPower = backend.idracPower;
