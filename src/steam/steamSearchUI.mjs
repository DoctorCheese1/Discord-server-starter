import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const PAGE_SIZE = 10;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightQuery(text, query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return text;

  const pattern = new RegExp(`(${escapeRegExp(trimmed)})`, 'ig');
  return String(text).replace(pattern, '`$1`');
}

export function buildSearchPage(results, page = 0, existing = new Set(), query = '') {
  const safePage = Math.max(0, Number(page) || 0);
  const start = safePage * PAGE_SIZE;
  const chunk = results.slice(start, start + PAGE_SIZE);

  const content = chunk.length
    ? chunk
      .map(g => {
        const highlightedName = highlightQuery(g.name, query);
        const highlightedAppId = highlightQuery(String(g.appid), query);
        return `${existing.has(g.appid) ? '✅' : '•'} ${highlightedName} (${highlightedAppId})`;
      })
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
