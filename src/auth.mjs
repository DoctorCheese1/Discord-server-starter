export function isOwner(interaction) {
  const owners = process.env.OWNER_IDS.split(',');
  return owners.includes(interaction.user.id);
}
