const ROLE_RANKS = { owner: 3, admin: 2, mod: 1, viewer: 0 };

function parseIds(value) {
  return new Set(String(value || '').split(',').map(v => v.trim()).filter(Boolean));
}

function configuredPermissionIds() {
  return {
    owners: parseIds(process.env.BOT_OWNER_IDS || process.env.OWNER_IDS),
    admins: parseIds(process.env.BOT_ADMIN_IDS || process.env.ADMIN_IDS),
    mods: parseIds(process.env.BOT_MOD_IDS || process.env.MOD_IDS)
  };
}

export function userControlRole(userId) {
  const { owners, admins, mods } = configuredPermissionIds();
  const anyConfigured = owners.size || admins.size || mods.size;

  if (!anyConfigured) return 'owner';
  if (owners.has(userId)) return 'owner';
  if (admins.has(userId)) return 'admin';
  if (mods.has(userId)) return 'mod';
  return 'viewer';
}

export function requiredRoleForCommand(commandName, subcommand = '') {
  if (['servers', 'status', 'info', 'webeditor', 'audit', 'console', 'disk'].includes(commandName)) {
    if (commandName === 'console' && ['clear'].includes(subcommand)) return 'admin';
    return 'viewer';
  }

  if (['start', 'stop', 'restart', 'group', 'steam', 'backup', 'schedule', 'mc'].includes(commandName)) {
    if (commandName === 'backup' && ['restore'].includes(subcommand)) return 'admin';
    if (commandName === 'steam' && ['addgame', 'removegame'].includes(subcommand)) return 'admin';
    return 'mod';
  }

  if (['config', 'template'].includes(commandName)) return 'admin';
  if (commandName === 'idrac') return subcommand === 'status' ? 'viewer' : 'admin';

  return 'admin';
}

export function canRunCommand(userId, commandName, subcommand = '') {
  const actual = userControlRole(userId);
  const required = requiredRoleForCommand(commandName, subcommand);
  return {
    ok: ROLE_RANKS[actual] >= ROLE_RANKS[required],
    actual,
    required
  };
}
