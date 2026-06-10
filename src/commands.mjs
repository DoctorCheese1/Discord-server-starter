import {
  loadServers,
  getServer,
  removeServer,
  setServer
} from './serverStore.mjs';
import fs from 'fs';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import {
  buildConsoleLogPath,
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
import { appendAuditEntry, readRecentAuditEntries } from './auditStore.mjs';
import { createBackup, listBackups, restoreBackup } from './backupManager.mjs';
import { folderSizeBytes, formatBytes } from './diskUsage.mjs';
import { createServerTemplate } from './templates.mjs';
import { sendRconCommand } from './rconClient.mjs';

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
  return ['enable', 'disable', 'rename', 'set-java', 'set-steam', 'set-group', 'set-process', 'set-rcon', 'set-dir', 'remove'].includes(sub);
}

const DISCORD_MESSAGE_LIMIT = 2000;
const SAFE_PAGE_LIMIT = 1800;
const AUDIT_LOG_LIMIT = 200;
const auditTrail = [];
const scheduledGroupActions = new Map();

function addAuditEntry(interaction, action, details = '', status = 'ok') {
  const entry = appendAuditEntry({
    at: new Date().toISOString(),
    user: interaction?.user?.tag || interaction?.user?.id || 'unknown',
    userId: interaction?.user?.id || '',
    action,
    status,
    details
  });
  auditTrail.unshift(entry);
  if (auditTrail.length > AUDIT_LOG_LIMIT) auditTrail.length = AUDIT_LOG_LIMIT;
}

function buildSearchQuery(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return {
    q: normalized,
    tokens: normalized.split(/\s+/).filter(Boolean)
  };
}

function searchScore(game, searchQuery) {
  if (!searchQuery) return 0;

  const { q, tokens } = searchQuery;
  const name = String(game.name || '').toLowerCase();
  const appid = String(game.appid || '');

  if (appid === q) return 1000;
  if (name === q) return 950;
  if (name.startsWith(q)) return 900;

  const allTokensInName = tokens.length > 0 && tokens.every(token => name.includes(token));
  if (allTokensInName) {
    return 700 - Math.min(name.indexOf(tokens[0]), 200);
  }

  if (appid.includes(q)) return 500;
  if (name.includes(q)) return 400;

  return 0;
}

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

function requireConfirm(interaction, actionLabel) {
  if (interaction.options.getBoolean('confirm') === true) return null;
  return `⚠️ Safety confirmation required. Re-run this command with \`confirm:true\` to ${actionLabel}.`;
}

function readTextTail(file, lines = 50) {
  if (!fs.existsSync(file)) throw new Error('Console log does not exist yet');
  const content = fs.readFileSync(file, 'utf8');
  const selected = content.split(/\r?\n/).slice(-Math.max(1, Math.min(lines, 100)));
  return selected.join('\n').slice(-SAFE_PAGE_LIMIT);
}

function searchTextFile(file, query, limit = 25) {
  if (!fs.existsSync(file)) throw new Error('Console log does not exist yet');
  const q = String(query || '').toLowerCase();
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(entry => entry.line.toLowerCase().includes(q))
    .slice(-limit)
    .map(entry => `${entry.index}: ${entry.line}`);
}

const scheduledServerActions = new Map();
let nextScheduleId = 1;

function serverRconConfig(server) {
  return {
    host: server.rconHost || process.env.MC_RCON_HOST || '127.0.0.1',
    port: server.rconPort || process.env.MC_RCON_PORT || 25575,
    password: server.rconPassword || process.env.MC_RCON_PASSWORD || ''
  };
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
      const detailLines = results
        .map(r => {
          if (r.status === 'synced') return `🟢 ${r.id} → ${r.taskName}`;
          if (r.status === 'skipped') return `🟡 ${r.id} → skipped (${r.reason})`;
          return `🔴 ${r.id} → failed (${r.reason})`;
        });

      return replyWithPages(interaction, [summary, '', ...detailLines], 'Servers validate');
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


  if (cmd === 'console') {
    const sub = interaction.options.getSubcommand();
    const id = interaction.options.getString('id', true);
    const server = getServer(id, { includeDisabled: true });
    if (!server) return interaction.editReply('❌ Server not found.');
    const logFile = buildConsoleLogPath(server);

    try {
      if (sub === 'tail') {
        const lines = interaction.options.getInteger('lines') || 50;
        const text = readTextTail(logFile, lines);
        addAuditEntry(interaction, 'console.tail', server.id);
        return interaction.editReply(`📜 Console tail for **${server.name}** (\`${logFile}\`):\n\`\`\`\n${text || '(empty)'}\n\`\`\``);
      }

      if (sub === 'search') {
        const query = interaction.options.getString('query', true);
        const matches = searchTextFile(logFile, query);
        if (!matches.length) return interaction.editReply(`🔎 No matches for **${query}** in **${server.name}**.`);
        addAuditEntry(interaction, 'console.search', `${server.id} query=${query}`);
        return replyWithPages(interaction, [`🔎 Matches for **${query}** in **${server.name}**:`, '', ...matches], 'Console search');
      }

      if (sub === 'clear') {
        const confirmation = requireConfirm(interaction, `clear the console log for ${server.name}`);
        if (confirmation) return interaction.editReply(confirmation);
        fs.writeFileSync(logFile, '', 'utf8');
        addAuditEntry(interaction, 'console.clear', server.id);
        return interaction.editReply(`🧹 Cleared console log for **${server.name}**.`);
      }
    } catch (error) {
      addAuditEntry(interaction, `console.${sub}`, `${server.id}: ${error?.message || 'error'}`, 'failed');
      return interaction.editReply(`❌ Console ${sub} failed: ${error?.message || 'unknown error'}`);
    }
  }

  if (cmd === 'backup') {
    const sub = interaction.options.getSubcommand();
    const id = interaction.options.getString('id', true);
    const server = getServer(id, { includeDisabled: true });
    if (!server) return interaction.editReply('❌ Server not found.');

    try {
      if (sub === 'create') {
        const label = interaction.options.getString('label') || '';
        const backup = createBackup(server, label);
        addAuditEntry(interaction, 'backup.create', `${server.id} ${backup.name}`);
        return interaction.editReply(`💾 Backup created for **${server.name}**.\n• Name: \`${backup.name}\`\n• Path: \`${backup.path}\``);
      }

      if (sub === 'list') {
        const backups = listBackups(server.id);
        if (!backups.length) return interaction.editReply(`ℹ️ No backups found for **${server.name}**.`);
        const lines = backups.slice(0, 25).map(b => `• \`${b.name}\` — ${b.createdAt}`);
        return replyWithPages(interaction, [`💾 Backups for **${server.name}**`, '', ...lines], 'Backups');
      }

      if (sub === 'restore') {
        const confirmation = requireConfirm(interaction, `restore a backup over ${server.name}`);
        if (confirmation) return interaction.editReply(confirmation);
        const name = interaction.options.getString('name', true);
        const restored = restoreBackup(server, name);
        addAuditEntry(interaction, 'backup.restore', `${server.id} ${restored.name}`);
        return interaction.editReply(`♻️ Restored **${server.name}** from backup \`${restored.name}\`.`);
      }
    } catch (error) {
      addAuditEntry(interaction, `backup.${sub}`, `${server.id}: ${error?.message || 'error'}`, 'failed');
      return interaction.editReply(`❌ Backup ${sub} failed: ${error?.message || 'unknown error'}`);
    }
  }

  if (cmd === 'disk') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'summary') {
      const id = interaction.options.getString('id');
      const servers = id ? [getServer(id, { includeDisabled: true })].filter(Boolean) : loadServers({ includeDisabled: true });
      if (!servers.length) return interaction.editReply('❌ No matching servers found.');
      const rows = servers.map(server => {
        const size = folderSizeBytes(server.cwd);
        return { server, size };
      }).sort((a, b) => b.size - a.size);
      const total = rows.reduce((sum, row) => sum + row.size, 0);
      const lines = rows.map(row => `• **${row.server.name}** (\`${row.server.id}\`) — **${formatBytes(row.size)}**`);
      return replyWithPages(interaction, [`💽 Disk usage total: **${formatBytes(total)}**`, '', ...lines], 'Disk usage');
    }
  }

  if (cmd === 'schedule') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      if (!scheduledServerActions.size) return interaction.editReply('ℹ️ No pending server schedules.');
      const lines = [...scheduledServerActions.entries()].map(([id, item]) => `• \`${id}\` — **${item.serverName}** ${item.action} at <t:${Math.floor(item.runAt / 1000)}:F>`);
      return replyWithPages(interaction, lines, 'Schedules');
    }

    if (sub === 'cancel') {
      const id = interaction.options.getString('id', true);
      const item = scheduledServerActions.get(id);
      if (!item) return interaction.editReply('❌ Schedule not found.');
      clearTimeout(item.timer);
      scheduledServerActions.delete(id);
      addAuditEntry(interaction, 'schedule.cancel', id);
      return interaction.editReply(`🛑 Cancelled schedule \`${id}\`.`);
    }

    if (sub === 'run') {
      const id = interaction.options.getString('id', true);
      const action = interaction.options.getString('action', true);
      const delayMinutes = interaction.options.getInteger('delay-minutes', true);
      const server = getServer(id);
      if (!server) return interaction.editReply('❌ Server not found or disabled.');
      if (action === 'update' && !server.steam) return interaction.editReply('❌ Update schedules require a Steam server.');

      const scheduleId = String(nextScheduleId++);
      const runAt = Date.now() + delayMinutes * 60000;
      const timer = setTimeout(async () => {
        try {
          if (action === 'update') await runUpdateTask(server);
          else await runLifecycleCommand(server, action);
        } catch {}
        scheduledServerActions.delete(scheduleId);
      }, delayMinutes * 60000);
      scheduledServerActions.set(scheduleId, { timer, runAt, serverId: server.id, serverName: server.name, action });
      addAuditEntry(interaction, 'schedule.run', `${server.id} ${action} in ${delayMinutes}m`);
      return interaction.editReply(`⏱ Scheduled **${action}** for **${server.name}** at <t:${Math.floor(runAt / 1000)}:F>. Schedule id: \`${scheduleId}\``);
    }
  }

  if (cmd === 'template') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') {
      const id = interaction.options.getString('id', true);
      const server = getServer(id, { includeDisabled: true });
      if (!server) return interaction.editReply('❌ Server not found.');
      const type = interaction.options.getString('type', true);
      const overwrite = interaction.options.getBoolean('overwrite') === true;
      try {
        const result = createServerTemplate(server, type, { overwrite });
        addAuditEntry(interaction, 'template.create', `${server.id} type=${type} overwrite=${overwrite}`);
        return interaction.editReply([
          `🧰 Template generation complete for **${server.name}**.`,
          `• start.bat: ${result.startBat ? 'created' : 'kept existing'}`,
          `• stop.bat: ${result.stopBat ? 'created' : 'kept existing'}`,
          `• update.bat: ${result.updateBat ? 'created' : 'kept existing'}`
        ].join('\n'));
      } catch (error) {
        return interaction.editReply(`❌ Template creation failed: ${error?.message || 'unknown error'}`);
      }
    }
  }

  if (cmd === 'mc') {
    const sub = interaction.options.getSubcommand();
    const id = interaction.options.getString('id', true);
    const server = getServer(id, { includeDisabled: true });
    if (!server) return interaction.editReply('❌ Server not found.');
    const cfg = serverRconConfig(server);
    if (!cfg.password) return interaction.editReply('❌ RCON password is not configured. Set `MC_RCON_PASSWORD` or server metadata.');
    const command = sub === 'players'
      ? 'list'
      : sub === 'say'
        ? `say ${interaction.options.getString('message', true)}`
        : interaction.options.getString('command', true).replace(/^\//, '');
    try {
      const response = await sendRconCommand({ ...cfg, command });
      addAuditEntry(interaction, `mc.${sub}`, `${server.id} ${command}`);
      return interaction.editReply(`🎮 RCON response from **${server.name}**:\n\`\`\`\n${String(response).slice(0, SAFE_PAGE_LIMIT)}\n\`\`\``);
    } catch (error) {
      addAuditEntry(interaction, `mc.${sub}`, `${server.id}: ${error?.message || 'error'}`, 'failed');
      return interaction.editReply(`❌ RCON command failed: ${error?.message || 'unknown error'}`);
    }
  }

  if (cmd === 'webeditor') {
    const sub = interaction.options.getSubcommand();
    const enabled = process.env.WEB_EDITOR_ENABLED === 'true';
    const port = process.env.WEB_EDITOR_PORT || '8787';
    const hasKey = Boolean(process.env.WEB_EDITOR_API_KEY);
    const host = process.env.WEB_EDITOR_PUBLIC_HOST || '<host>';

    if (!enabled) {
      return interaction.editReply(
        '⚠ Web editor is disabled. Set `WEB_EDITOR_ENABLED=true` and restart the bot.'
      );
    }

    if (sub === 'open') {
      const id = interaction.options.getString('id', true);
      const server = getServer(id, { includeDisabled: true });
      if (!server) {
        return interaction.editReply('❌ Server not found.');
      }
      const baseUrl = `http://${host}:${port}/`;
      const params = new URLSearchParams({ serverId: id });
      if (hasKey) {
        params.set('key', process.env.WEB_EDITOR_API_KEY);
      }
      return interaction.editReply(
        `🔗 Open Web Editor for **${server.name}** (\`${id}\`):\n${baseUrl}?${params.toString()}`
      );
    }
    addAuditEntry(interaction, 'webeditor.status');

    return interaction.editReply(
      `🌐 Web editor is enabled.\n` +
      `URL: **http://${host}:${port}/**\n` +
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

    if (['stop', 'restart'].includes(cmd)) {
      const confirmation = requireConfirm(interaction, `${cmd} ${server.name}`);
      if (confirmation) return interaction.editReply(confirmation);
    }

    try {
      const message = await runLifecycleCommand(server, cmd);
      addAuditEntry(interaction, `server.${cmd}`, server.id);
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

    if (sub === 'health') {
      const groupName = interaction.options.getString('name', true);
      const normalizedGroup = groupName.toLowerCase();
      const groupedServers = loadServers({ includeDisabled: true })
        .filter(s => (s.group || '').toLowerCase() === normalizedGroup);

      if (!groupedServers.length) {
        return interaction.editReply(`❌ No servers found in group **${groupName}**.`);
      }

      const states = await Promise.all(groupedServers.map(async server => ({
        server,
        state: await getServerState(server)
      })));

      const counts = { running: 0, stopped: 0, disabled: 0, updating: 0 };
      for (const { state } of states) {
        if (state.label === 'Running') counts.running += 1;
        else if (state.label === 'Stopped') counts.stopped += 1;
        else if (state.label === 'Disabled') counts.disabled += 1;
        else if (state.label === 'Updating') counts.updating += 1;
      }

      const details = states
        .map(({ server, state }) => `${state.emoji} **${server.name}** (\`${server.id}\`) — ${state.label}`)
        .join('\n');

      return interaction.editReply([
        `🩺 Group **${groupName}** health summary`,
        `• Total: **${groupedServers.length}**`,
        `• Running: **${counts.running}**`,
        `• Updating: **${counts.updating}**`,
        `• Stopped: **${counts.stopped}**`,
        `• Disabled: **${counts.disabled}**`,
        '',
        details
      ].join('\n'));
    }
    if (sub === 'update') {
      const groupName = interaction.options.getString('name', true);
      const normalizedGroup = groupName.toLowerCase();
      const targets = loadServers({ includeDisabled: false })
        .filter(s => (s.group || '').toLowerCase() === normalizedGroup && s.steam === true);
      if (!targets.length) {
        return interaction.editReply(`❌ No enabled Steam servers found in group **${groupName}**.`);
      }
      const ok = [];
      const fail = [];
      for (const server of targets) {
        try {
          const taskName = await runUpdateTask(server);
          ok.push(`✅ **${server.name}** via \`${taskName}\``);
        } catch (error) {
          fail.push(`❌ **${server.name}**: ${error?.message || 'unknown error'}`);
        }
      }
      addAuditEntry(interaction, 'group.update', `group=${groupName} ok=${ok.length}/${targets.length}`);
      return interaction.editReply([`🔄 Group **${groupName}** update: ${ok.length}/${targets.length} started.`, ...ok, ...fail].join('\n'));
    }
    if (sub === 'schedule') {
      const groupName = interaction.options.getString('name', true);
      const action = interaction.options.getString('action', true);
      const delayMinutes = interaction.options.getInteger('delay-minutes', true);
      const runAt = Date.now() + delayMinutes * 60000;
      const key = `${groupName.toLowerCase()}::${action}`;
      if (scheduledGroupActions.has(key)) {
        clearTimeout(scheduledGroupActions.get(key).timer);
      }
      const timer = setTimeout(async () => {
        try {
          const targets = loadServers({ includeDisabled: false })
            .filter(s => (s.group || '').toLowerCase() === groupName.toLowerCase());
          for (const server of targets) {
            if (action === 'update') {
              if (server.steam === true) await runUpdateTask(server);
            } else {
              await runLifecycleCommand(server, action);
            }
          }
        } catch {}
        scheduledGroupActions.delete(key);
      }, delayMinutes * 60000);
      scheduledGroupActions.set(key, { timer, runAt, groupName, action });
      addAuditEntry(interaction, 'group.schedule', `${groupName} ${action} in ${delayMinutes}m`);
      return interaction.editReply(`⏱ Scheduled group **${groupName}** action **${action}** for <t:${Math.floor(runAt / 1000)}:F>.`);
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

  if (cmd === 'audit') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'recent') {
      const recent = readRecentAuditEntries(20);
      if (!recent.length) return interaction.editReply('ℹ️ No audit entries yet.');
      const lines = recent.map(entry => `• [${entry.at}] **${entry.user}** — \`${entry.action}\` [${entry.status || 'ok'}]${entry.details ? ` (${entry.details})` : ''}`);
      return replyWithPages(interaction, lines, 'Audit');
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
        });

      return replyWithPages(
        interaction,
        [
          `✅ Config checked (${servers.length} servers)`,
          `Task Scheduler: ${synced} synced, ${skipped} skipped, ${failed} failed.`,
          '',
          ...details
        ],
        'Config validate'
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

    if (sub === 'set-rcon') {
      const id = interaction.options.getString('id');
      const host = interaction.options.getString('host');
      const port = interaction.options.getInteger('port');
      const password = interaction.options.getString('password');
      const patch = {};
      if (host) patch.rconHost = host;
      if (port) patch.rconPort = port;
      if (password) patch.rconPassword = password;
      setServer(id, patch);
      return interaction.editReply(`✅ RCON settings updated for **${id}**.`);
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
      const confirmation = requireConfirm(interaction, `remove server ${id} from config`);
      if (confirmation) return interaction.editReply(confirmation);
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
      const query = interaction.options.getString('query', true).trim();
      const searchQuery = buildSearchQuery(query);
      const games = listSteamGames();

      const scored = games
        .map(game => ({ game, score: searchScore(game, searchQuery) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.game.name.localeCompare(b.game.name);
        });

      const results = scored.map(entry => entry.game);

      if (!results.length) {
        return interaction.editReply('❌ No results found. Try a shorter or more specific term.');
      }

      saveSearch(interaction.user.id, results, 0, query);

      const existing = new Set(games.map(g => g.appid));
      return interaction.editReply(
        buildSearchPage(results, 0, existing, query)
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
      const confirmation = requireConfirm(interaction, 'power off the iDRAC host');
      if (confirmation) return interaction.editReply(confirmation);
      try {
        await idracPower('off');
        return interaction.editReply('🔴 iDRAC power **OFF** command sent.');
      } catch (error) {
        return interaction.editReply(`❌ iDRAC OFF failed: ${error?.message || 'unknown error'}`);
      }
    }

    if (sub === 'reboot') {
      const confirmation = requireConfirm(interaction, 'reboot the iDRAC host');
      if (confirmation) return interaction.editReply(confirmation);
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
