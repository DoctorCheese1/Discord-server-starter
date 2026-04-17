import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  MessageFlags
} from 'discord.js';

import { autoDeployIfEnabled } from './autoDeploy.mjs';
import { startPresenceLoop, startIdracPresenceLoop } from './presence.mjs';
import { handleCommand } from './commands.mjs';
import { startIdracMonitor } from './idrac/idracMonitor.mjs';
import { loadServers } from './serverStore.mjs';
import { ensureInstalledUpdateTasks } from './processManager.mjs';
import { startWebEditor } from './webEditor.mjs';

import {
  getSearch,
  saveSearch,
  clearSearch
} from './steam/searchStateCompat.mjs';

import {
  addSteamGame,
  listSteamGames
} from './steam/steamGameStore.mjs';

import { buildSearchPage } from './steam/steamSearchUI.mjs';
import { isIdracOnlyMode } from './mode.mjs';

/* ================= ENV ================= */
dotenv.config({
  path: new URL('../.env', import.meta.url)
});

/* ================= PATHS ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const AUTH_FILE = path.join(ROOT, 'data', 'authUsers.json');
const DEFAULT_SERVERS_DIR = 'C:/Servers';
const DEFAULT_AUTH_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour
const AUTH_CHECK_INTERVAL = Number.isFinite(Number(process.env.AUTH_CHECK_INTERVAL_MS))
  ? Math.max(1000, Number(process.env.AUTH_CHECK_INTERVAL_MS))
  : DEFAULT_AUTH_CHECK_INTERVAL;

/* ================= AUTH STATE ================= */

function readAuthState() {
  try {
    if (!fs.existsSync(AUTH_FILE)) return {};
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeAuthState(state) {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(state, null, 2));
}

function startServerFolderWatcher() {
  const rootDir = process.env.BASE_SERVER_DIR || DEFAULT_SERVERS_DIR;
  fs.mkdirSync(rootDir, { recursive: true });

  let syncTimer = null;
  const runSync = () => {
    try {
      const discovered = loadServers({ includeDisabled: true });
      console.log(`🔄 Server folder change sync complete (${discovered.length} server entries).`);
    } catch (err) {
      console.error('❌ Server folder change sync failed:', err);
    }
  };

  try {
    const watcher = fs.watch(rootDir, { persistent: true }, () => {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(runSync, 500);
    });

    watcher.on('error', err => {
      console.error('❌ Server folder watcher error:', err);
    });

    console.log(`👀 Watching server folder for add/remove changes: ${rootDir}`);
    return watcher;
  } catch (err) {
    console.error('❌ Failed to watch server folder:', err);
    return null;
  }
}

/* ================= CLIENT ================= */
const client = new Client({
  intents: [GatewayIntentBits.DirectMessages]
});

/* ================= READY ================= */
client.once('clientReady', async () => {
  console.log(`✅ DM-only bot online as ${client.user.tag}`);
  const idracOnly = isIdracOnlyMode();

  if (idracOnly) {
    console.log('🧩 IDRAC_ONLY_MODE enabled: skipping server/steam/web subsystems.');
  }

  // ---------- AUTO DEPLOY ----------
  // Keep auto-deploy/hash behavior active in all modes so iDRAC-only command signatures
  // are still tracked and can deploy `/idrac` when AUTO_DEPLOY=true.
  try {
    await autoDeployIfEnabled();
  } catch (err) {
    console.error('❌ Auto-deploy failed:', err);
  }

  // ---------- PRESENCE ----------
  if (idracOnly) {
    startIdracPresenceLoop(client);
  } else {
    startPresenceLoop(client);
  }

  // ---------- WEB FILE EDITOR ----------
  if (!idracOnly) {
    startWebEditor();
  }

  // ---------- IDRAC MONITOR ----------
  startIdracMonitor();

  // ---------- TASK SCHEDULER SYNC ----------
  if (!idracOnly) {
    try {
      const taskSync = await ensureInstalledUpdateTasks(loadServers({ includeDisabled: true }));
      const synced = taskSync.filter(r => r.status === 'synced').length;
      const failed = taskSync.filter(r => r.status === 'failed').length;
      console.log(`🗓 Update task sync complete: ${synced} synced, ${failed} failed.`);
    } catch (err) {
      console.error('❌ Update task sync failed:', err);
    }

    startServerFolderWatcher();
  }

  // ---------- AUTH CHECK LOOP ----------
  setInterval(async () => {
    const owners = (process.env.OWNER_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (!owners.length) return;

    const state = readAuthState();
    const now = Date.now();

    for (const userId of owners) {
      const entry = state[userId] || {};
      const lastSeen = entry.lastSeen || 0;

      // ⏱ Respect configured auth check interval
      if (now - lastSeen < AUTH_CHECK_INTERVAL) continue;

      try {
        const user = await client.users.fetch(userId);

        if (!entry.welcomed) {
          const welcomeDescription = idracOnly
            ? (
              `Your app authorization is active in **iDRAC-only mode**.\n\n` +
              `**Quick start (iDRAC):**\n` +
              `• \`/idrac status\` — Check power state\n` +
              `• \`/idrac on\` — Power on the server\n` +
              `• \`/idrac off\` — Power off the server\n` +
              `• \`/idrac reboot\` — Reboot the server\n\n` +
              `Presence reflects power state: **Server Online (iDRAC)** or **Server Offline (iDRAC)**.\n\n` +
              `This welcome message is sent **once per authorization**.`
            )
            : (
              `Your app authorization is active.\n\n` +
              `**Quick start:**\n` +
              `• \`/servers\` — View all servers\n` +
              `• \`/status\` — System & server health\n` +
              `• \`/steam update\` — Update Steam servers\n` +
              `• \`/idrac status\` — Check power state\n\n` +
              `This welcome message is sent **once per authorization**.`
            );

          const embed = new EmbedBuilder()
            .setTitle('👋 Welcome to Server Starter 2.0')
            .setDescription(welcomeDescription)
            .setColor(0x2ecc71)
            .setFooter({
              text: `Server Starter 2.0 • ${new Date().toLocaleString()}`
            });

          try {
            await user.send({ embeds: [embed] });
          } catch {
            // DM failed — still mark as welcomed to prevent retry spam
          }

          entry.welcomed = true;
          entry.welcomedAt = now;
        }

        entry.lastSeen = now;
        state[userId] = entry;

      } catch {
        entry.lastSeen = now;
        state[userId] = entry;
      }
    }

    writeAuthState(state);
  }, AUTH_CHECK_INTERVAL);
});

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async interaction => {
  const idracOnly = isIdracOnlyMode();

  if (interaction.isAutocomplete()) {
    if (idracOnly) {
      return interaction.respond([]);
    }

    try {
      if (interaction.commandName !== 'start') {
        return interaction.respond([]);
      }

      const focused = interaction.options.getFocused(true);
      if (!focused || focused.name !== 'id') {
        return interaction.respond([]);
      }

      const query = String(focused.value || '').trim().toLowerCase();
      const candidates = loadServers({ includeDisabled: false });
      const scored = candidates
        .filter(s => {
          if (!query) return true;
          const id = String(s.id || '').toLowerCase();
          const name = String(s.name || '').toLowerCase();
          return id.includes(query) || name.includes(query);
        })
        .sort((a, b) => {
          const aId = String(a.id || '').toLowerCase();
          const bId = String(b.id || '').toLowerCase();
          const aStarts = query ? aId.startsWith(query) : false;
          const bStarts = query ? bId.startsWith(query) : false;
          if (aStarts !== bStarts) return aStarts ? -1 : 1;
          return aId.localeCompare(bId);
        })
        .slice(0, 25)
        .map(s => ({
          name: `${s.name} (${s.id})`.slice(0, 100),
          value: s.id
        }));

      return interaction.respond(scored);
    } catch (err) {
      console.error('❌ Autocomplete error:', err);
      return interaction.respond([]);
    }
  }

  // SLASH COMMANDS
  if (interaction.isChatInputCommand()) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await handleCommand(interaction);
    } catch (err) {
      console.error('❌ Command error:', err);
    }
    return;
  }

  // BUTTONS
  if (!interaction.isButton()) return;

  if (idracOnly) {
    return;
  }

  try {
    await interaction.deferUpdate();

    const id = interaction.customId;
    const userId = interaction.user.id;
    const state = getSearch(userId);

    if (!state) {
      return interaction.editReply({
        content: '❌ Search expired. Run `/steam search` again.',
        components: []
      });
    }

    const existing = new Set(
      listSteamGames().map(g => g.appid)
    );

    if (id.startsWith('steam_addgame:')) {
      const appid = Number(id.split(':')[1]);
      const game = state.results.find(g => g.appid === appid);

      if (!game) {
        return interaction.editReply({
          content: '❌ Game not found.',
          components: []
        });
      }

      if (existing.has(appid)) {
        return interaction.editReply({
          content: '⚠️ Game already exists.',
          components: []
        });
      }

      addSteamGame(game);
      clearSearch(userId);

      return interaction.editReply({
        content: `✅ Added **${game.name}** (${game.appid})`,
        components: []
      });
    }

    if (id.startsWith('steam_search_prev:')) {
      const page = Math.max(0, state.page - 1);
      saveSearch(userId, state.results, page);
      return interaction.editReply(
        buildSearchPage(state.results, page, existing)
      );
    }

    if (id.startsWith('steam_search_next:')) {
      const page = state.page + 1;
      saveSearch(userId, state.results, page);
      return interaction.editReply(
        buildSearchPage(state.results, page, existing)
      );
    }

  } catch (err) {
    console.error('❌ Button error:', err);
  }
});

/* ================= LOGIN ================= */
if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN missing');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
