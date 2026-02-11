import {
  loadServers,
  getServer,
  addServer,
  removeServer,
  setServer
} from './serverStore.mjs';
import fs from 'fs';
import { EmbedBuilder } from 'discord.js';
import { ensureUpdateTask, isRunning, runUpdateTask, startServer, stopServer } from './processManager.mjs';

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

/* ======================================================
   MAIN HANDLER
====================================================== */


async function getIdracGateState() {
  const monitor = await refreshIdracMonitor();
  const status = await getIdracStatus();

  return {
    monitor,
    status,
    online: monitor.reachable && status.reachable && status.power === 'ON'
  };
}

async function denyIfIdracOffline(interaction) {
  const gate = await getIdracGateState();

  if (gate.online) {
    return null;
  }

  const reason = [
    gate.monitor.reachable ? null : 'network unreachable',
    gate.status.reachable ? null : 'status check failed',
    gate.status.power === 'ON' ? null : `power=${gate.status.power}`
  ].filter(Boolean).join(', ');

  await interaction.editReply(
    `⛔ Command blocked. iDRAC target is not online yet (${reason || 'unknown'}). ` +
    'Use `/idrac status` and power it on first.'
  );

  return gate;
}

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

export async function handleCommand(interaction) {
  const cmd = interaction.commandName;

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
          if (!s.updateBat || !fs.existsSync(s.updateBat)) {
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
    const monitor = getIdracMonitorState();
    const idracLine = monitor.reachable
      ? '🟢 iDRAC network reachable'
      : `🔴 iDRAC offline (${monitor.lastError || 'no response'})`;

    return interaction.editReply(
      [
        idracLine,
        servers.length
          ? servers.map(s => `• ${s.name}`).join('\n')
          : 'No servers configured.'
      ].join('\n')
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
    const gate = await denyIfIdracOffline(interaction);
    if (gate) return;

    const id = interaction.options.getString('id');
    const server = getServer(id);

    if (!server) {
      return interaction.editReply('❌ Server not found.');
    }

    try {
      if (cmd === 'start') {
        const pid = await startServer(server);
        return interaction.editReply(`✅ Started **${server.name}** (PID: ${pid}).`);
      }

      if (cmd === 'stop') {
        const stopped = await stopServer(server);
        return interaction.editReply(
          stopped
            ? `🛑 Stopped **${server.name}**.`
            : `⚠ Stop command sent for **${server.name}**, but no tracked PID was found.`
        );
      }

      await stopServer(server);
      const pid = await startServer(server);
      return interaction.editReply(`🔄 Restarted **${server.name}** (PID: ${pid}).`);
    } catch (error) {
      return interaction.editReply(`❌ ${cmd} failed: ${error?.message || 'unknown error'}`);
    }
  }

  /* ======================================================
     CONFIG
  ====================================================== */

  if (cmd === 'config') {
    const sub = interaction.options.getSubcommand();

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
      return interaction.editReply(
        `✅ Config valid\nServers: ${servers.length}`
      );
    }

    if (sub === 'enable' || sub === 'disable') {
      const gate = await denyIfIdracOffline(interaction);
      if (gate) return;
      const id = interaction.options.getString('id');
      setServer(id, { enabled: sub === 'enable' });
      return interaction.editReply(`✅ Server **${id}** updated.`);
    }

    if (sub === 'rename') {
      const gate = await denyIfIdracOffline(interaction);
      if (gate) return;
      const id = interaction.options.getString('id');
      const name = interaction.options.getString('name');
      setServer(id, { name });
      return interaction.editReply(`✅ Server renamed to **${name}**.`);
    }

    if (sub === 'set-java') {
      const gate = await denyIfIdracOffline(interaction);
      if (gate) return;
      const id = interaction.options.getString('id');
      const value = interaction.options.getBoolean('value');
      setServer(id, { java: value });
      return interaction.editReply('✅ Java flag updated.');
    }

    if (sub === 'set-steam') {
      const gate = await denyIfIdracOffline(interaction);
      if (gate) return;
      const id = interaction.options.getString('id');
      const value = interaction.options.getBoolean('value');
      setServer(id, { steam: value });
      return interaction.editReply('✅ Steam flag updated.');
    }

    if (sub === 'set-process') {
      const gate = await denyIfIdracOffline(interaction);
      if (gate) return;
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
      const gate = await denyIfIdracOffline(interaction);
      if (gate) return;
      const id = interaction.options.getString('id', true);
      const appid = interaction.options.getInteger('appid', true);
      const customDir = interaction.options.getString('dir');

    // const baseDir =
    //   process.env.STEAM_BASE_DIR || 'C:\\Servers\\Steam';

    // const serverDir =
    //   customDir || path.join(baseDir, id);

    // // ensure directory exists
    // fs.mkdirSync(serverDir, { recursive: true });

    // register only
    // addServer({
    //   id,
    //   name: `Steam Server (${appid})`,
    //   type: 'steam',
    //   enabled: true,
    //   cwd: serverDir,
    //   steam: true,
    //   java: false
    // });

      return interaction.editReply(
        // `✅ Steam server **${id}** registered\n` +
        // `📦 AppID: ${appid}\n` +
        // `📁 ${serverDir}\n\n` +
        '⚠ Installation disabled — add files manually'
      );
    }


  /* ---------- UPDATE STEAM SERVER ---------- */
    if (sub === 'update') {
      const gate = await denyIfIdracOffline(interaction);
      if (gate) return;
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
      const gate = await denyIfIdracOffline(interaction);
      if (gate) return;
      const appid = interaction.options.getInteger('appid', true);
      const name = interaction.options.getString('name', true);

      addSteamGame({ appid, name });
      return interaction.editReply(
        `✅ Added **${name}** (${appid})`
      );
    }

  /* ---------- REMOVE GAME ---------- */
    if (sub === 'removegame') {
      const gate = await denyIfIdracOffline(interaction);
      if (gate) return;
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

      const monitor = await refreshIdracMonitor();
      return interaction.editReply(
        `🖥 **iDRAC Status**\n` +
        `Power: **${status.power}**\n` +
        `State: **${status.state ?? 'unknown'}**\n` +
        `Reachable: **${monitor.reachable ? 'yes' : 'no'}**` +
        `${monitor.lastError ? `\nError: ${monitor.lastError}` : ''}`
      );
    }

    if (sub === 'on') {
      await idracPower('on');
      return interaction.editReply('🟢 iDRAC power **ON** command sent.');
    }

    if (sub === 'off') {
      await idracPower('off');
      return interaction.editReply('🔴 iDRAC power **OFF** command sent.');
    }

    if (sub === 'reboot') {
      await idracPower('reboot');
      return interaction.editReply('🔄 iDRAC **REBOOT** command sent.');
    }
  }

  /* ======================================================
     FALLBACK
  ====================================================== */

  return interaction.editReply('❌ Unknown command.');
}
