import {
  loadServers,
  getServer,
  removeServer,
  setServer
} from './serverStore.mjs';
import fs from 'fs';
import { EmbedBuilder } from 'discord.js';
import {
  ensureInstalledUpdateTasks,
  ensureUpdateTask,
  isRunning,
  runUpdateTask,
  startServer,
  stopServer
} from './processManager.mjs';

import {
  listSteamGames,
  addSteamGame,
  removeSteamGame
} from './steam/steamGameStore.mjs';
import path from 'path';

import {
  createSteamServer
} from './steam/steamServerCreator.mjs';

import {
  saveSearch
} from './steam/steamSearchState.mjs';

import {
  buildSearchPage
} from './steam/steamSearchUI.mjs';

import {
  getIdracStatus,
  idracPower
} from './idrac/idrac.mjs';
import {
  getIdracMonitorState,
  refreshIdracMonitor
} from './idrac/idracMonitor.mjs';
import { isIdracOnlyMode } from './mode.mjs';

/* ======================================================
   MAIN HANDLER
====================================================== */
async function getServerState(server) {
  if (server.enabled === false) {
    return { emoji: '⚫', label: 'Disabled', color: 0x2f3136 };
  }

  // 🟡 Updating (update.pid convention)
  const updatePidFile =
    server.updateBat?.replace('update.bat', 'update.pid');

  if (updatePidFile && fs.existsSync(updatePidFile)) {
    try {
      const pid = fs.readFileSync(updatePidFile, 'utf8').trim();
      if (pid) {
        return { emoji: '🟡', label: 'Updating', color: 0xf1c40f };
      }
    } catch {}
  }

  // 🟢 Running
  if (await isRunning(server)) {
    return { emoji: '🟢', label: 'Running', color: 0x2ecc71 };
  }

  // 🔴 Stopped
  return { emoji: '🔴', label: 'Stopped', color: 0xe74c3c };
}



async function requireIdracOnline(interaction, actionLabel = 'run this command') {
  const idracPlatform = process.env.IDRAC_PLATFORM?.toLowerCase();

  // Only enforce iDRAC host gating when running in linux mode.
  // On windows mode, commands can continue without iDRAC checks.
  if (idracPlatform !== 'linux') {
    return null;
  }

  const monitor = await refreshIdracMonitor();

  if (!monitor.reachable) {
    return interaction.editReply(
      `⛔ iDRAC is offline/unreachable. Start iDRAC first before trying to ${actionLabel}.`
    );
  }

  const status = await getIdracStatus();

  if (!status.reachable || status.state !== 'online') {
    return interaction.editReply(
      `⛔ Server host is not online via iDRAC (state: **${status.state || 'unknown'}**). Start it first.`
    );
  }

  return null;
}

function isMutatingConfigSubcommand(sub) {
  return ['enable', 'disable', 'rename', 'set-java', 'set-steam', 'set-process'].includes(sub);
}
export async function handleCommand(interaction) {
  const cmd = interaction.commandName;
  const idracOnly = isIdracOnlyMode();

  if (idracOnly && cmd !== 'idrac') {
    return interaction.editReply('⚙️ This bot is running in iDRAC-only mode. Use `/idrac` commands.');
  }

  /* ======================================================
     BASIC
  ====================================================== */

  if (cmd === 'servers') {
    const sub = interaction.options.getSubcommand(false);

    if (!sub || sub === 'list') {
      const servers = loadServers({ includeDisabled: true });

      const lines = await Promise.all(servers.map(async s => {
        const st = await getServerState(s);
        return `${st.emoji} **${s.name}** (${s.id}) — ${st.label}`;
      }));

      return interaction.editReply(lines.join('\n'));
    }

    if (sub === 'validate') {
      const servers = loadServers({ includeDisabled: true });

      const results = await Promise.all(
        servers.map(async s => {
          if (!s.updateBat) {
            return { id: s.id, status: 'skipped', reason: 'no updateBat' };
          }

          if (!fs.existsSync(s.updateBat)) {
            return { id: s.id, status: 'failed', reason: 'updateBat missing' };
          }

          try {
            const taskName = await ensureUpdateTask(s);
            return { id: s.id, status: 'synced', taskName };
          } catch (error) {
            return { id: s.id, status: 'failed', reason: error?.message || 'error' };
          }
        })
      );

      const synced = results.filter(r => r.status === 'synced').length;
      const skipped = results.filter(r => r.status === 'skipped').length;
      const failed = results.filter(r => r.status === 'failed').length;

      const summary = `✅ Task Scheduler sync complete — ${synced} synced, ${skipped} skipped, ${failed} failed.`;
      const details = results
        .map(r => {
          if (r.status === 'synced') return `🟢 ${r.id} → ${r.taskName}`;
          if (r.status === 'skipped') return `🟡 ${r.id} → skipped (${r.reason})`;
          return `🔴 ${r.id} → failed (${r.reason})`;
        })
        .join('\n');

      return interaction.editReply(`${summary}\n${details}`);
    }
  }

  if (cmd === 'status') {
    const servers = loadServers({ includeDisabled: true });
    return interaction.editReply(
      servers.length
        ? servers.map(s => `• ${s.name}`).join('\n')
        : 'No servers configured.'
    );
  }


  if (cmd === 'webeditor') {
    const enabled = process.env.WEB_EDITOR_ENABLED === 'true';
    const port = process.env.WEB_EDITOR_PORT || '8787';
    const hasKey = Boolean(process.env.WEB_EDITOR_API_KEY);

    if (!enabled) {
      return interaction.editReply(
        '⚠ Web editor is disabled. Set `WEB_EDITOR_ENABLED=true` and restart the bot.'
      );
    }

    return interaction.editReply(
      `🌐 Web editor is enabled.\n` +
      `URL: **http://<host>:${port}/**\n` +
      `API key required: **${hasKey ? 'yes' : 'no'}**`
    );
  }

  if (cmd === 'info') {
    const id = interaction.options.getString('id', true);
    const server = getServer(id, { includeDisabled: true });

    if (!server) {
      return interaction.editReply('❌ Server not found.');
    }

    const st = await getServerState(server);

    const embed = new EmbedBuilder()
      .setTitle(`${st.emoji} ${server.name}`)
      .setColor(st.color)
      .addFields(
        { name: 'Status', value: st.label, inline: true },
        { name: 'ID', value: server.id, inline: true },
        { name: 'Type', value: server.type ?? 'unknown', inline: true },
        { name: 'Path', value: server.cwd ?? 'n/a' }
      );

    return interaction.editReply({ embeds: [embed] });
  }

  /* ======================================================
     START / STOP / RESTART
  ====================================================== */

  if (['start', 'stop', 'restart'].includes(cmd)) {
    const id = interaction.options.getString('id');
    const server = getServer(id);

    if (!server) {
      return interaction.editReply('❌ Server not found.');
    }

    try {
      if (cmd === 'start') {
        await startServer(server);
        return interaction.editReply(`✅ Start triggered for **${server.name}**.`);
      }

      if (cmd === 'stop') {
        const stopped = await stopServer(server);
        if (!stopped) {
          return interaction.editReply('⚠ Stop command sent, but no PID/process match was found.');
        }

        return interaction.editReply(`✅ Stop triggered for **${server.name}**.`);
      }

      const stopped = await stopServer(server);
      if (!stopped) {
        return interaction.editReply('⚠ Restart blocked: could not find running process to stop.');
      }

      await startServer(server);
      return interaction.editReply(`✅ Restart triggered for **${server.name}**.`);
    } catch (error) {
      return interaction.editReply(`❌ ${cmd} failed: ${error?.message || 'unknown error'}`);
    }
  }

  /* ======================================================
     CONFIG
  ====================================================== */

  if (cmd === 'config') {
    const sub = interaction.options.getSubcommand();

    if (isMutatingConfigSubcommand(sub)) {
      const gateReply = await requireIdracOnline(interaction, `modify server config (${sub})`);
      if (gateReply) return gateReply;
    }

    if (sub === 'list') {
      const all = interaction.options.getBoolean('all') === true;
      const type = interaction.options.getString('type');

      let servers = loadServers({ includeDisabled: all });

      if (type) {
        servers = servers.filter(s => s.type === type);
      }

      if (!servers.length) {
        return interaction.editReply('❌ No servers found.');
      }

      const lines = await Promise.all(servers.map(async s => {
        const st = await getServerState(s);
        return `${st.emoji} **${s.name}** (${s.id}) — ${st.label}`;
      }));

      return interaction.editReply(lines.join('\n'));
    }

    if (sub === 'validate') {
      const servers = loadServers({ includeDisabled: true });
      const results = await ensureInstalledUpdateTasks(servers);
      const synced = results.filter(r => r.status === 'synced').length;
      const skipped = results.filter(r => r.status === 'skipped').length;
      const failed = results.filter(r => r.status === 'failed').length;

      const details = results
        .map(r => {
          if (r.status === 'synced') return `🟢 ${r.id} → ${r.taskName}`;
          if (r.status === 'skipped') return `🟡 ${r.id} → skipped (${r.reason})`;
          return `🔴 ${r.id} → failed (${r.reason})`;
        })
        .join('\n');

      return interaction.editReply(
        `✅ Config checked (${servers.length} servers)\nTask Scheduler: ${synced} synced, ${skipped} skipped, ${failed} failed.\n${details}`
      );
    }
    if (sub === 'enable' || sub === 'disable') {
      const id = interaction.options.getString('id');
      setServer(id, { enabled: sub === 'enable' });
      return interaction.editReply(`✅ Server **${id}** updated.`);
    }

    if (sub === 'rename') {
      const id = interaction.options.getString('id');
      const name = interaction.options.getString('name');
      setServer(id, { name });
      return interaction.editReply(`✅ Server renamed to **${name}**.`);
    }

    if (sub === 'set-java') {
      const id = interaction.options.getString('id');
      const value = interaction.options.getBoolean('value');
      setServer(id, { java: value });
      return interaction.editReply('✅ Java flag updated.');
    }

    if (sub === 'set-steam') {
      const id = interaction.options.getString('id');
      const value = interaction.options.getBoolean('value');
      setServer(id, { steam: value });
      return interaction.editReply('✅ Steam flag updated.');
    }

    if (sub === 'set-process') {
      const id = interaction.options.getString('id');
      const name = interaction.options.getString('name');
      setServer(id, { processName: name });
      return interaction.editReply(`✅ Process fallback set to **${name}**.`);
    }
  }


  /* ======================================================
     STEAM (LOCAL REGISTRY)
  ====================================================== */

/* ======================================================
   STEAM
====================================================== */

  if (cmd === 'steam') {
    const sub = interaction.options.getSubcommand();

    if (['add', 'update', 'addgame', 'removegame'].includes(sub)) {
      const gateReply = await requireIdracOnline(interaction, `run steam ${sub}`);
      if (gateReply) return gateReply;
    }

  /* ---------- LIST STEAM GAMES ---------- */
    if (sub === 'list') {
      const games = listSteamGames();

      if (!games.length) {
        return interaction.editReply('❌ No Steam games registered.');
      }

      return interaction.editReply(
        games.map(g => `• **${g.name}** (${g.appid})`).join('\n')
      );
    }

  /* ---------- ADD STEAM SERVER ---------- */
    if (sub === 'add') {
      const inputId = interaction.options.getString('id');
      const appid = interaction.options.getInteger('appid', true);
      const customDir = interaction.options.getString('dir');

      const games = listSteamGames();
      const game = games.find(g => Number(g.appid) === Number(appid));
      if (!game) {
        return interaction.editReply(
          `❌ AppID **${appid}** is not in \`src/steam/steam-games.json\`. Add it first with \`/steam addgame\`.`
        );
      }

      const toServerId = value => String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || `steam-${appid}`;

      const baseDir = process.env.BASE_SERVER_DIR || 'C:/Servers';
      const resolvedId = toServerId(inputId || game.name);
      const serverDir = customDir || path.join(baseDir, resolvedId);
      const folderName = path.basename(path.resolve(serverDir));

      const duplicate = loadServers({ includeDisabled: true }).find(
        s => s.id === resolvedId || path.resolve(s.cwd || '') === path.resolve(serverDir)
      );
      if (duplicate) {
        return interaction.editReply(
          `❌ A server already exists for id/path (**${duplicate.id}**). Choose a different id or dir.`
        );
      }

      try {
        createSteamServer({
          serverId: resolvedId,
          appid,
          serverDir,
          serverName: folderName
        });

        return interaction.editReply(
          `✅ Steam server created from AppID **${appid}**
` +
          `• Game: **${game.name}**
` +
          `• Server ID: **${resolvedId}**
` +
          `• Name: **${folderName}**
` +
          `• Folder: \`${serverDir}\`
` +
          `• Type: **steam**
` +
          `• Added: \`start.bat\`, \`stop.bat\`, \`update.bat\``
        );
      } catch (error) {
        return interaction.editReply(`❌ Steam add failed: ${error?.message || 'unknown error'}`);
      }
    }



  /* ---------- UPDATE STEAM SERVER ---------- */
    if (sub === 'update') {
      const updateAll = interaction.options.getBoolean('all') === true;
      const id = interaction.options.getString('id');

      if (!updateAll && !id) {
        return interaction.editReply('❌ Provide a server id or set `all` to true.');
      }

      const targets = updateAll
        ? loadServers({ includeDisabled: false }).filter(s => s.steam)
        : [getServer(id)].filter(Boolean);

      if (!targets.length) {
        return interaction.editReply('❌ No matching Steam servers found.');
      }

      const ok = [];
      const fail = [];

      for (const server of targets) {
        try {
          const taskName = await runUpdateTask(server);
          ok.push(`✅ **${server.name}** via task \`${taskName}\``);
        } catch (err) {
          fail.push(`❌ **${server.name}**: ${err.message || 'failed'}`);
        }
      }

      return interaction.editReply([
        `🔄 Update request complete (${ok.length}/${targets.length} started).`,
        ...ok,
        ...fail
      ].join('\n'));
    }

  /* ---------- SEARCH REGISTRY ---------- */
    if (sub === 'search') {
      const query = interaction.options.getString('query').toLowerCase();
      const games = listSteamGames();

      const results = games.filter(g =>
        g.name.toLowerCase().includes(query) ||
        String(g.appid).includes(query)
      );

      if (!results.length) {
        return interaction.editReply(
          '❌ No results found.'
        );
      }

      saveSearch(interaction.user.id, results, 0);

      const existing = new Set(games.map(g => g.appid));
      return interaction.editReply(
        buildSearchPage(results, 0, existing)
      );
    }

  /* ---------- ADD GAME TO REGISTRY ---------- */
    if (sub === 'addgame') {
      const appid = interaction.options.getInteger('appid', true);
      const name = interaction.options.getString('name', true);

      addSteamGame({ appid, name });
      return interaction.editReply(
        `✅ Added **${name}** (${appid})`
      );
    }

  /* ---------- REMOVE GAME ---------- */
    if (sub === 'removegame') {
      const appid = interaction.options.getInteger('appid', true);
      removeSteamGame(appid);
      return interaction.editReply(
        `🗑 Removed Steam game (${appid})`
      );
    }
  }


  /* ======================================================
     IDRAC
  ====================================================== */

  if (cmd === 'idrac') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      const status = await getIdracStatus();

      return interaction.editReply(
        `🖥 **iDRAC Status**\n` +
        `Power: **${status.power}**\n` +
        `State: **${status.state ?? 'unknown'}**`
      );
    }

    if (sub === 'on') {
      try {
        await idracPower('on');
        return interaction.editReply('🟢 iDRAC power **ON** command sent.');
      } catch (error) {
        return interaction.editReply(`❌ iDRAC ON failed: ${error?.message || 'unknown error'}`);
      }
    }

    if (sub === 'off') {
      try {
        await idracPower('off');
        return interaction.editReply('🔴 iDRAC power **OFF** command sent.');
      } catch (error) {
        return interaction.editReply(`❌ iDRAC OFF failed: ${error?.message || 'unknown error'}`);
      }
    }

    if (sub === 'reboot') {
      try {
        await idracPower('reboot');
        return interaction.editReply('🔄 iDRAC **REBOOT** command sent.');
      } catch (error) {
        return interaction.editReply(`❌ iDRAC reboot failed: ${error?.message || 'unknown error'}`);
      }
    }
  }

  /* ======================================================
     FALLBACK
  ====================================================== */

  return interaction.editReply('❌ Unknown command.');
}
