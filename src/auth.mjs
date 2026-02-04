export function isOwner(interaction) {
  const owners = process.env.OWNER_IDS.split(',');
  return owners.includes(interaction.user.id);
}

export function isAdmin(interaction) {
  const admins = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
  return admins.includes(interaction.user.id);
}

// Utility to reload owner/admin IDs from environment (for hot-reload scenarios)
export function reloadAuthEnv() {
  if (process.env.OWNER_IDS) {
    global._OWNER_IDS = process.env.OWNER_IDS.split(',');
  }
  if (process.env.ADMIN_IDS) {
    global._ADMIN_IDS = process.env.ADMIN_IDS.split(',');
  }
}
