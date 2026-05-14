import pidusage from 'pidusage';
import os from 'os';

export function systemStats() {
  return {
    cpu: os.loadavg()[0].toFixed(2),
    ram: ((1 - os.freemem() / os.totalmem()) * 100).toFixed(1)
  };
}

export function processStats(pid) {
  return pidusage(pid);
}
