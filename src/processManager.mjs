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

function sanitizeTaskName(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
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

/* ======================================================
   UPDATE TASKS (TASK SCHEDULER)
====================================================== */

export async function runUpdateTask(server) {
  if (!server?.updateBat) {
    throw new Error('Server has no updateBat defined');
  }

  const taskName = `ServerStarter_Update_${sanitizeTaskName(server.id || server.name || 'server')}`;

  // Create/replace one-shot task and execute immediately.
  await execWindows(
    `schtasks /Create /TN "${taskName}" /TR "\"${server.updateBat}\"" /SC ONCE /ST 00:00 /F`
  );

  await execWindows(`schtasks /Run /TN "${taskName}"`);

  return taskName;
}
