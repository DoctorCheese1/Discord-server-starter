import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

import { serverChoices } from './serverStore.mjs';
import { steamGameChoices } from './steam/steamGameStore.mjs';

/* ================= PATHS ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

/* ================= ENV ================= */
dotenv.config({ path: path.join(ROOT, '.env') });

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ Missing DISCORD_TOKEN or CLIENT_ID');
  process.exit(1);
}

/* ================= SAFE CHOICES ================= */

function safeServerChoices(opts) {
  const c = serverChoices(opts);
  return c.length ? c : [];
}

function safeSteamGameChoices() {
  const c = steamGameChoices();
  return c.length ? c : [];
}

/* ================= BUILD ================= */
export function buildCommands() {
  const cmds = [

    /* ===== BASIC ===== */
    new SlashCommandBuilder()
      .setName('servers')
      .setDescription('List servers')
      .setDMPermission(true),

    new SlashCommandBuilder()
      .setName('status')
      .setDescription('System & server status')
      .setDMPermission(true),

    new SlashCommandBuilder()
      .setName('info')
      .setDescription('Server info')
      .setDMPermission(true)
      .addStringOption(o =>
        o.setName('id')
          .setDescription('Server id')
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('start')
      .setDescription('Start server')
      .setDMPermission(true)
      .addStringOption(o =>
        o.setName('id')
          .setDescription('Server id')
          .setRequired(true)
          .addChoices(...safeServerChoices())
      ),

    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Stop server')
      .setDMPermission(true)
      .addStringOption(o =>
        o.setName('id')
          .setDescription('Server id')
          .setRequired(true)
          .addChoices(...safeServerChoices())
      ),

    new SlashCommandBuilder()
      .setName('restart')
      .setDescription('Restart server')
      .setDMPermission(true)
      .addStringOption(o =>
        o.setName('id')
          .setDescription('Server id')
          .setRequired(true)
          .addChoices(...safeServerChoices())
      ),

    /* ===== CONFIG ===== */
    new SlashCommandBuilder()
      .setName('config')
      .setDescription('Server configuration')
      .setDMPermission(true)

      .addSubcommand(sc =>
        sc.setName('list')
          .setDescription('List servers')
          .addBooleanOption(o =>
            o.setName('all')
              .setDescription('Include disabled servers')
          )
          .addStringOption(o =>
            o.setName('type')
              .setDescription('Filter by server type')
          )
      )

      .addSubcommand(sc =>
        sc.setName('validate')
          .setDescription('Validate server config')
      )

      .addSubcommand(sc =>
        sc.setName('enable')
          .setDescription('Enable server')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
              .addChoices(...safeServerChoices())
          )
      )

      .addSubcommand(sc =>
        sc.setName('disable')
          .setDescription('Disable server')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
              .addChoices(...safeServerChoices())
          )
      )

      .addSubcommand(sc =>
        sc.setName('rename')
          .setDescription('Rename server')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
              .addChoices(...safeServerChoices())
          )
          .addStringOption(o =>
            o.setName('name')
              .setDescription('New server name')
              .setRequired(true)
          )
      )

      .addSubcommand(sc =>
        sc.setName('set-java')
          .setDescription('Set Java flag')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
              .addChoices(...safeServerChoices())
          )
          .addBooleanOption(o =>
            o.setName('value')
              .setDescription('Enable Java')
              .setRequired(true)
          )
      )

      .addSubcommand(sc =>
        sc.setName('set-steam')
          .setDescription('Set Steam flag')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
              .addChoices(...safeServerChoices())
          )
          .addBooleanOption(o =>
            o.setName('value')
              .setDescription('Enable Steam')
              .setRequired(true)
          )
      ),

    /* ===== STEAM ===== */
    new SlashCommandBuilder()
      .setName('steam')
      .setDescription('Steam server management')
      .setDMPermission(true)

      .addSubcommand(sc =>
        sc.setName('list')
          .setDescription('List registered Steam games')
      )

      .addSubcommand(sc =>
        sc.setName('add')
          .setDescription('Install a Steam dedicated server')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
          )
          .addIntegerOption(o =>
            o.setName('appid')
              .setDescription('Steam AppID')
              .setRequired(true)
              .addChoices(...safeSteamGameChoices())
          )
          .addStringOption(o =>
            o.setName('dir')
              .setDescription('Optional install dir (defaults to STEAM_BASE_DIR/id)')
          )
      )

      .addSubcommand(sc =>
        sc.setName('update')
          .setDescription('Update a Steam server')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
              .addChoices(...safeServerChoices({ steamOnly: true }))
          )
      )

      .addSubcommand(sc =>
        sc.setName('open')
          .setDescription('Open server folder in Explorer')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
              .addChoices(...safeServerChoices({ steamOnly: true }))
          )
      )

      .addSubcommand(sc =>
        sc.setName('addgame')
          .setDescription('Register a Steam game')
          .addStringOption(o =>
            o.setName('name')
              .setDescription('Game name')
              .setRequired(true)
          )
          .addIntegerOption(o =>
            o.setName('appid')
              .setDescription('Steam AppID')
              .setRequired(true)
          )
      )

      .addSubcommand(sc =>
        sc.setName('removegame')
          .setDescription('Remove a Steam game')
          .addIntegerOption(o =>
            o.setName('appid')
              .setDescription('Steam AppID')
              .setRequired(true)
          )
      ),

    /* ===== IDRAC ===== */
    new SlashCommandBuilder()
      .setName('idrac')
      .setDescription('iDRAC power control')
      .setDMPermission(true)
      .addSubcommand(sc => sc.setName('status').setDescription('Power status'))
      .addSubcommand(sc => sc.setName('on').setDescription('Power on'))
      .addSubcommand(sc => sc.setName('off').setDescription('Power off'))
      .addSubcommand(sc => sc.setName('reboot').setDescription('Reboot')),
  ];

  return cmds.map(c => c.toJSON());
}

/* ================= SIGNATURE ================= */
export function getCommandSignature() {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(buildCommands()))
    .digest('hex');
}

/* ================= DEPLOY ================= */
export async function deployCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);

  console.log('⏳ Deploying commands…');
  await rest.put(route, { body: buildCommands() });
  console.log('✅ Commands deployed');
}

if (process.argv[1]?.endsWith('deploy-commands.mjs')) {
  deployCommands().catch(err => {
    console.error('❌ Deploy failed:', err);
    process.exit(1);
  });
}
