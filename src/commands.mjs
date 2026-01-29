import {
  loadServers,
  getServer,
  addServer,
  removeServer,
  setServer,
  loadRawConfig
} from './serverStore.mjs';

import {
  listSteamGames,
  addSteamGame,
  removeSteamGame
} from './steam/steamGameStore.mjs';

import {
  saveSearch
} from './steam/steamSearchState.mjs';

import {
  buildSearchPage
} from './steam/steamSearchUI.mjs';

import {
  getIdracStatus,
  idracPower
} from './idrac-racadm.mjs';

/* ======================================================
   MAIN HANDLER
====================================================== */

export async function handleCommand(interaction) {
  const cmd = interaction.commandName;

  /* ======================================================
     BASIC
  ====================================================== */

  if (cmd === 'servers') {
    const servers = loadServers({ includeDisabled: true });

    if (!servers.length) {
      return interaction.editReply('❌ No servers configured.');
    }

    return interaction.editReply(
      servers
        .map(s => `${s.enabled ? '🟢' : '🔴'} **${s.name}** (${s.id})`)
        .join('\n')
    );
  }

  if (cmd === 'status') {
    const servers = loadServers({ includeDisabled: true });
    return interaction.editReply(
      servers.length
        ? servers.map(s => `• ${s.name}`).join('\n')
        : 'No servers configured.'
    );
  }

  if (cmd === 'info') {
    const id = interaction.options.getString('id');
    const server = getServer(id);

    if (!server) {
      return interaction.editReply('❌ Server not found.');
    }

    return interaction.editReply(
      `**${server.name}**\n` +
      `ID: \`${server.id}\`\n` +
      `Type: ${server.type ?? 'unknown'}\n` +
      `Enabled: ${server.enabled ? 'Yes' : 'No'}\n` +
      `CWD: ${server.cwd}`
    );
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

    return interaction.editReply(
      `🛠 **${cmd.toUpperCase()}** requested for **${server.name}**`
    );
    // actual execution handled by your process manager
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

      return interaction.editReply(
        servers
          .map(s => `${s.enabled ? '🟢' : '🔴'} **${s.name}** (${s.id})`)
          .join('\n')
      );
    }

    if (sub === 'validate') {
      const raw = loadRawConfig();
      return interaction.editReply(
        `✅ Config valid\nServers: ${raw.servers.length}`
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
      return interaction.editReply(`✅ Java flag updated.`);
    }

    if (sub === 'set-steam') {
      const id = interaction.options.getString('id');
      const value = interaction.options.getBoolean('value');
      setServer(id, { steam: value });
      return interaction.editReply(`✅ Steam flag updated.`);
    }
  }

  /* ======================================================
     STEAM (LOCAL REGISTRY)
  ====================================================== */

  if (cmd === 'steam') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const games = listSteamGames();

      if (!games.length) {
        return interaction.editReply('❌ No Steam games registered.');
      }

      return interaction.editReply(
        games.map(g => `• **${g.name}** (${g.appid})`).join('\n')
      );
    }

    if (sub === 'search') {
      const query = interaction.options.getString('query').toLowerCase();
      const games = listSteamGames();

      const results = games.filter(g =>
        g.name.toLowerCase().includes(query) ||
        String(g.appid).includes(query)
      );

      if (!results.length) {
        return interaction.editReply(
          '❌ No dedicated servers found.\nUse `/steam addgame` to add one.'
        );
      }

      saveSearch(interaction.user.id, results, 0);

      const existing = new Set(games.map(g => g.appid));
      return interaction.editReply(
        buildSearchPage(results, 0, existing)
      );
    }

    if (sub === 'addgame') {
      const appid = interaction.options.getInteger('appid');
      const name = interaction.options.getString('name');

      addSteamGame({ appid, name });
      return interaction.editReply(
        `✅ Added **${name}** (${appid})`
      );
    }

    if (sub === 'removegame') {
      const appid = interaction.options.getInteger('appid');
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
