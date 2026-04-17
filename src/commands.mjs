import {
  loadServers,
  getServer,
  removeServer,
  setServer
} from './serverStore.mjs';
import fs from 'fs';
import { EmbedBuilder, MessageFlags } from 'discord.js';
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
import {
  saveSearch
} from './steam/searchStateCompat.mjs';

import {
  buildSearchPage
} from './steam/steamSearchUI.mjs';
import path from 'path';

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
  return ['enable', 'disable', 'rename', 'set-java', 'set-steam', 'set-group', 'set-process', 'set-dir', 'remove'].includes(sub);
}

const DISCORD_MESSAGE_LIMIT = 2000;
const SAFE_PAGE_LIMIT = 1800;

function toSafeLineChunks(line, maxLen = SAFE_PAGE_LIMIT) {
  const text = String(line ?? '');
  if (text.length <= maxLen) return [text];

  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}

function buildPagesFromLines(lines, title = '') {
  const normalizedLines = [];
  for (const line of lines) {
    normalizedLines.push(...toSafeLineChunks(line));
  }

  const pages = [];
  let buffer = [];
  let size = 0;

  for (const line of normalizedLines) {
    const lineLen = line.length + 1; // newline
    if (size + lineLen > SAFE_PAGE_LIMIT && buffer.length) {
      pages.push(buffer.join('\n'));
      buffer = [];
      size = 0;
    }
    buffer.push(line);
    size += lineLen;
  }

  if (buffer.length) {
    pages.push(buffer.join('\n'));
  }

  if (!pages.length) {
    pages.push(title ? `${title}\n(no entries)` : '(no entries)');
  }

  return pages.map((content, index) => {
    const prefix = `${title || 'List'} — Page ${index + 1}/${pages.length}`;
    const text = `${prefix}\n${content}`;
    return text.length > DISCORD_MESSAGE_LIMIT ? text.slice(0, DISCORD_MESSAGE_LIMIT - 3) + '...' : text;
  });
}

async function replyWithPages(interaction, lines, title = 'List') {
  const pages = buildPagesFromLines(lines, title);
  await interaction.editReply(pages[0]);

  for (let i = 1; i < pages.length; i += 1) {
    await interaction.followUp({
      content: pages[i],
      flags: MessageFlags.Ephemeral
    });
  }
}


async function runLifecycleCommand(server, cmd) {
  if (cmd === 'start') {
    await startServer(server);
    return `✅ Start triggered for **${server.name}**.`;
  }

  if (cmd === 'stop') {
    const stopped = await stopServer(server);
    if (!stopped) {
      return '⚠ Stop command sent, but no PID/process match was found.';
    }

    return `✅ Stop triggered for **${server.name}**.`;
  }

  const stopped = await stopServer(server);
  if (!stopped) {
    return '⚠ Restart blocked: could not find running process to stop.';
  }

  await startServer(server);
  return `✅ Restart triggered for **${server.name}**.`;
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

      return replyWithPages(interaction, lines, 'Servers');
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

    if (!servers.length) {
      return interaction.editReply('No servers configured.');
    }

    const lines = await Promise.all(servers.map(async s => {
      const st = await getServerState(s);
      const tags = [
        s.type ? `type:${s.type}` : null,
        s.group ? `group:${s.group}` : null
      ].filter(Boolean).join(' | ');

      return [
        `${st.emoji} **${s.name}** (\`${s.id}\`)`,
        `• Status: **${st.label}**`,
        `• Dir: \`${s.cwd || 'n/a'}\``,
        `• Meta: ${tags || 'none'}`
      ].join('\n');
    }));

    return interaction.editReply(lines.join('\n\n'));
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
        { name: 'Group', value: server.group || 'none', inline: true },
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
      const message = await runLifecycleCommand(server, cmd);
      return interaction.editReply(message);
    } catch (error) {
      return interaction.editReply(`❌ ${cmd} failed: ${error?.message || 'unknown error'}`);
    }
  }

  if (cmd === 'group') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const groupName = interaction.options.getString('name');
      let servers = loadServers({ includeDisabled: true }).filter(s => Boolean(s.group));

      if (groupName) {
        const normalizedGroup = groupName.toLowerCase();
        servers = servers.filter(s => (s.group || '').toLowerCase() === normalizedGroup);
      }

      if (!servers.length) {
        return interaction.editReply(groupName
          ? `❌ No servers found in group **${groupName}**.`
          : '❌ No grouped servers found.');
      }

      const lines = await Promise.all(servers.map(async s => {
        const st = await getServerState(s);
        const group = s.group ? ` • group: \`${s.group}\`` : '';
        return `${st.emoji} **${s.name}** (${s.id}) — ${st.label}${group}`;
      }));

      return interaction.editReply(lines.join('\n'));
    }

    if (sub === 'add') {
      const id = interaction.options.getString('id');
      const name = interaction.options.getString('name', true).trim();

      if (!name) {
        return interaction.editReply('❌ Group name cannot be empty.');
      }

      if (!id) {
        const targets = loadServers({ includeDisabled: false });

        for (const server of targets) {
          setServer(server.id, { group: name });
        }

        return interaction.editReply(
          `✅ Group **${name}** applied to **${targets.length}** enabled servers.`
        );
      }

      setServer(id, { group: name });
      return interaction.editReply(`✅ Server **${id}** added to group **${name}**.`);
    }

    if (sub === 'remove') {
      const id = interaction.options.getString('id', true);
      setServer(id, { group: '' });
      return interaction.editReply(`✅ Server **${id}** removed from its group.`);
    }

    const groupName = interaction.options.getString('name', true);
    const serverId = interaction.options.getString('id');
    const normalizedGroup = groupName.toLowerCase();
    let targets = loadServers({ includeDisabled: false })
      .filter(s => (s.group || '').toLowerCase() === normalizedGroup);

    if (!targets.length) {
      return interaction.editReply(`❌ No enabled servers found in group **${groupName}**.`);
    }

    if (serverId) {
      const selected = targets.find(s => s.id === serverId);
      if (!selected) {
        return interaction.editReply(
          `❌ Server **${serverId}** is not enabled in group **${groupName}**.`
        );
      }
      targets = [selected];
    }

    const ok = [];
    const fail = [];

    for (const server of targets) {
      try {
        const message = await runLifecycleCommand(server, sub);
        ok.push(`✅ **${server.name}** — ${message.replace(/^✅\s*/, '')}`);
      } catch (error) {
        fail.push(`❌ **${server.name}**: ${error?.message || 'unknown error'}`);
      }
    }

    try {
      return interaction.editReply([
        `🧩 Group **${groupName}** ${sub}: ${ok.length}/${targets.length} completed.${serverId ? ` (target: \`${serverId}\`)` : ''}`,
        ...ok,
        ...fail
      ].join('\n'));
    } catch (error) {
      return interaction.editReply(`❌ group ${sub} failed: ${error?.message || 'unknown error'}`);
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
      const group = interaction.options.getString('group');

      let servers = loadServers({ includeDisabled: all });

      if (type) {
        servers = servers.filter(s => s.type === type);
      }
      if (group) {
        const groupLower = group.toLowerCase();
        servers = servers.filter(s => (s.group || '').toLowerCase() === groupLower);
      }

      if (!servers.length) {
        return interaction.editReply('❌ No servers found.');
      }

      const lines = await Promise.all(servers.map(async s => {
        const st = await getServerState(s);
        return [
          `${st.emoji} **${s.name}** (\`${s.id}\`)`,
          `• Online: **${st.label}**`,
          `• Dir: \`${s.cwd || 'n/a'}\``,
          `• Type: \`${s.type || 'unknown'}\``,
          `• Enabled: \`${s.enabled !== false}\``,
          `• Steam: \`${s.steam === true}\``,
          `• Java: \`${s.java === true}\``,
          `• Group: \`${s.group || 'none'}\``,
          `• Process: \`${s.processName || 'n/a'}\``
        ].join('\n');
      }));

      const expanded = lines.flatMap((block, index) => {
        const divider = index > 0 ? [''] : [];
        return [...divider, ...block.split('\n')];
      });
      return replyWithPages(interaction, expanded, 'Config list');
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

    if (sub === 'set-group') {
      const id = interaction.options.getString('id');
      const group = interaction.options.getString('group', true).trim();

      if (!group) {
        return interaction.editReply('❌ Group cannot be empty.');
      }

      setServer(id, { group });
      return interaction.editReply(`✅ Group set to **${group}**.`);
    }

    if (sub === 'set-process') {
      const id = interaction.options.getString('id');
      const name = interaction.options.getString('name');
      setServer(id, { processName: name });
      return interaction.editReply(`✅ Process fallback set to **${name}**.`);
    }

    if (sub === 'set-dir') {
      const id = interaction.options.getString('id');
      const dir = interaction.options.getString('dir', true);
      const resolvedDir = path.resolve(dir);
      const folderName = path.basename(resolvedDir);

      const conflict = loadServers({ includeDisabled: true }).find(s =>
        s.id !== id && path.resolve(s.cwd || '') === resolvedDir
      );

      if (conflict) {
        return interaction.editReply(
          `❌ Folder is already used by **${conflict.id}**. Choose a different directory.`
        );
      }

      try {
        setServer(id, {
          cwd: resolvedDir,
          name: folderName || id
        });
      } catch (error) {
        return interaction.editReply(`❌ Failed to update server dir: ${error?.message || 'unknown error'}`);
      }

      return interaction.editReply(
        `✅ Server **${id}** directory updated.\n` +
        `• Folder: \`${resolvedDir}\`\n` +
        `• Name: **${folderName || id}**`
      );
    }

    if (sub === 'remove') {
      const id = interaction.options.getString('id', true);
      try {
        removeServer(id);
        return interaction.editReply(`🗑️ Removed server **${id}** from config.`);
      } catch (error) {
        return interaction.editReply(`❌ Remove failed: ${error?.message || 'unknown error'}`);
      }
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

    if (['update', 'addgame', 'removegame'].includes(sub)) {
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
