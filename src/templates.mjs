import fs from 'fs';
import path from 'path';

function writeIfMissing(file, content, overwrite = false) {
  if (!overwrite && fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

export function createServerTemplate(server, type = 'generic', { overwrite = false } = {}) {
  if (!server?.cwd) throw new Error('Server folder is not configured');

  const normalized = String(type || 'generic').toLowerCase();
  const startFile = path.join(server.cwd, 'start.bat');
  const stopFile = path.join(server.cwd, 'stop.bat');
  const updateFile = path.join(server.cwd, 'update.bat');

  let start = '@echo off\r\ncd /d "%~dp0"\r\necho Replace this line with your server start command.\r\npause\r\n';
  let stop = '@echo off\r\necho Replace this with your graceful stop command, or configure processName for taskkill fallback.\r\n';
  let update = '@echo off\r\ncd /d "%~dp0"\r\necho Add your update command here.\r\n';

  if (normalized === 'minecraft' || normalized === 'proxy') {
    start = '@echo off\r\ncd /d "%~dp0"\r\njava -Xms1G -Xmx2G -jar server.jar nogui\r\n';
    stop = '@echo off\r\ntaskkill /IM java.exe /F\r\n';
  }

  if (normalized === 'steam') {
    start = '@echo off\r\ncd /d "%~dp0"\r\necho Replace with your Steam dedicated server executable and arguments.\r\n';
    stop = '@echo off\r\necho Replace with taskkill /IM YourServer.exe /F or graceful shutdown.\r\n';
    update = '@echo off\r\ncd /d "%~dp0"\r\necho Replace with steamcmd +login anonymous +app_update APPID validate +quit\r\n';
  }

  return {
    startBat: writeIfMissing(startFile, start, overwrite),
    stopBat: writeIfMissing(stopFile, stop, overwrite),
    updateBat: writeIfMissing(updateFile, update, overwrite)
  };
}
