import fs from 'fs';
import pidusage from 'pidusage';
import { ActivityType } from 'discord.js';
import { loadServers } from './serverStore.mjs';
import { isRunning } from './processManager.mjs';

/* ======================================================
   CONFIG
====================================================== */

const UPDATE_INTERVAL_MS = 15000; // 15 seconds (safe)

/* ======================================================
   PRESENCE LOOP
====================================================== */

export function startPresenceLoop(client) {
  let lastText = null;

  async function updatePresence() {
    try {
      const servers = loadServers();
      const total = servers.length;

      if (!total) {
        return setPresence(client, 'idle', 'No servers configured');
      }

      let online = 0;
      let topServer = null;

      for (const s of servers) {
        if (!(await isRunning(s))) continue;

        online++;

        const pidFile = s.pidFile;
        if (!pidFile || !fs.existsSync(pidFile)) continue;

        try {
          const pid = fs.readFileSync(pidFile, 'utf8').trim();
          if (!pid) continue;

          const stats = await pidusage(pid);

          if (!topServer || stats.cpu > topServer.cpu) {
            topServer = {
              name: s.name,
              cpu: stats.cpu,
              ram: stats.memory
            };
          }
        } catch {
          /* ignore pid errors */
        }
      }

let status = 'online';
let text = 'Managing servers';

if (online === 0) {
  status = 'dnd';
  text = `0/${total} servers online`;
} else {
  status = 'online';
  text = `${online}/${total} online`;
}


      if (topServer) {
        const cpu = topServer.cpu.toFixed(1);
        const ram = (topServer.ram / 1024 / 1024).toFixed(1);
        text += ` | ${topServer.name}: ${cpu}% / ${ram}MB`;
      }

      // Prevent duplicate presence spam
      if (text !== lastText) {
        setPresence(client, status, text);
        lastText = text;
      }

    } catch (err) {
      console.error('❌ Presence update failed:', err);
    }
  }

  // Initial + interval
  updatePresence();
  setInterval(updatePresence, UPDATE_INTERVAL_MS);
}

/* ======================================================
   HELPER
====================================================== */

function setPresence(client, status, text) {
  client.user.setPresence({
    status,
    activities: [{
      name: text,
      type: ActivityType.Watching
    }]
  });
}
