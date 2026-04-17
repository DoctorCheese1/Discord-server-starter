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

function clearPidFile(server) {
  if (!server?.pidFile) return;
  if (!fs.existsSync(server.pidFile)) return;
  try {
    fs.unlinkSync(server.pidFile);
  } catch {
    // ignore pid cleanup errors
  }
}


function hasProcessFallback(server) {
  return Boolean(server?.processName);
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

  // Remove stale PID so status checks do not read old process IDs.
  clearPidFile(server);

  // Launch exactly like the original/manual flow to preserve compatibility
  // with custom start scripts.
  await execWindows(`cmd /c start "" "${server.startBat}"`);
}

export async function stopServer(server) {
  const pid = getPid(server);
  if (pid) {
    try {
      await execWindows(`taskkill /PID ${pid} /F`);
      clearPidFile(server);
      return true;
    } catch {
      // fall through to process-name fallback
    }
  }

  if (hasProcessFallback(server)) {
    try {
      await execWindows(`taskkill /IM "${server.processName}" /F`);
      clearPidFile(server);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

export async function isRunning(server, { allowProcessFallback = true } = {}) {
  const pid = getPid(server);
  if (pid) {
    try {
      const { stdout } = await execWindows(
        `tasklist /FI "PID eq ${pid}"`
      );
      const running = stdout.includes(pid);
      if (!running) clearPidFile(server);
      return running;
    } catch {
      // fall through to process-name fallback
    }
  }

  if (allowProcessFallback && hasProcessFallback(server)) {
    try {
      const { stdout } = await execWindows(
        `tasklist /FI "IMAGENAME eq ${server.processName}"`
      );
      return stdout.toLowerCase().includes(server.processName.toLowerCase());
    } catch {
      return false;
    }
  }

  return false;
}

/* ======================================================
   UPDATE TASKS (TASK SCHEDULER)
====================================================== */

export async function runUpdateTask(server) {
  if (!server?.updateBat) {
    throw new Error('Server has no updateBat defined');
  }

  const taskName = `ServerStarter_Update_${sanitizeTaskName(server.id || server.name || 'server')}`;

  if (!fs.existsSync(server.updateBat)) {
    throw new Error(`update.bat not found at ${server.updateBat}`);
  }

  // Create/replace one-shot task and execute immediately.
  await execWindows(
    `schtasks /Create /TN "${taskName}" /TR "cmd /c \"\"${server.updateBat}\"\"" /SC ONCE /ST 00:00 /F`
  );

  await execWindows(`schtasks /Run /TN "${taskName}"`);

  return taskName;
}

export async function ensureUpdateTask(server) {
  if (!server?.updateBat) {
    throw new Error('Server has no updateBat defined');
  }

  const taskName = `ServerStarter_Update_${sanitizeTaskName(server.id || server.name || 'server')}`;

  if (!fs.existsSync(server.updateBat)) {
    throw new Error(`update.bat not found at ${server.updateBat}`);
  }

  try {
    await execWindows(`schtasks /Query /TN "${taskName}"`);
    return taskName;
  } catch {
    await execWindows(
      `schtasks /Create /TN "${taskName}" /TR "cmd /c \"\"${server.updateBat}\"\"" /SC ONCE /ST 00:00 /F`
    );
    return taskName;
  }
}

export async function ensureInstalledUpdateTasks(servers = []) {
  const results = [];

  for (const server of servers) {
    if (!server?.updateBat || !fs.existsSync(server.updateBat)) {
      results.push({ id: server?.id, status: 'skipped', reason: 'update.bat missing' });
      continue;
    }

    try {
      const taskName = await ensureUpdateTask(server);
      results.push({ id: server.id, status: 'synced', taskName });
    } catch (error) {
      results.push({ id: server.id, status: 'failed', reason: error?.message || 'error' });
    }
  }

  return results;
}
