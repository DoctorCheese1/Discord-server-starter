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


function parseModrinthProjectRef(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const directMatch = raw.match(/modrinth\.com\/(?:plugin|project)\/([^/?#]+)/i);
  return (directMatch?.[1] || raw).trim();
}

async function fetchModrinthProject(ref) {
  const projectRef = parseModrinthProjectRef(ref);
  if (!projectRef) return null;
  try {
    return await fetchJson(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectRef)}`);
  } catch {
    return null;
  }
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
  let project = await fetchModrinthProject(query);

  if (!project?.id) {
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
    project = { id: hit.project_id, slug: hit.slug, title: hit.title || hit.slug || query };
  }

  const versions = await fetchJson(`https://api.modrinth.com/v2/project/${project.id}/version`);
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
    plugin: project.title || project.slug || query,
    projectId: project.id,
    projectSlug: project.slug || '',
    url: file.url,
    versionId: String(selected.id || selected.version_number || '').trim(),
    versionNumber: selected.version_number || 'unknown',
    minecraftVersion: (selected.game_versions || [mcVersion]).find(Boolean) || 'unknown',
    loader: (selected.loaders || [platform]).find(Boolean) || platform,
    loaders: Array.isArray(selected.loaders) ? selected.loaders : [],
    projectUrl: project.slug ? `https://modrinth.com/plugin/${project.slug}` : (project.id ? `https://modrinth.com/project/${project.id}` : ''),
    releaseNotesUrl: project.slug ? `https://modrinth.com/plugin/${project.slug}/changelog` : '',
    note: 'Result chosen from Modrinth plugin releases.'
  };
}

async function resolveSpigotPlugin({ query, mcVersion }) {
  const resourceId = parseSpigotResourceId(query);
  if (!resourceId) {
    throw new Error('For Spigot, provide a resource ID or full Spigot resource URL.');
  }

  const details = await fetchJson(`https://api.spiget.org/v2/resources/${resourceId}`);
  const latestVersion = await fetchJson(`https://api.spiget.org/v2/resources/${resourceId}/versions/latest`).catch(() => null);
  const latestVersionLabel = String(latestVersion?.name || latestVersion?.id || 'latest').trim() || 'latest';
  const latestVersionId = String(latestVersion?.id || latestVersion?.name || '').trim();
  const premium = Boolean(details.premium);
  const external = Boolean(details.external);
  const resourceUrl = `https://www.spigotmc.org/resources/${resourceId}/`;
  if (premium) {
    return {
      source: 'spigot',
      plugin: details.name || `resource-${resourceId}`,
      projectId: resourceId,
      projectSlug: '',
      url: details?.file?.url ? `https://www.spigotmc.org/${String(details.file.url).replace(/^\/+/, '')}` : `${resourceUrl}download`,
      resourceUrl,
      releaseNotesUrl: `${resourceUrl}updates`,
      versionId: latestVersionId,
      versionNumber: latestVersionLabel,
      minecraftVersion: mcVersion || 'latest supported',
      loader: 'spigot',
      paid: true,
      external,
      note: 'Paid Spigot resources require browser-backed cookies. Prefer full cookie header (including cf_clearance), or xf_user + xf_session + xf_tfa_trust.'
    };
  }
  const downloadUrl = `https://api.spiget.org/v2/resources/${resourceId}/download`;

  return {
    source: 'spigot',
    plugin: details.name || `resource-${resourceId}`,
    projectId: resourceId,
    projectSlug: '',
    url: downloadUrl,
    resourceUrl,
    releaseNotesUrl: `${resourceUrl}updates`,
    versionId: latestVersionId,
    versionNumber: latestVersionLabel,
    minecraftVersion: mcVersion || 'latest supported',
    loader: 'spigot',
    paid: false,
    external,
    note: external
      ? 'This Spigot resource uses an external download link; if direct download fails, open the resource page.'
      : 'Spigot link always points to the latest resource file via Spiget API.'
  };
}

export async function getPluginDownloadLink({ source, query, mcVersion, platform }) {
  const selectedSource = String(source || '').trim().toLowerCase();
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) {
    throw new Error('Plugin name, slug, or URL is required.');
  }

  if (selectedSource === 'modrinth') {
    try {
      return await resolveModrinthPlugin({
        query: normalizedQuery,
        mcVersion: String(mcVersion || '').trim(),
        platform: normalizePlatform(platform)
      });
    } catch (error) {
      const message = String(error?.message || '');
      const shouldFallbackToSpigot = message.includes('No Modrinth plugin found');
      if (!shouldFallbackToSpigot) throw error;
      return resolveSpigotPlugin({
        query: normalizedQuery,
        mcVersion: String(mcVersion || '').trim()
      });
    }
  }

  if (selectedSource === 'spigot') {
    return resolveSpigotPlugin({
      query: normalizedQuery,
      mcVersion: String(mcVersion || '').trim()
    });
  }

  throw new Error(`Unsupported source: ${selectedSource}`);
}
