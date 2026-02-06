import fs from 'fs';
import path from 'path';
import { execWindows } from './windows-exec.mjs';

/* ======================================================
   PID HELPERS
====================================================== */

function getPid(server) {
  if (!server.pidFile) return null;
  if (!fs.existsSync(server.pidFile)) return null;

  const pid = fs.readFileSync(server.pidFile, 'utf8').trim();
  return pid || null;
}

function savePid(server, pid) {
  if (!server?.pidFile || !pid) return;

  try {
    fs.mkdirSync(path.dirname(server.pidFile), { recursive: true });
    fs.writeFileSync(server.pidFile, String(pid));
  } catch {
    // ignore pid persistence errors
  }
}

function sanitizeTaskName(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function parseWmicCsv(stdout) {
  const rows = stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => line.includes(','));

  if (!rows.length) return [];

  const header = rows[0].toLowerCase();
  const cmdIndex = header.split(',').findIndex(v => v === 'commandline');
  const pidIndex = header.split(',').findIndex(v => v === 'processid');

  if (cmdIndex < 0 || pidIndex < 0) return [];

  return rows.slice(1).map(line => {
    const parts = line.split(',');
    return {
      commandLine: (parts[cmdIndex] || '').toLowerCase(),
      pid: (parts[pidIndex] || '').trim()
    };
  });
}

function getJarTokenFromStartBat(server) {
  if (!server?.startBat || !fs.existsSync(server.startBat)) return null;

  try {
    const script = fs.readFileSync(server.startBat, 'utf8');
    const m = script.match(/-jar\s+"?([^"\r\n\s]+\.jar)"?/i);
    if (!m?.[1]) return null;
    return path.basename(m[1]).toLowerCase();
  } catch {
    return null;
  }
}

function getJavaMatchTokens(server) {
  const tokens = [];
  const jarToken = getJarTokenFromStartBat(server);
  if (jarToken) tokens.push(jarToken.toLowerCase());

  if (server?.cwd) {
    try {
      tokens.push(path.resolve(server.cwd).toLowerCase());
    } catch {
      // ignore bad cwd
    }
  }

  if (server?.startBat) {
    try {
      tokens.push(path.dirname(server.startBat).toLowerCase());
    } catch {
      // ignore bad startBat
    }
  }

  return tokens.filter(Boolean);
}

function findProcessByTokens(rows, tokens) {
  if (!rows?.length || !tokens?.length) return null;
  return rows.find(r => tokens.some(token => r.commandLine.includes(token)));
}

async function findJavaPid(server) {
  const tokens = getJavaMatchTokens(server);
  if (!tokens.length) return null;

  try {
    const { stdout } = await execWindows(
      'wmic process where "name=\'java.exe\' or name=\'javaw.exe\'" get CommandLine,ProcessId /format:csv'
    );

    const rows = parseWmicCsv(stdout);
    const hit = findProcessByTokens(rows, tokens);
    return hit?.pid || null;
  } catch {
    // continue to powershell fallback
  }

  try {
    const { stdout } = await execWindows(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'java.exe\' or Name=\'javaw.exe\'\\" | Select-Object CommandLine,ProcessId | ConvertTo-Csv -NoTypeInformation"'
    );

    const rows = parseWmicCsv(stdout);
    const hit = findProcessByTokens(rows, tokens);
    return hit?.pid || null;
  } catch {
    return null;
  }
}

/* ======================================================
   START / STOP / STATUS
====================================================== */

export async function startServer(server) {
  if (!server.startBat) {
    throw new Error('Server has no startBat defined');
  }

  await execWindows(`cmd /c start "" "${server.startBat}"`);
}

export async function stopServer(server) {
  const pid = getPid(server);
  if (pid) {
    try {
      await execWindows(`taskkill /PID ${pid} /F`);
      return true;
    } catch {
      // fall through to other stop methods
    }
  }

  if (server?.java) {
    const javaPid = await findJavaPid(server);
    if (javaPid) {
      try {
        await execWindows(`taskkill /PID ${javaPid} /F`);
        return true;
      } catch {
        return false;
      }
    }
  }

  if (server?.processName) {
    try {
      await execWindows(`taskkill /IM "${server.processName}" /F`);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

export async function isRunning(server) {
  const pid = getPid(server);
  if (pid) {
    try {
      const { stdout } = await execWindows(`tasklist /FI "PID eq ${pid}"`);
      if (stdout.includes(pid)) return true;
    } catch {
      // continue to fallbacks
    }
  }

  if (server?.java) {
    const javaPid = await findJavaPid(server);
    if (javaPid) {
      savePid(server, javaPid);
      return true;
    }
  }

  if (server?.processName) {
    try {
      const { stdout } = await execWindows(`tasklist /FI "IMAGENAME eq ${server.processName}"`);
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

  await execWindows(
    `schtasks /Create /TN "${taskName}" /TR "\"${server.updateBat}\"" /SC ONCE /ST 00:00 /F`
  );

  await execWindows(`schtasks /Run /TN "${taskName}"`);

  return taskName;
}

export async function ensureUpdateTask(server) {
  if (!server?.updateBat) {
    return null;
  }

  const taskName = `ServerStarter_Update_${sanitizeTaskName(server.id || server.name || 'server')}`;

  await execWindows(
    `schtasks /Create /TN "${taskName}" /TR "\"${server.updateBat}\"" /SC ONCE /ST 00:00 /F`
  );

  return taskName;
}
