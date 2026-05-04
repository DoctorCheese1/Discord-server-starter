import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadServers } from './serverStore.mjs';
import { getPluginDownloadLink } from './pluginDownloadLinks.mjs';

const TEXT_EXTENSIONS = new Set([
  '.txt', '.json', '.cfg', '.ini', '.properties', '.yaml', '.yml', '.xml', '.bat', '.sh', '.log', '.conf', '.toml'
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024; // 2MB
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_EDITOR_TEMPLATE_FILE = path.join(__dirname, 'webEditor.html');
const WEB_EDITOR_CSS_FILE = path.join(__dirname, 'webEditor.css');

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendCss(res, css) {
  res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
  res.end(css);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 2 * MAX_FILE_BYTES) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function isAuthorized(req, apiKey) {
  if (!apiKey) return true;
  const url = new URL(req.url, 'http://localhost');
  const fromQuery = url.searchParams.get('key');
  const fromHeader = req.headers['x-api-key'];
  return fromQuery === apiKey || fromHeader === apiKey;
}


function isEditorShellRequest(req, pathname) {
  return req.method === 'GET' && pathname === '/';
}

function findServer(serverId) {
  return loadServers({ includeDisabled: true }).find(s => s.id === serverId);
}

function isSafePath(baseDir, requestedPath) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(baseDir, requestedPath);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(`${resolvedBase}${path.sep}`);
}

function getFileEditability(fullPath) {
  if (!fs.existsSync(fullPath)) {
    return { editable: false, reason: `${path.basename(fullPath)} cannot be edited (not found)` };
  }

  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    return { editable: false, reason: `${path.basename(fullPath)} cannot be edited (directory)` };
  }
  if (!stat.isFile()) {
    return { editable: false, reason: `${path.basename(fullPath)} cannot be edited (unsupported type)` };
  }
  if (stat.size > MAX_FILE_BYTES) {
    return { editable: false, reason: `${path.basename(fullPath)} cannot be edited (file too large)` };
  }

  const ext = path.extname(fullPath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) {
    return {
      editable: false,
      reason: `${path.basename(fullPath)} cannot be edited (unsupported extension: ${ext || 'none'})`
    };
  }

  return { editable: true, reason: '' };
}

function isPathInside(candidatePath, containerPath) {
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedContainer = path.resolve(containerPath);
  return resolvedCandidate === resolvedContainer || resolvedCandidate.startsWith(`${resolvedContainer}${path.sep}`);
}

function copyRecursiveSync(sourceFull, targetFull) {
  const sourceStat = fs.statSync(sourceFull);
  if (sourceStat.isDirectory()) {
    fs.mkdirSync(targetFull, { recursive: true });
    const entries = fs.readdirSync(sourceFull, { withFileTypes: true });
    for (const entry of entries) {
      const nextSource = path.join(sourceFull, entry.name);
      const nextTarget = path.join(targetFull, entry.name);
      copyRecursiveSync(nextSource, nextTarget);
    }
    return;
  }

  fs.mkdirSync(path.dirname(targetFull), { recursive: true });
  fs.copyFileSync(sourceFull, targetFull);
}

function listFiles(cwd, maxDepth = 12) {
  const results = [];
  const emptyFolders = [];

  function walk(currentDir, depth, prefix = '') {
    if (depth > maxDepth) return false;

    let subtreeHasVisibleEntries = false;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (walk(full, depth + 1, rel)) {
          subtreeHasVisibleEntries = true;
        }
        continue;
      }

      const editability = getFileEditability(full);
      results.push({ path: rel, editable: editability.editable, reason: editability.reason });
      subtreeHasVisibleEntries = true;
    }

    if (!subtreeHasVisibleEntries && prefix) {
      emptyFolders.push(prefix);
    }
    return subtreeHasVisibleEntries;
  }

  walk(cwd, 0);
  return {
    files: results.sort((a, b) => a.path.localeCompare(b.path)),
    emptyFolders: emptyFolders.sort()
  };
}

function fileMatchesTerm(filePath, term) {
  const pathLower = String(filePath || '').toLowerCase();
  const termLower = String(term || '').toLowerCase().trim();
  if (!termLower) return true;
  return pathLower.includes(termLower);
}

function listSearchableFiles(cwd, baseFolder = '') {
  const maxDepth = Number(process.env.WEB_EDITOR_MAX_DEPTH || 12);
  const { files } = listFiles(cwd, Number.isFinite(maxDepth) ? maxDepth : 12);
  return files
    .map(file => ({ ...file, fullPath: path.resolve(cwd, file.path) }))
    .filter(file => file.editable && fileMatchesTerm(file.path, baseFolder));
}

function toSafeAttachmentName(value, fallback) {
  const clean = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '_')
    .replace(/^-+/, '')
    .slice(0, 120);
  return clean || fallback;
}

function toSafePluginFilename(value, fallbackBase = 'plugin') {
  const raw = String(value || '').trim();
  const ext = path.extname(raw).toLowerCase();
  const base = ext ? raw.slice(0, -ext.length) : raw;
  const safeBase = toSafeAttachmentName(base, fallbackBase).replace(/_+/g, '-');
  return `${safeBase}.jar`;
}

function sanitizeVersionLabel(version) {
  return String(version || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function getEditorPluginStatePath(serverCwd) {
  return path.resolve(serverCwd, 'plugins', '.editor-installed.json');
}

function readEditorPluginState(serverCwd) {
  const statePath = getEditorPluginStatePath(serverCwd);
  if (!fs.existsSync(statePath)) return { entries: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8') || '{}');
    const entries = parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object'
      ? parsed.entries
      : {};
    return { entries };
  } catch {
    return { entries: {} };
  }
}

function writeEditorPluginState(serverCwd, state) {
  const statePath = getEditorPluginStatePath(serverCwd);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function removePreviousPluginVersions(pluginsDir, pluginLabel, nextFilename, knownPaths = []) {
  if (!fs.existsSync(pluginsDir)) return [];
  const safeBase = toSafeAttachmentName(pluginLabel, 'plugin').replace(/_+/g, '-');
  const escapedBase = safeBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionedPattern = new RegExp(`^${escapedBase}(?:-[a-zA-Z0-9._-]+)?\\.jar(?:\\.disabled)?$`, 'i');
  const knownNames = new Set((knownPaths || []).map(rel => path.basename(String(rel || ''))));
  const removed = [];
  for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (name === nextFilename) continue;
    if (!versionedPattern.test(name) && !knownNames.has(name)) continue;
    const fullPath = path.resolve(pluginsDir, name);
    try {
      fs.rmSync(fullPath);
      removed.push(name);
    } catch {
      // keep best-effort cleanup non-fatal
    }
  }
  return removed;
}

function inferFilenameFromHeaders(headers) {
  const contentDisposition = headers.get('content-disposition') || '';
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]).replace(/["']/g, '');
  const simpleMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return simpleMatch?.[1] || '';
}

function safeDecodeCookieValue(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function parseCookieHeaderPairs(header) {
  return String(header || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const index = part.indexOf('=');
      if (index <= 0) return null;
      const key = part.slice(0, index).trim();
      const value = safeDecodeCookieValue(part.slice(index + 1));
      if (!key || !value) return null;
      return [key, value];
    })
    .filter(Boolean);
}

function buildSpigotCookieHeader({ cookieHeader = '', xfUser = '', xfSession = '', xfTfaTrust = '', cfClearance = '' } = {}) {
  const explicitCookieHeader = String(cookieHeader || '').trim();
  const userInput = explicitCookieHeader || String(xfUser || '').trim();
  const fullCookieMode = userInput.includes('=') && userInput.includes(';');
  const toCookieFragment = (key, value) => {
    const input = String(value || '').trim();
    if (!input) return '';
    if (input.includes('=')) return input;
    return `${key}=${safeDecodeCookieValue(input)}`;
  };
  const cookieParts = [];
  if (fullCookieMode) {
    cookieParts.push(...parseCookieHeaderPairs(userInput).map(([key, value]) => `${key}=${value}`));
    if (xfSession) cookieParts.push(toCookieFragment('xf_session', xfSession));
    if (xfTfaTrust) cookieParts.push(toCookieFragment('xf_tfa_trust', xfTfaTrust));
    if (cfClearance) cookieParts.push(toCookieFragment('cf_clearance', cfClearance));
  } else {
    if (xfUser) cookieParts.push(toCookieFragment('xf_user', xfUser));
    if (xfSession) cookieParts.push(toCookieFragment('xf_session', xfSession));
    if (xfTfaTrust) cookieParts.push(toCookieFragment('xf_tfa_trust', xfTfaTrust));
    if (cfClearance) cookieParts.push(toCookieFragment('cf_clearance', cfClearance));
  }
  return cookieParts.filter(Boolean).join('; ');
}

async function tryAppendSpigotToken(url, auth = {}, resourceUrl = '') {
  const base = String(url || '').trim();
  if (!base || !/spigotmc\.org\/resources\//i.test(base) || /[?&]_xfToken=/i.test(base)) return base;
  const cookieHeader = buildSpigotCookieHeader(auth);
  if (!cookieHeader) return base;
  const pageUrl = String(resourceUrl || '').trim() || base.replace(/\/download(?:\?.*)?$/i, '/');
  try {
    const response = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: 'https://www.spigotmc.org/',
        Cookie: cookieHeader
      }
    });
    const html = await response.text();
    const token = html.match(/name=["']_xfToken["']\s+value=["']([^"']+)["']/i)?.[1] || '';
    if (!token) return base;
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}_xfToken=${encodeURIComponent(token)}`;
  } catch {
    return base;
  }
}

function parseSpigotResourceId(input = '') {
  const raw = String(input || '').trim();
  if (/^\d+$/.test(raw)) return raw;
  const m = raw.match(/spigotmc\.org\/resources\/[^./]+\.([0-9]+)\//i)
    || raw.match(/spigotmc\.org\/resources\/([0-9]+)/i)
    || raw.match(/spiget\.org\/resources\/([0-9]+)/i);
  return m?.[1] || '';
}

async function resolveSpigotCandidates(baseUrl, resourceUrl = '', auth = {}) {
  const candidates = new Set([String(baseUrl || '').trim()]);
  const resourceId = parseSpigotResourceId(resourceUrl || baseUrl);
  const cookieHeader = buildSpigotCookieHeader(auth);
  const headers = cookieHeader ? { Cookie: cookieHeader } : {};
  if (resourceId) {
    candidates.add(`https://www.spigotmc.org/resources/${resourceId}/download`);
    candidates.add(`https://www.spigotmc.org/resources/${resourceId}/download?version=latest`);
    try {
      const spiget = await fetch(`https://api.spiget.org/v2/resources/${resourceId}`);
      if (spiget.ok) {
        const data = await spiget.json();
        const pathValue = String(data?.file?.url || '').trim();
        if (pathValue) candidates.add(`https://www.spigotmc.org${pathValue.startsWith('/') ? pathValue : `/${pathValue}`}`);
      }
    } catch {}
  }
  try {
    const pageUrl = String(resourceUrl || '').trim() || (resourceId ? `https://www.spigotmc.org/resources/${resourceId}/` : '');
    if (pageUrl) {
      const page = await fetch(pageUrl, { headers });
      const html = await page.text();
      for (const match of html.matchAll(/href=["']([^"']*download[^"']*)["']/ig)) {
        const raw = String(match[1] || '').replace(/&amp;/g, '&');
        try { candidates.add(new URL(raw, 'https://www.spigotmc.org/').toString()); } catch {}
      }
    }
  } catch {}
  return [...candidates].filter(Boolean);
}

async function fetchBinary(url, { cookieHeader = '', xfUser = '', xfSession = '', xfTfaTrust = '', cfClearance = '' } = {}) {
  const cookieHeaderValue = buildSpigotCookieHeader({ cookieHeader, xfUser, xfSession, xfTfaTrust, cfClearance });
  const fullCookieMode = String(cookieHeader || '').trim().includes(';') || String(xfUser || '').trim().includes(';');
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Referer: 'https://www.spigotmc.org/',
    Origin: 'https://www.spigotmc.org',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
    'Upgrade-Insecure-Requests': '1',
    ...(cookieHeaderValue ? { Cookie: cookieHeaderValue } : {})
  };
  let response;
  let requestEngine = 'fetch';
  try {
    const { default: cloudscraper } = await import('cloudscraper');
    const cloudResponse = await cloudscraper.get({
      url,
      headers,
      encoding: null,
      simple: false,
      resolveWithFullResponse: true,
      followAllRedirects: true
    });
    const cloudHeaders = new Map(
      Object.entries(cloudResponse?.headers || {}).map(([key, value]) => [String(key).toLowerCase(), String(value || '')])
    );
    response = {
      ok: Number(cloudResponse?.statusCode || 0) >= 200 && Number(cloudResponse?.statusCode || 0) < 300,
      status: Number(cloudResponse?.statusCode || 0),
      bytes: Buffer.isBuffer(cloudResponse?.body) ? cloudResponse.body : Buffer.from(String(cloudResponse?.body || '')),
      headers: {
        get: name => cloudHeaders.get(String(name || '').toLowerCase()) || ''
      }
    };
    requestEngine = 'cloudscraper';
    if (response.status === 403) {
      const fetchResponse = await fetch(url, { headers, redirect: 'follow' });
      const arrayBuffer = await fetchResponse.arrayBuffer();
      if (fetchResponse.ok) {
        response = {
          ok: true,
          status: fetchResponse.status,
          bytes: Buffer.from(arrayBuffer),
          headers: fetchResponse.headers
        };
        requestEngine = 'fetch';
      }
    }
  } catch {
    const fetchResponse = await fetch(url, { headers, redirect: 'follow' });
    const arrayBuffer = await fetchResponse.arrayBuffer();
    response = {
      ok: fetchResponse.ok,
      status: fetchResponse.status,
      bytes: Buffer.from(arrayBuffer),
      headers: fetchResponse.headers
    };
    requestEngine = 'fetch';
  }
  if (!response.ok) {
    if (response.status === 403 && cookieHeaderValue) {
      const usingFullCookieHeader = fullCookieMode;
      if (usingFullCookieHeader) {
        throw new Error(`Download failed (403) via ${requestEngine}. Spigot rejected the provided browser cookie context. Refresh cookies from an active logged-in browser tab (including fresh cf_clearance) and paste the full value into "Spigot full Cookie header".`);
      }
      throw new Error(`Download failed (403) via ${requestEngine}. Spigot rejected the session context. Paste your full browser Cookie header into the "Spigot full Cookie header" field (recommended), or provide fresh xf_user + xf_session + xf_tfa_trust + cf_clearance values from a logged-in browser session.`);
    }
    throw new Error(`Download failed (${response.status})`);
  }
  return {
    bytes: response.bytes,
    filenameFromHeader: inferFilenameFromHeaders(response.headers)
  };
}


function editorPage(prefilledApiKey = '') {
  const template = fs.readFileSync(WEB_EDITOR_TEMPLATE_FILE, 'utf8');
  return template.replace('__SERVER_PROVIDED_KEY__', JSON.stringify(prefilledApiKey));
}

export function startWebEditor() {
  const enabled = process.env.WEB_EDITOR_ENABLED === 'true';
  if (!enabled) {
    return null;
  }

  const port = Number(process.env.WEB_EDITOR_PORT || 8787);
  const apiKey = process.env.WEB_EDITOR_API_KEY || '';

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (isEditorShellRequest(req, url.pathname)) {
        return sendHtml(res, editorPage());
      }

      if (req.method === 'GET' && url.pathname === '/webEditor.css') {
        const css = fs.readFileSync(WEB_EDITOR_CSS_FILE, 'utf8');
        return sendCss(res, css);
      }

      if (req.method === 'GET' && url.pathname === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
      }

      if (!isAuthorized(req, apiKey)) {
        return sendJson(res, 401, { error: 'Unauthorized' });
      }

      if (req.method === 'GET' && url.pathname === '/api/servers') {
        const servers = loadServers({ includeDisabled: true }).map(s => ({
          id: s.id,
          name: s.name,
          cwd: s.cwd
        }));
        return sendJson(res, 200, { servers });
      }

      if (req.method === 'POST' && url.pathname === '/api/plugins/download-link') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}');
        const source = String(body.source || '').trim().toLowerCase();
        const query = String(body.query || '').trim();
        const platform = String(body.platform || '').trim().toLowerCase();
        const mcVersion = String(body.mcVersion || '').trim();

        if (!query) {
          return sendJson(res, 400, { error: 'Plugin query is required' });
        }

        try {
          const result = await getPluginDownloadLink({ source, query, platform, mcVersion });
          return sendJson(res, 200, { result });
        } catch (error) {
          return sendJson(res, 400, { error: error?.message || 'Unable to resolve plugin download link' });
        }
      }

      if (req.method === 'POST' && url.pathname === '/api/plugins/install') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}');
        const serverConfig = findServer(body.serverId);
        const source = String(body.source || '').trim().toLowerCase();
        const query = String(body.query || '').trim();
        const platform = String(body.platform || '').trim().toLowerCase();
        const mcVersion = String(body.mcVersion || '').trim();
        const cookieHeader = String(body.cookieHeader || '').trim();
        const xfUser = String(body.xfUser || '').trim();
        const xfSession = String(body.xfSession || '').trim();
        const xfTfaTrust = String(body.xfTfaTrust || '').trim();
        const cfClearance = String(body.cfClearance || '').trim();

        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });
        if (!query) return sendJson(res, 400, { error: 'Plugin query is required' });

        const pluginsDir = path.resolve(serverConfig.cwd, 'plugins');
        if (!isPathInside(pluginsDir, serverConfig.cwd)) return sendJson(res, 400, { error: 'Invalid plugins directory' });

        try {
          const result = await getPluginDownloadLink({ source, query, platform, mcVersion });
          const hasFullCookie = cookieHeader.includes('=') && cookieHeader.includes(';');
          if (result?.source === 'spigot' && result?.paid && !hasFullCookie && (!xfUser || !xfSession)) {
            return sendJson(res, 400, {
              error: 'This Spigot plugin is paid. Provide cookieHeader, or both xf_user and xf_session cookies to auto-install.',
              result
            });
          }
          const authPayload = { cookieHeader, xfUser, xfSession, xfTfaTrust, cfClearance };
          const baseDownloadUrl = await tryAppendSpigotToken(result.url, authPayload, result.resourceUrl || '');
          const spigotCandidates = await resolveSpigotCandidates(baseDownloadUrl, result.resourceUrl || '', authPayload);
          let downloaded = null;
          let lastDownloadError = null;
          for (const candidate of spigotCandidates) {
            const tokenizedCandidate = await tryAppendSpigotToken(candidate, authPayload, result.resourceUrl || '');
            try {
              downloaded = await fetchBinary(tokenizedCandidate, authPayload);
              break;
            } catch (error) {
              lastDownloadError = error;
            }
          }
          if (!downloaded) throw lastDownloadError || new Error('Unable to download plugin');
          const pluginLabel = result.plugin || result.projectSlug || query;
          const versionSuffix = sanitizeVersionLabel(result.versionNumber || result.minecraftVersion || '');
          const preferredName = `${result.plugin || result.projectSlug || query}${versionSuffix ? `-${versionSuffix}` : ''}.jar`;
          const fallbackName = downloaded.filenameFromHeader || `${result.projectSlug || 'plugin'}.jar`;
          const filename = toSafePluginFilename(preferredName, path.basename(fallbackName, path.extname(fallbackName)));
          const relPath = path.posix.join('plugins', filename);
          const targetFullPath = path.resolve(serverConfig.cwd, relPath);
          if (!isSafePath(serverConfig.cwd, relPath)) return sendJson(res, 400, { error: 'Invalid plugin path' });

          fs.mkdirSync(pluginsDir, { recursive: true });
          const state = readEditorPluginState(serverConfig.cwd);
          const knownPluginPaths = Object.entries(state.entries || {})
            .filter(([, meta]) => String(meta?.source || '').toLowerCase() === String(result.source || source || '').toLowerCase() && String(meta?.projectId || '').trim() === String(result.projectId || '').trim())
            .map(([rel]) => rel);
          const removed = removePreviousPluginVersions(pluginsDir, pluginLabel, filename, knownPluginPaths);
          fs.writeFileSync(targetFullPath, downloaded.bytes);
          const metadata = {
            source: result.source || source || 'unknown',
            projectId: String(result.projectId || '').trim(),
            projectSlug: String(result.projectSlug || '').trim(),
            query: String(query || '').trim(),
            plugin: String(pluginLabel || '').trim(),
            version: String(result.versionNumber || result.minecraftVersion || 'latest').trim(),
            installedAt: new Date().toISOString()
          };
          state.entries[relPath] = metadata;
          for (const oldName of removed) {
            delete state.entries[path.posix.join('plugins', oldName)];
          }
          writeEditorPluginState(serverConfig.cwd, state);

          return sendJson(res, 200, {
            ok: true,
            path: relPath,
            plugin: pluginLabel,
            source: result.source || source,
            version: result.versionNumber || result.minecraftVersion || 'latest',
            replaced: removed
          });
        } catch (error) {
          return sendJson(res, 400, { error: error?.message || 'Unable to install plugin' });
        }
      }

      if (req.method === 'GET' && url.pathname === '/api/plugins/editor-state') {
        const serverId = url.searchParams.get('serverId');
        const serverConfig = findServer(serverId);
        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });
        const state = readEditorPluginState(serverConfig.cwd);
        return sendJson(res, 200, state);
      }

      if (req.method === 'GET' && url.pathname === '/api/files') {
        const serverId = url.searchParams.get('serverId');
        const serverConfig = findServer(serverId);
        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });
        if (!fs.existsSync(serverConfig.cwd)) {
          return sendJson(res, 400, { error: `Server directory does not exist: ${serverConfig.cwd}. Check the server cwd path.` });
        }
        if (!fs.statSync(serverConfig.cwd).isDirectory()) {
          return sendJson(res, 400, { error: `Server cwd is not a directory: ${serverConfig.cwd}. Check the server cwd path.` });
        }

        const maxDepth = Number(process.env.WEB_EDITOR_MAX_DEPTH || 12);
        const { files, emptyFolders } = listFiles(serverConfig.cwd, Number.isFinite(maxDepth) ? maxDepth : 12);
        return sendJson(res, 200, { files, emptyFolders });
      }

      if (req.method === 'GET' && url.pathname === '/api/file') {
        const serverId = url.searchParams.get('serverId');
        const relPath = url.searchParams.get('path') || '';
        const serverConfig = findServer(serverId);

        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });
        if (!isSafePath(serverConfig.cwd, relPath)) return sendJson(res, 400, { error: 'Invalid path' });

        const fullPath = path.resolve(serverConfig.cwd, relPath);
        if (!fs.existsSync(fullPath)) return sendJson(res, 404, { error: 'File not found' });
        if (fs.statSync(fullPath).isDirectory()) return sendJson(res, 400, { error: `${path.basename(fullPath)} cannot be edited (directory)` });

        const editability = getFileEditability(fullPath);
        if (!editability.editable) return sendJson(res, 400, { error: editability.reason });

        const content = fs.readFileSync(fullPath, 'utf8');
        return sendJson(res, 200, { content });
      }

      if (req.method === 'POST' && url.pathname === '/api/file') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}');

        const serverConfig = findServer(body.serverId);
        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });

        const relPath = String(body.path || '');
        const content = String(body.content || '');

        if (!isSafePath(serverConfig.cwd, relPath)) return sendJson(res, 400, { error: 'Invalid path' });
        if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) return sendJson(res, 400, { error: 'Content too large' });

        const fullPath = path.resolve(serverConfig.cwd, relPath);
        const editability = getFileEditability(fullPath);
        if (!editability.editable) return sendJson(res, 400, { error: editability.reason });

        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf8');

        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/api/file/create') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}');
        const serverConfig = findServer(body.serverId);
        const relPath = String(body.path || '').trim();
        const content = String(body.content || '');
        if (!relPath) return sendJson(res, 400, { error: 'Path is required' });
        if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) return sendJson(res, 400, { error: 'Content too large' });

        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });
        if (!isSafePath(serverConfig.cwd, relPath)) return sendJson(res, 400, { error: 'Invalid path' });
        const fullPath = path.resolve(serverConfig.cwd, relPath);
        const ext = path.extname(fullPath).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext)) return sendJson(res, 400, { error: `Unsupported extension: ${ext || 'none'}` });
        if (fs.existsSync(fullPath)) return sendJson(res, 400, { error: 'Path already exists' });

        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf8');
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/api/folder/create') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}');
        const serverConfig = findServer(body.serverId);
        const relPath = String(body.path || '').trim();
        if (!relPath) return sendJson(res, 400, { error: 'Path is required' });

        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });
        if (!isSafePath(serverConfig.cwd, relPath)) return sendJson(res, 400, { error: 'Invalid path' });
        const fullPath = path.resolve(serverConfig.cwd, relPath);
        if (fs.existsSync(fullPath)) return sendJson(res, 400, { error: 'Path already exists' });
        fs.mkdirSync(fullPath, { recursive: true });
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/api/file/duplicate') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}');
        const serverConfig = findServer(body.serverId);
        const sourcePath = String(body.sourcePath || '').trim();
        const targetPath = String(body.targetPath || '').trim();
        if (!sourcePath || !targetPath) return sendJson(res, 400, { error: 'sourcePath and targetPath are required' });

        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });
        if (!isSafePath(serverConfig.cwd, sourcePath) || !isSafePath(serverConfig.cwd, targetPath)) return sendJson(res, 400, { error: 'Invalid path' });
        const sourceFull = path.resolve(serverConfig.cwd, sourcePath);
        const targetFull = path.resolve(serverConfig.cwd, targetPath);
        if (!fs.existsSync(sourceFull)) return sendJson(res, 404, { error: 'Source not found' });
        if (fs.existsSync(targetFull)) return sendJson(res, 400, { error: 'Target already exists' });
        if (fs.statSync(sourceFull).isDirectory()) return sendJson(res, 400, { error: 'Cannot duplicate directory with file duplicate endpoint' });

        const editability = getFileEditability(sourceFull);
        if (!editability.editable) return sendJson(res, 400, { error: editability.reason });
        const targetExt = path.extname(targetFull).toLowerCase();
        if (!TEXT_EXTENSIONS.has(targetExt)) return sendJson(res, 400, { error: `Unsupported target extension: ${targetExt || 'none'}` });

        fs.mkdirSync(path.dirname(targetFull), { recursive: true });
        fs.copyFileSync(sourceFull, targetFull);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/api/path/duplicate') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}');
        const serverConfig = findServer(body.serverId);
        const sourcePath = String(body.sourcePath || '').trim();
        const targetPath = String(body.targetPath || '').trim();
        if (!sourcePath || !targetPath) return sendJson(res, 400, { error: 'sourcePath and targetPath are required' });

        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });
        if (!isSafePath(serverConfig.cwd, sourcePath) || !isSafePath(serverConfig.cwd, targetPath)) return sendJson(res, 400, { error: 'Invalid path' });
        const sourceFull = path.resolve(serverConfig.cwd, sourcePath);
        const targetFull = path.resolve(serverConfig.cwd, targetPath);
        if (!fs.existsSync(sourceFull)) return sendJson(res, 404, { error: 'Source not found' });
        if (fs.existsSync(targetFull)) return sendJson(res, 400, { error: 'Target already exists' });
        if (isPathInside(targetFull, sourceFull)) return sendJson(res, 400, { error: 'Cannot duplicate a path into itself' });

        copyRecursiveSync(sourceFull, targetFull);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/api/path/rename') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}');
        const serverConfig = findServer(body.serverId);
        const oldPath = String(body.oldPath || '').trim();
        const newPath = String(body.newPath || '').trim();
        if (!oldPath || !newPath) return sendJson(res, 400, { error: 'oldPath and newPath are required' });

        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });
        if (!isSafePath(serverConfig.cwd, oldPath) || !isSafePath(serverConfig.cwd, newPath)) return sendJson(res, 400, { error: 'Invalid path' });
        const oldFull = path.resolve(serverConfig.cwd, oldPath);
        const newFull = path.resolve(serverConfig.cwd, newPath);
        if (!fs.existsSync(oldFull)) return sendJson(res, 404, { error: 'Path not found' });
        if (fs.existsSync(newFull)) return sendJson(res, 400, { error: 'Destination already exists' });

        fs.mkdirSync(path.dirname(newFull), { recursive: true });
        fs.renameSync(oldFull, newFull);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/api/path/delete') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}');
        const serverConfig = findServer(body.serverId);
        const relPath = String(body.path || '').trim();
        if (!relPath) return sendJson(res, 400, { error: 'Path is required' });

        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });
        if (!isSafePath(serverConfig.cwd, relPath)) return sendJson(res, 400, { error: 'Invalid path' });
        const fullPath = path.resolve(serverConfig.cwd, relPath);
        if (!fs.existsSync(fullPath)) return sendJson(res, 404, { error: 'Path not found' });
        fs.rmSync(fullPath, { recursive: true, force: false });
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'GET' && url.pathname === '/api/search') {
        const serverId = url.searchParams.get('serverId');
        const query = String(url.searchParams.get('q') || '').trim();
        const mode = String(url.searchParams.get('mode') || 'path').toLowerCase();
        const folder = String(url.searchParams.get('folder') || '').trim();
        const serverConfig = findServer(serverId);
        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });
        if (folder && !isSafePath(serverConfig.cwd, folder)) return sendJson(res, 400, { error: 'Invalid folder path' });
        if (!query) return sendJson(res, 200, { results: [] });
        const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

        const searchableFiles = listSearchableFiles(serverConfig.cwd, folder);
        if (mode === 'content') {
          const results = [];
          for (const file of searchableFiles) {
            if (results.length >= MAX_SEARCH_RESULTS) break;
            const stat = fs.statSync(file.fullPath);
            if (stat.size > MAX_SEARCH_FILE_BYTES) continue;
            let text = '';
            try {
              text = fs.readFileSync(file.fullPath, 'utf8');
            } catch {
              continue;
            }
            const lines = text.split(/\r\n|\r|\n/);
            const matches = [];
            const lineHits = new Set();
            for (let i = 0; i < lines.length; i++) {
              const lineLower = lines[i].toLowerCase();
              const termMatchCount = queryTerms.reduce((count, term) => count + (lineLower.includes(term) ? 1 : 0), 0);
              if (termMatchCount > 0) {
                queryTerms.forEach(term => {
                  if (lineLower.includes(term)) lineHits.add(term);
                });
                matches.push({ line: i + 1, preview: lines[i].slice(0, 240) });
                if (matches.length >= 3) break;
              }
            }
            const matchedAllTerms = queryTerms.every(term => lineHits.has(term));
            if (matches.length && matchedAllTerms) {
              results.push({
                path: file.path,
                score: matches.length * 2 + lineHits.size,
                matches
              });
            }
          }
          results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
          return sendJson(res, 200, { results });
        }

        const fileResults = searchableFiles
          .map(file => {
            const lowerPath = file.path.toLowerCase();
            let score = 0;
            for (const term of queryTerms) {
              if (lowerPath === term) score += 1000;
              else if (lowerPath.endsWith('/' + term)) score += 250;
              else if (path.basename(lowerPath) === term) score += 180;
              else if (lowerPath.includes('/' + term)) score += 70;
              else if (lowerPath.includes(term)) score += 25;
            }
            const matchedAllTerms = queryTerms.every(term => lowerPath.includes(term));
            return { type: 'file', path: file.path, score, matchedAllTerms };
          })
          .filter(item => item.score > 0 && item.matchedAllTerms);

        const folderSet = new Set();
        for (const file of searchableFiles) {
          const segments = file.path.split('/');
          for (let i = 1; i < segments.length; i++) {
            folderSet.add(segments.slice(0, i).join('/'));
          }
        }

        const folderResults = Array.from(folderSet)
          .filter(folderPath => !folder || fileMatchesTerm(folderPath, folder))
          .map(folderPath => {
            const lowerPath = folderPath.toLowerCase();
            let score = 0;
            for (const term of queryTerms) {
              if (lowerPath === term) score += 1050;
              else if (lowerPath.endsWith('/' + term)) score += 280;
              else if (path.basename(lowerPath) === term) score += 220;
              else if (lowerPath.includes('/' + term)) score += 80;
              else if (lowerPath.includes(term)) score += 30;
            }
            const matchedAllTerms = queryTerms.every(term => lowerPath.includes(term));
            return { type: 'folder', path: folderPath, score, matchedAllTerms };
          })
          .filter(item => item.score > 0 && item.matchedAllTerms);

        const results = [...fileResults, ...folderResults]
          .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
          .slice(0, MAX_SEARCH_RESULTS);
        return sendJson(res, 200, { results });
      }

      if (req.method === 'POST' && url.pathname === '/api/upload') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}');
        const serverConfig = findServer(body.serverId);
        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });

        const targetDir = String(body.targetDir || '').trim();
        const items = Array.isArray(body.items) ? body.items : [];
        if (!items.length) return sendJson(res, 400, { error: 'No upload items provided' });
        if (!isSafePath(serverConfig.cwd, targetDir)) return sendJson(res, 400, { error: 'Invalid target directory' });

        let written = 0;
        for (const item of items) {
          const relPath = String(item.path || '').replace(/^\/+/, '').trim();
          if (!relPath) continue;
          const targetRelPath = path.posix.join(targetDir.replace(/\\/g, '/'), relPath);
          if (!isSafePath(serverConfig.cwd, targetRelPath)) return sendJson(res, 400, { error: 'Invalid upload path: ' + relPath });
          const targetFull = path.resolve(serverConfig.cwd, targetRelPath);
          const bytes = Buffer.from(String(item.contentBase64 || ''), 'base64');
          if (bytes.length > MAX_FILE_BYTES) return sendJson(res, 400, { error: 'File too large: ' + relPath });
          fs.mkdirSync(path.dirname(targetFull), { recursive: true });
          fs.writeFileSync(targetFull, bytes);
          written += 1;
        }
        return sendJson(res, 200, { ok: true, written });
      }

      if (req.method === 'GET' && url.pathname === '/api/download/file') {
        const serverId = url.searchParams.get('serverId');
        const relPath = String(url.searchParams.get('path') || '');
        const serverConfig = findServer(serverId);
        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });
        if (!isSafePath(serverConfig.cwd, relPath)) return sendJson(res, 400, { error: 'Invalid path' });
        const fullPath = path.resolve(serverConfig.cwd, relPath);
        if (!fs.existsSync(fullPath)) return sendJson(res, 404, { error: 'Path not found' });
        if (!fs.statSync(fullPath).isFile()) return sendJson(res, 400, { error: 'Path is not a file' });

        const filename = toSafeAttachmentName(path.basename(relPath), 'download.bin');
        const data = fs.readFileSync(fullPath);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': data.length,
          'Content-Disposition': `attachment; filename="${filename}"`
        });
        return res.end(data);
      }

      if (req.method === 'GET' && url.pathname === '/api/download/folder') {
        const serverId = url.searchParams.get('serverId');
        const relPath = String(url.searchParams.get('path') || '').trim();
        const serverConfig = findServer(serverId);
        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });
        if (!relPath) return sendJson(res, 400, { error: 'Path is required' });
        if (!isSafePath(serverConfig.cwd, relPath)) return sendJson(res, 400, { error: 'Invalid path' });
        const root = path.resolve(serverConfig.cwd, relPath);
        if (!fs.existsSync(root)) return sendJson(res, 404, { error: 'Path not found' });
        if (!fs.statSync(root).isDirectory()) return sendJson(res, 400, { error: 'Path is not a folder' });

        const bundle = [];
        function walkFolder(current, prefix = '') {
          const entries = fs.readdirSync(current, { withFileTypes: true });
          for (const entry of entries) {
            const entryFull = path.join(current, entry.name);
            const entryRel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
              walkFolder(entryFull, entryRel);
            } else if (entry.isFile()) {
              const bytes = fs.readFileSync(entryFull);
              bundle.push({ path: entryRel, contentBase64: bytes.toString('base64') });
            }
          }
        }
        walkFolder(root, '');
        const output = {
          type: 'folder-bundle',
          folder: relPath,
          createdAt: new Date().toISOString(),
          files: bundle
        };
        const payload = Buffer.from(JSON.stringify(output), 'utf8');
        const filename = toSafeAttachmentName(path.basename(relPath), 'folder') + '.bundle.json';
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': payload.length,
          'Content-Disposition': `attachment; filename="${filename}"`
        });
        return res.end(payload);
      }

      return sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      return sendJson(res, 500, { error: error.message || 'Server error' });
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Web editor enabled at http://0.0.0.0:${port}`);
  });

  return server;
}
