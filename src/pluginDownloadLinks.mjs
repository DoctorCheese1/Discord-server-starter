const USER_AGENT = 'ServerControlBot/2.0 (plugin download helper)';

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

function parseSpigotResourceId(input) {
  const raw = String(input || '').trim();
  if (/^\d+$/.test(raw)) return raw;

  const match = raw.match(/spigotmc\.org\/resources\/[^./]+\.([0-9]+)\//i)
    || raw.match(/spigotmc\.org\/resources\/([0-9]+)/i)
    || raw.match(/spiget\.org\/resources\/([0-9]+)/i);
  return match?.[1] || '';
}

function normalizePlatform(platform) {
  const value = String(platform || '').trim().toLowerCase();
  if (!value) return 'paper';
  return value;
}

function modrinthLoaderCandidates(platform) {
  const selected = normalizePlatform(platform);
  const preferred = ['paper', 'purpur', 'folia', 'spigot', 'bukkit'];
  const ecosystem = ['velocity', 'waterfall', 'bungeecord', 'sponge', 'fabric', 'quilt', 'forge', 'neoforge'];
  return [...new Set([selected, ...preferred, ...ecosystem])];
}

function chooseModrinthVersion(versions, mcVersion, platform) {
  const candidates = Array.isArray(versions) ? versions : [];
  const loaders = modrinthLoaderCandidates(platform);
  const requestedMc = String(mcVersion || '').trim();

  const ranked = candidates
    .map(v => {
      const vLoaders = Array.isArray(v.loaders) ? v.loaders.map(x => String(x).toLowerCase()) : [];
      const vGames = Array.isArray(v.game_versions) ? v.game_versions : [];
      const loaderRank = loaders.findIndex(loader => vLoaders.includes(loader));
      const matchesLoader = loaderRank >= 0;
      const matchesMc = !requestedMc || vGames.includes(requestedMc);
      if (!matchesLoader || !matchesMc) return null;
      return { version: v, loaderRank };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.loaderRank !== b.loaderRank) return a.loaderRank - b.loaderRank;
      return new Date(b.version.date_published).getTime() - new Date(a.version.date_published).getTime();
    });

  return ranked[0]?.version || null;
}

async function resolveModrinthPlugin({ query, mcVersion, platform }) {
  const searchUrl = new URL('https://api.modrinth.com/v2/search');
  searchUrl.searchParams.set('query', query);
  searchUrl.searchParams.set('limit', '10');
  searchUrl.searchParams.set('index', 'relevance');
  searchUrl.searchParams.set('facets', JSON.stringify([['project_type:plugin']]));
  const search = await fetchJson(searchUrl.toString());
  const hit = (search.hits || [])[0];
  if (!hit?.project_id) {
    throw new Error(`No Modrinth plugin found for "${query}".`);
  }

  const versions = await fetchJson(`https://api.modrinth.com/v2/project/${hit.project_id}/version`);
  const selected = chooseModrinthVersion(versions, mcVersion, platform);
  if (!selected) {
    throw new Error(
      mcVersion
        ? `No Modrinth release found for ${platform} on Minecraft ${mcVersion}.`
        : `No compatible Modrinth release found for ${platform}.`
    );
  }

  const file = (selected.files || []).find(f => f.primary) || selected.files?.[0];
  if (!file?.url) {
    throw new Error('Selected Modrinth version does not provide a downloadable file.');
  }

  return {
    source: 'modrinth',
    plugin: hit.title || hit.slug || query,
    projectId: hit.project_id,
    projectSlug: hit.slug || '',
    url: file.url,
    versionNumber: selected.version_number || 'unknown',
    minecraftVersion: (selected.game_versions || [mcVersion]).find(Boolean) || 'unknown',
    loader: (selected.loaders || [platform]).find(Boolean) || platform,
    loaders: Array.isArray(selected.loaders) ? selected.loaders : [],
    note: 'Result chosen from Modrinth plugin releases.'
  };
}

async function resolveSpigotPlugin({ query, mcVersion }) {
  const resourceId = parseSpigotResourceId(query);
  if (!resourceId) {
    throw new Error('For Spigot, provide a resource ID or full Spigot resource URL.');
  }

  const details = await fetchJson(`https://api.spiget.org/v2/resources/${resourceId}`);
  const downloadUrl = `https://api.spiget.org/v2/resources/${resourceId}/download`;

  return {
    source: 'spigot',
    plugin: details.name || `resource-${resourceId}`,
    projectId: resourceId,
    projectSlug: '',
    url: downloadUrl,
    versionNumber: 'latest',
    minecraftVersion: mcVersion || 'latest supported',
    loader: 'spigot',
    note: 'Spigot link always points to the latest resource file.'
  };
}

export async function getPluginDownloadLink({ source, query, mcVersion, platform }) {
  const selectedSource = String(source || '').trim().toLowerCase();
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) {
    throw new Error('Plugin name, slug, or URL is required.');
  }

  if (selectedSource === 'modrinth') {
    return resolveModrinthPlugin({
      query: normalizedQuery,
      mcVersion: String(mcVersion || '').trim(),
      platform: normalizePlatform(platform)
    });
  }

  if (selectedSource === 'spigot') {
    return resolveSpigotPlugin({
      query: normalizedQuery,
      mcVersion: String(mcVersion || '').trim()
    });
  }

  throw new Error(`Unsupported source: ${selectedSource}`);
}
