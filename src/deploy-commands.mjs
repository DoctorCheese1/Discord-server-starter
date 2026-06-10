import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

import { steamGameChoices } from './steam/steamGameStore.mjs';
import { isIdracOnlyMode } from './mode.mjs';

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

function safeSteamGameChoices() {
  const c = steamGameChoices();
  return c.length ? c : [];
}

/* ================= BUILD ================= */
export function buildCommands() {
  const idracOnly = isIdracOnlyMode();

  if (idracOnly) {
    return [
      new SlashCommandBuilder()
        .setName('idrac')
        .setDescription('iDRAC power control')
        .setDMPermission(true)
        .addSubcommand(sc => sc.setName('status').setDescription('Power status'))
        .addSubcommand(sc => sc.setName('on').setDescription('Power on'))
        .addSubcommand(sc => sc.setName('off').setDescription('Power off').addBooleanOption(o => o.setName('confirm').setDescription('Required safety confirmation').setRequired(false)))
        .addSubcommand(sc => sc.setName('reboot').setDescription('Reboot').addBooleanOption(o => o.setName('confirm').setDescription('Required safety confirmation').setRequired(false)))
        .toJSON()
    ];
  }

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
      .setName('webeditor')
      .setDescription('Web editor utilities')
      .setDMPermission(true)
      .addSubcommand(sc =>
        sc.setName('status')
          .setDescription('Show web editor status and URL')
      )
      .addSubcommand(sc =>
        sc.setName('open')
          .setDescription('Build a deep link to open Web Editor on a server')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
              .setAutocomplete(true)
          )
      ),

    new SlashCommandBuilder()
      .setName('info')
      .setDescription('Server info')
      .setDMPermission(true)
.addStringOption(o =>
  o.setName('id')
   .setDescription('Server id')
   .setRequired(true)
   .setAutocomplete(true)
      ),

    new SlashCommandBuilder()
      .setName('start')
      .setDescription('Start server')
      .setDMPermission(true)
      .addStringOption(o =>
        o.setName('id')
          .setDescription('Server id')
          .setRequired(true)
          .setAutocomplete(true)
      ),

    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Stop server')
      .setDMPermission(true)
      .addStringOption(o =>
        o.setName('id')
          .setDescription('Server id')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addBooleanOption(o =>
        o.setName('confirm')
          .setDescription('Required safety confirmation for stop')
          .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName('restart')
      .setDescription('Restart server')
      .setDMPermission(true)
      .addStringOption(o =>
        o.setName('id')
          .setDescription('Server id')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addBooleanOption(o =>
        o.setName('confirm')
          .setDescription('Required safety confirmation for restart')
          .setRequired(false)
      ),



    new SlashCommandBuilder()
      .setName('console')
      .setDescription('Read or manage captured server console logs')
      .setDMPermission(true)
      .addSubcommand(sc =>
        sc.setName('tail')
          .setDescription('Show the last lines of a server console log')
          .addStringOption(o => o.setName('id').setDescription('Server id').setRequired(true).setAutocomplete(true))
          .addIntegerOption(o => o.setName('lines').setDescription('Number of lines').setRequired(false).setMinValue(1).setMaxValue(100))
      )
      .addSubcommand(sc =>
        sc.setName('search')
          .setDescription('Search a server console log')
          .addStringOption(o => o.setName('id').setDescription('Server id').setRequired(true).setAutocomplete(true))
          .addStringOption(o => o.setName('query').setDescription('Text to search for').setRequired(true))
      )
      .addSubcommand(sc =>
        sc.setName('clear')
          .setDescription('Clear a server console log')
          .addStringOption(o => o.setName('id').setDescription('Server id').setRequired(true).setAutocomplete(true))
          .addBooleanOption(o => o.setName('confirm').setDescription('Required safety confirmation').setRequired(false))
      ),

    new SlashCommandBuilder()
      .setName('backup')
      .setDescription('Create, list, and restore server folder backups')
      .setDMPermission(true)
      .addSubcommand(sc =>
        sc.setName('create')
          .setDescription('Copy a server folder into data/backups')
          .addStringOption(o => o.setName('id').setDescription('Server id').setRequired(true).setAutocomplete(true))
          .addStringOption(o => o.setName('label').setDescription('Optional backup label').setRequired(false))
      )
      .addSubcommand(sc =>
        sc.setName('list')
          .setDescription('List backups for a server')
          .addStringOption(o => o.setName('id').setDescription('Server id').setRequired(true).setAutocomplete(true))
      )
      .addSubcommand(sc =>
        sc.setName('restore')
          .setDescription('Restore a backup over the current server folder')
          .addStringOption(o => o.setName('id').setDescription('Server id').setRequired(true).setAutocomplete(true))
          .addStringOption(o => o.setName('name').setDescription('Backup name from /backup list').setRequired(true))
          .addBooleanOption(o => o.setName('confirm').setDescription('Required safety confirmation').setRequired(false))
      ),

    new SlashCommandBuilder()
      .setName('disk')
      .setDescription('Show server folder disk usage')
      .setDMPermission(true)
      .addSubcommand(sc =>
        sc.setName('summary')
          .setDescription('Show disk usage for one server or all servers')
          .addStringOption(o => o.setName('id').setDescription('Optional server id').setRequired(false).setAutocomplete(true))
      ),

    new SlashCommandBuilder()
      .setName('schedule')
      .setDescription('Schedule one server action after a delay')
      .setDMPermission(true)
      .addSubcommand(sc =>
        sc.setName('run')
          .setDescription('Schedule start, stop, restart, or Steam update')
          .addStringOption(o => o.setName('id').setDescription('Server id').setRequired(true).setAutocomplete(true))
          .addStringOption(o => o.setName('action').setDescription('Action').setRequired(true).addChoices(
            { name: 'start', value: 'start' },
            { name: 'stop', value: 'stop' },
            { name: 'restart', value: 'restart' },
            { name: 'update', value: 'update' }
          ))
          .addIntegerOption(o => o.setName('delay-minutes').setDescription('Delay before execution').setRequired(true).setMinValue(1).setMaxValue(1440))
      )
      .addSubcommand(sc => sc.setName('list').setDescription('List pending server schedules'))
      .addSubcommand(sc =>
        sc.setName('cancel')
          .setDescription('Cancel a pending server schedule')
          .addStringOption(o => o.setName('id').setDescription('Schedule id from /schedule list').setRequired(true))
      ),

    new SlashCommandBuilder()
      .setName('template')
      .setDescription('Generate starter scripts for a configured server folder')
      .setDMPermission(true)
      .addSubcommand(sc =>
        sc.setName('create')
          .setDescription('Create start.bat, stop.bat, and update.bat templates')
          .addStringOption(o => o.setName('id').setDescription('Server id').setRequired(true).setAutocomplete(true))
          .addStringOption(o => o.setName('type').setDescription('Template type').setRequired(true).addChoices(
            { name: 'generic', value: 'generic' },
            { name: 'minecraft', value: 'minecraft' },
            { name: 'proxy', value: 'proxy' },
            { name: 'steam', value: 'steam' }
          ))
          .addBooleanOption(o => o.setName('overwrite').setDescription('Overwrite existing scripts').setRequired(false))
      ),

    new SlashCommandBuilder()
      .setName('mc')
      .setDescription('Minecraft RCON helpers')
      .setDMPermission(true)
      .addSubcommand(sc =>
        sc.setName('players')
          .setDescription('Run list over RCON')
          .addStringOption(o => o.setName('id').setDescription('Server id').setRequired(true).setAutocomplete(true))
      )
      .addSubcommand(sc =>
        sc.setName('say')
          .setDescription('Broadcast a message over RCON')
          .addStringOption(o => o.setName('id').setDescription('Server id').setRequired(true).setAutocomplete(true))
          .addStringOption(o => o.setName('message').setDescription('Message').setRequired(true))
      )
      .addSubcommand(sc =>
        sc.setName('command')
          .setDescription('Run a raw RCON command')
          .addStringOption(o => o.setName('id').setDescription('Server id').setRequired(true).setAutocomplete(true))
          .addStringOption(o => o.setName('command').setDescription('Command without slash').setRequired(true))
      ),

    new SlashCommandBuilder()
      .setName('group')
      .setDescription('Group operations for organized server control')
      .setDMPermission(true)
      .addSubcommand(sc =>
        sc.setName('list')
          .setDescription('List servers by group (or all grouped servers)')
          .addStringOption(o =>
            o.setName('name')
              .setDescription('Optional group name filter')
              .setRequired(false)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(sc =>
        sc.setName('add')
          .setDescription('Assign one server (or all enabled servers) to a group')
          .addStringOption(o =>
            o.setName('name')
              .setDescription('Group name')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Optional server id (leave empty to apply to all enabled servers)')
              .setRequired(false)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(sc =>
        sc.setName('remove')
          .setDescription('Remove a server from its group')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(sc =>
        sc.setName('start')
          .setDescription('Start all servers in a group (or one server in that group)')
          .addStringOption(o =>
            o.setName('name')
              .setDescription('Group name')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Optional single server id in that group')
              .setRequired(false)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(sc =>
        sc.setName('stop')
          .setDescription('Stop all servers in a group (or one server in that group)')
          .addStringOption(o =>
            o.setName('name')
              .setDescription('Group name')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Optional single server id in that group')
              .setRequired(false)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(sc =>
        sc.setName('restart')
          .setDescription('Restart all servers in a group (or one server in that group)')
          .addStringOption(o =>
            o.setName('name')
              .setDescription('Group name')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Optional single server id in that group')
              .setRequired(false)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(sc =>
        sc.setName('health')
          .setDescription('Show health summary for a group')
          .addStringOption(o =>
            o.setName('name')
              .setDescription('Group name')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(sc =>
        sc.setName('update')
          .setDescription('Update Steam servers in a group')
          .addStringOption(o =>
            o.setName('name')
              .setDescription('Group name')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )
      .addSubcommand(sc =>
        sc.setName('schedule')
          .setDescription('Schedule a group action after a delay')
          .addStringOption(o =>
            o.setName('name')
              .setDescription('Group name')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption(o =>
            o.setName('action')
              .setDescription('Action to run')
              .setRequired(true)
              .addChoices(
                { name: 'start', value: 'start' },
                { name: 'stop', value: 'stop' },
                { name: 'restart', value: 'restart' },
                { name: 'update', value: 'update' }
              )
          )
          .addIntegerOption(o =>
            o.setName('delay-minutes')
              .setDescription('Delay before execution')
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(1440)
          )
      ),

    new SlashCommandBuilder()
      .setName('audit')
      .setDescription('Audit trail utilities')
      .setDMPermission(true)
      .addSubcommand(sc =>
        sc.setName('recent')
          .setDescription('Show recent bot control actions')
      ),

    /* ===== CONFIG ===== */
    new SlashCommandBuilder()
      .setName('config')
      .setDescription('Server configuration')
      .setDMPermission(true)

      .addSubcommand(sc =>
        sc
          .setName('list')
          .setDescription('List servers')
          .addBooleanOption(o =>
            o.setName('all')
             .setDescription('Include disabled servers')
          )
          .addStringOption(o =>
            o.setName('type')
             .setDescription('Filter by server type')
             .addChoices(
               { name: 'minecraft', value: 'minecraft' },
               { name: 'steam', value: 'steam' },
               { name: 'proxy', value: 'proxy' },
               { name: 'generic', value: 'generic' }
             )
          )
          .addStringOption(o =>
            o.setName('group')
             .setDescription('Filter by custom group label')
             .setAutocomplete(true)
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
              .setAutocomplete(true)
          )
      )

      .addSubcommand(sc =>
        sc.setName('disable')
          .setDescription('Disable server')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )

      .addSubcommand(sc =>
        sc.setName('rename')
          .setDescription('Rename server')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
              .setAutocomplete(true)
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
              .setAutocomplete(true)
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
              .setAutocomplete(true)
          )
          .addBooleanOption(o =>
            o.setName('value')
              .setDescription('Enable Steam')
              .setRequired(true)
          )
      )

      .addSubcommand(sc =>
        sc.setName('set-group')
          .setDescription('Set custom group label')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption(o =>
            o.setName('group')
              .setDescription('Group label (example: network-a)')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )

      .addSubcommand(sc =>
        sc.setName('set-process')
          .setDescription('Set process image name fallback (ex: java.exe, ShooterGameServer.exe)')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption(o =>
            o.setName('name')
              .setDescription('Process image name')
              .setRequired(true)
          )
      )

      .addSubcommand(sc =>
        sc.setName('set-rcon')
          .setDescription('Set Minecraft RCON connection settings')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption(o =>
            o.setName('host')
              .setDescription('RCON host (default 127.0.0.1)')
              .setRequired(false)
          )
          .addIntegerOption(o =>
            o.setName('port')
              .setDescription('RCON port (default 25575)')
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(65535)
          )
          .addStringOption(o =>
            o.setName('password')
              .setDescription('RCON password')
              .setRequired(false)
          )
      )

      .addSubcommand(sc =>
        sc.setName('set-dir')
          .setDescription('Set server folder path (also updates name to folder name)')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption(o =>
            o.setName('dir')
              .setDescription('Absolute or relative folder path')
              .setRequired(true)
          )
      )

      .addSubcommand(sc =>
        sc.setName('remove')
          .setDescription('Remove server from config')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addBooleanOption(o =>
            o.setName('confirm')
              .setDescription('Required safety confirmation')
              .setRequired(false)
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
        sc.setName('update')
          .setDescription('Update one Steam server or all Steam servers')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id (optional when using all=true)')
              .setRequired(false)
              .setAutocomplete(true)
          )
          .addBooleanOption(o =>
            o.setName('all')
              .setDescription('Update all enabled Steam servers')
              .setRequired(false)
          )
      )

      .addSubcommand(sc =>
        sc.setName('open')
          .setDescription('Open server folder in Explorer')
          .addStringOption(o =>
            o.setName('id')
              .setDescription('Server id')
              .setRequired(true)
              .setAutocomplete(true)
          )
      )

      .addSubcommand(sc =>
        sc.setName('search')
          .setDescription('Search registered Steam games')
          .addStringOption(o =>
            o.setName('query')
              .setDescription('Game name or AppID')
              .setRequired(true)
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
      .addSubcommand(sc => sc.setName('off').setDescription('Power off').addBooleanOption(o => o.setName('confirm').setDescription('Required safety confirmation').setRequired(false)))
      .addSubcommand(sc => sc.setName('reboot').setDescription('Reboot').addBooleanOption(o => o.setName('confirm').setDescription('Required safety confirmation').setRequired(false))),
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
