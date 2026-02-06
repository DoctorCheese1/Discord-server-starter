import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);

const { IDRAC_HOST } = process.env;
const DEFAULT_INTERVAL_MS = 30000;

const state = {
  reachable: true,
  lastCheck: null,
  lastError: null
};

function buildPingCommand(host) {
  if (process.platform === 'win32') {
    return `ping -n 1 -w 1000 ${host}`;
  }

  return `ping -c 1 -W 1 ${host}`;
}

export async function refreshIdracMonitor() {
  if (!IDRAC_HOST) {
    state.reachable = false;
    state.lastCheck = Date.now();
    state.lastError = 'IDRAC_HOST not set';
    return { ...state };
  }

  try {
    await execAsync(buildPingCommand(IDRAC_HOST));
    state.reachable = true;
    state.lastError = null;
  } catch (error) {
    state.reachable = false;
    state.lastError = error?.message || 'Ping failed';
  }

  state.lastCheck = Date.now();
  return { ...state };
}

export function getIdracMonitorState() {
  return { ...state };
}

export function startIdracMonitor({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  refreshIdracMonitor();
  setInterval(() => {
    refreshIdracMonitor();
  }, intervalMs);
}
