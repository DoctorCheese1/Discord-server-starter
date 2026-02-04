import fs from 'fs';
import { isRunning } from './processManager.mjs';

export function getServerState(server) {
  if (server.enabled === false) {
    return {
      emoji: '⚫',
      label: 'Disabled',
      color: 0x2f3136
    };
  }

  // 🟡 Updating (optional but recommended)
  const updatePidFile =
    server.updateBat?.replace('update.bat', 'update.pid');

  if (updatePidFile && fs.existsSync(updatePidFile)) {
    const pid = fs.readFileSync(updatePidFile, 'utf8').trim();
    if (pid) {
      return {
        emoji: '🟡',
        label: 'Updating',
        color: 0xf1c40f
      };
    }
  }

  // 🟢 Running
  if (isRunning(server)) {
    return {
      emoji: '🟢',
      label: 'Running',
      color: 0x2ecc71
    };
  }

  // 🔴 Stopped
  return {
    emoji: '🔴',
    label: 'Stopped',
    color: 0xe74c3c
  };
}
