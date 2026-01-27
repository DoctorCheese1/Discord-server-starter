import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

/**
 * Build paged search UI for Steam registry results
 * @param {Array<{appid:number,name:string}>} results
 * @param {number} page
 * @param {Set<number>} existingAppIds
 */
export function buildSearchPage(results, page = 0, existingAppIds = new Set()) {
  const pageSize = 6; // safe with Discord limits
  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  const slice = results.slice(page * pageSize, page * pageSize + pageSize);

  if (!slice.length) {
    return {
      content: '❌ No results.',
      components: []
    };
  }

  const rows = [];
  let currentRow = new ActionRowBuilder();

  /* ---------- ADD GAME BUTTONS ---------- */
  for (const g of slice) {
    if (currentRow.components.length === 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }

    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`steam_addgame:${g.appid}`)
        .setLabel(`➕ ${g.name} (${g.appid})`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(existingAppIds.has(g.appid))
    );
  }

  if (currentRow.components.length) {
    rows.push(currentRow);
  }

  /* ---------- NAVIGATION ---------- */
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`steam_search_prev:${page}`)
        .setLabel('⬅ Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),

      new ButtonBuilder()
        .setCustomId(`steam_search_next:${page}`)
        .setLabel('Next ➡')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    )
  );

  return {
    content: `🔍 **Steam Registry Results** (Page ${page + 1}/${totalPages})`,
    components: rows.slice(0, 5) // hard Discord safety limit
  };
}
