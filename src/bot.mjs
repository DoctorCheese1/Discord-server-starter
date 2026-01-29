import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder
} from 'discord.js';

import { autoDeployIfEnabled } from './autoDeploy.mjs';
import { startPresenceLoop } from './presence.mjs';
import { handleCommand } from './commands.mjs';

import {
  getSearch,
  saveSearch,
  clearSearch
} from './steam/steamSearchState.mjs';

import {
  addSteamGame,
  listSteamGames
} from './steam/steamGameStore.mjs';

import { buildSearchPage } from './steam/steamSearchUI.mjs';

/* ================= ENV ================= */
dotenv.config({
  path: new URL('../.env', import.meta.url)
});

/* ================= PATHS ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const AUTH_FILE = path.join(ROOT, 'data', 'authUsers.json');
const AUTH_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

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

/* ================= CLIENT ================= */
const client = new Client({
  intents: [GatewayIntentBits.DirectMessages]
});

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ DM-only bot online as ${client.user.tag}`);

  // ---------- AUTO DEPLOY ----------
  try {
    await autoDeployIfEnabled();
  } catch (err) {
    console.error('❌ Auto-deploy failed:', err);
  }

  // ---------- PRESENCE ----------
  startPresenceLoop(client);

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

      // ⏱ Only once per hour
      if (now - lastSeen < AUTH_CHECK_INTERVAL) continue;

      try {
        const user = await client.users.fetch(userId);

        if (!entry.welcomed) {
          const embed = new EmbedBuilder()
            .setTitle('👋 Welcome to Server Starter 2.0')
            .setDescription(
              `Your app authorization is active.\n\n` +
              `**Quick start:**\n` +
              `• \`/servers\` — View all servers\n` +
              `• \`/status\` — System & server health\n` +
              `• \`/steam add\` — Install a Steam server\n` +
              `• \`/idrac status\` — Check power state\n\n` +
              `This welcome message is sent **once per authorization**.`
            )
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
  // SLASH COMMANDS
  if (interaction.isChatInputCommand()) {
    try {
      await interaction.deferReply({ ephemeral: true });
      await handleCommand(interaction);
    } catch (err) {
      console.error('❌ Command error:', err);
    }
    return;
  }

  // BUTTONS
  if (!interaction.isButton()) return;

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
