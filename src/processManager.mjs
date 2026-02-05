import fs from 'fs';
import { execWindows } from './windows-exec.mjs';

/* ======================================================
   PID HELPERS
   (PID FILE MUST BE ON A SHARED PATH, e.g. CIFS)
====================================================== */

function getPid(server) {
  if (!server.pidFile) return null;
  if (!fs.existsSync(server.pidFile)) return null;

  const pid = fs.readFileSync(server.pidFile, 'utf8').trim();
  return pid || null;
}

/* ======================================================
   START / STOP / STATUS
   (ALL EXECUTED ON WINDOWS)
====================================================== */

export async function startServer(server) {
  if (!server.startBat) {
    throw new Error('Server has no startBat defined');
  }

  // Run on Windows, not Linux
  await execWindows(`cmd /c start "" "${server.startBat}"`);
}

export async function stopServer(server) {
  const pid = getPid(server);
  if (!pid) return false;

  try {
    await execWindows(`taskkill /PID ${pid} /F`);
    return true;
  } catch {
    return false;
  }
}

export async function isRunning(server) {
  const pid = getPid(server);
  if (!pid) return false;

  try {
    const { stdout } = await execWindows(
      `tasklist /FI "PID eq ${pid}"`
    );
    return stdout.includes(pid);
  } catch {
    return false;
  }
}
