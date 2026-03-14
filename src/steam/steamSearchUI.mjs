import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const PAGE_SIZE = 10;

export function buildSearchPage(results, page = 0, existing = new Set()) {
  const safePage = Math.max(0, Number(page) || 0);
  const start = safePage * PAGE_SIZE;
  const chunk = results.slice(start, start + PAGE_SIZE);

  const content = chunk.length
    ? chunk
      .map(g => `${existing.has(g.appid) ? '✅' : '•'} **${g.name}** (${g.appid})`)
      .join('\n')
    : '❌ No results on this page.';

  const prev = new ButtonBuilder()
    .setCustomId(`steam_search_prev:${safePage}`)
    .setLabel('Prev')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(safePage <= 0);

  const next = new ButtonBuilder()
    .setCustomId(`steam_search_next:${safePage}`)
    .setLabel('Next')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(start + PAGE_SIZE >= results.length);

  return {
    content: `🔎 Steam search (${results.length} result${results.length === 1 ? '' : 's'})\n${content}`,
    components: [new ActionRowBuilder().addComponents(prev, next)]
  };
}
