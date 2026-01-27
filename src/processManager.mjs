import { spawn, execSync } from 'child_process';
import fs from 'fs';

function getPid(server) {
  if (!fs.existsSync(server.pidFile)) return null;
  const pid = fs.readFileSync(server.pidFile, 'utf8').trim();
  return pid || null;
}

function isPidRunningWindows(pid) {
  try {
    const output = execSync(`tasklist /FI "PID eq ${pid}"`, {
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString();

    return output.includes(pid);
  } catch {
    return false;
  }
}

export function startServer(server) {
  spawn('cmd.exe', ['/c', server.startBat], {
    cwd: server.cwd,
    detached: true,
    stdio: 'ignore'
  }).unref();
}

export function stopServer(server) {
  const pid = getPid(server);
  if (!pid) return false;

  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function isRunning(server) {
  const pid = getPid(server);
  if (!pid) return false;
  return isPidRunningWindows(pid);
}
