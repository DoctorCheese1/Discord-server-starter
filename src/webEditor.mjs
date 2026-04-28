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

function inferFilenameFromHeaders(headers) {
  const contentDisposition = headers.get('content-disposition') || '';
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]).replace(/["']/g, '');
  const simpleMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return simpleMatch?.[1] || '';
}

async function fetchBinary(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'ServerControlBot/2.0 (plugin downloader)'
    },
    redirect: 'follow'
  });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return {
    bytes: Buffer.from(arrayBuffer),
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

        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });
        if (!query) return sendJson(res, 400, { error: 'Plugin query is required' });

        const pluginsDir = path.resolve(serverConfig.cwd, 'plugins');
        if (!isPathInside(pluginsDir, serverConfig.cwd)) return sendJson(res, 400, { error: 'Invalid plugins directory' });

        try {
          const result = await getPluginDownloadLink({ source, query, platform, mcVersion });
          const downloaded = await fetchBinary(result.url);
          const preferredName = `${result.plugin || result.projectSlug || query}.jar`;
          const fallbackName = downloaded.filenameFromHeader || `${result.projectSlug || 'plugin'}.jar`;
          const filename = toSafePluginFilename(preferredName, path.basename(fallbackName, path.extname(fallbackName)));
          const relPath = path.posix.join('plugins', filename);
          const targetFullPath = path.resolve(serverConfig.cwd, relPath);
          if (!isSafePath(serverConfig.cwd, relPath)) return sendJson(res, 400, { error: 'Invalid plugin path' });

          fs.mkdirSync(pluginsDir, { recursive: true });
          fs.writeFileSync(targetFullPath, downloaded.bytes);

          return sendJson(res, 200, {
            ok: true,
            path: relPath,
            plugin: result.plugin || query,
            source: result.source || source
          });
        } catch (error) {
          return sendJson(res, 400, { error: error?.message || 'Unable to install plugin' });
        }
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
