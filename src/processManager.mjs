import fs from 'fs';
import path from 'path';
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

function hasPidFile(server) {
  return Boolean(server?.pidFile && fs.existsSync(server.pidFile));
}

function writePid(server, pid) {
  if (!server?.pidFile || !pid) return;
  fs.mkdirSync(path.dirname(server.pidFile), { recursive: true });
  fs.writeFileSync(server.pidFile, String(pid));
}

function removePid(server) {
  if (!hasPidFile(server)) return;
  fs.rmSync(server.pidFile, { force: true });
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

  if (!fs.existsSync(server.startBat)) {
    throw new Error(`start.bat not found: ${server.startBat}`);
  }

  const escapedStartBat = server.startBat.replace(/'/g, "''");

  const { stdout } = await execWindows(
    `powershell -NoProfile -Command "$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','\"${escapedStartBat}\"' -WorkingDirectory '${server.cwd}' -PassThru; $p.Id"`
  );

  const pid = String(stdout || '').trim();
  if (!pid) {
    throw new Error('Unable to capture process PID from start.bat launch');
  }

  writePid(server, pid);

  return pid;
}

export async function stopServer(server) {
  let stopExecuted = false;

  if (server.stopBat && fs.existsSync(server.stopBat)) {
    await execWindows(`cmd /c "${server.stopBat}"`);
    stopExecuted = true;
  }

  const pid = getPid(server);
  if (!pid) {
    return stopExecuted;
  }

  try {
    await execWindows(`taskkill /PID ${pid} /F`);
    removePid(server);
    return true;
  } catch {
    return stopExecuted;
  }
}

export async function isRunning(server) {
  const pid = getPid(server);
  if (!pid && !server.processName) return false;

  if (pid) {
    try {
      const { stdout } = await execWindows(
        `tasklist /FI "PID eq ${pid}"`
      );
      if (stdout.includes(pid)) return true;
      removePid(server);
    } catch {
      return false;
    }
  }

  if (server.processName) {
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

function buildTaskRunCommand(updateBat) {
  return `cmd /c \"${updateBat}\"`;
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
    throw new Error(`update.bat not found: ${server.updateBat}`);
  }

  // Create/replace one-shot task and execute immediately.
  await execWindows(
    `schtasks /Create /TN "${taskName}" /TR "${buildTaskRunCommand(server.updateBat)}" /SC ONCE /ST 00:00 /F`
  );

  await execWindows(`schtasks /Run /TN "${taskName}"`);

  return taskName;
}

export async function ensureUpdateTask(server) {
  if (!server?.updateBat) {
    throw new Error('Server has no updateBat defined');
  }

  if (!fs.existsSync(server.updateBat)) {
    throw new Error(`update.bat not found: ${server.updateBat}`);
  }

  const taskName = `ServerStarter_Update_${sanitizeTaskName(server.id || server.name || 'server')}`;

  try {
    await execWindows(`schtasks /Query /TN "${taskName}"`);
    return taskName;
  } catch {
    await execWindows(
      `schtasks /Create /TN "${taskName}" /TR "${buildTaskRunCommand(server.updateBat)}" /SC ONCE /ST 00:00 /F`
    );
    return taskName;
  }
}


export async function ensureUpdateTasksForServers(servers = []) {
  const result = {
    synced: [],
    skipped: [],
    failed: []
  };

  for (const server of servers) {
    if (!server?.updateBat || !fs.existsSync(server.updateBat)) {
      result.skipped.push({ id: server?.id, reason: 'no update.bat' });
      continue;
    }

    try {
      const taskName = await ensureUpdateTask(server);
      result.synced.push({ id: server.id, taskName });
    } catch (error) {
      result.failed.push({
        id: server?.id,
        reason: error?.message || 'failed'
      });
    }
  }

  return result;
}
