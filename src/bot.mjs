import dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';

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

/* ================= CLIENT ================= */
const client = new Client({
  intents: [GatewayIntentBits.DirectMessages]
});

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ DM-only bot online as ${client.user.tag}`);

  try {
    await autoDeployIfEnabled();
  } catch (err) {
    console.error('❌ Auto-deploy failed:', err);
  }

  startPresenceLoop(client);
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

/* ================= LOGIN (THIS WAS MISSING) ================= */
if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN missing');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
