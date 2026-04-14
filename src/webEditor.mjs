import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadServers } from './serverStore.mjs';

const TEXT_EXTENSIONS = new Set([
  '.txt', '.json', '.cfg', '.ini', '.properties', '.yaml', '.yml', '.xml', '.bat', '.sh', '.log', '.conf'
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
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

function listEditableFiles(cwd, maxDepth = 8) {
  const results = [];
  const emptyFolders = [];

  function walk(currentDir, depth, prefix = '') {
    if (depth > maxDepth) return false;

    let subtreeHasEditableFiles = false;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (walk(full, depth + 1, rel)) {
          subtreeHasEditableFiles = true;
        }
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (TEXT_EXTENSIONS.has(ext) && fs.statSync(full).size <= MAX_FILE_BYTES) {
        results.push(rel);
        subtreeHasEditableFiles = true;
      }
    }

    if (!subtreeHasEditableFiles && prefix) {
      emptyFolders.push(prefix);
    }
    return subtreeHasEditableFiles;
  }

  walk(cwd, 0);
  return {
    files: results.sort(),
    emptyFolders: emptyFolders.sort()
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

      if (req.method === 'GET' && url.pathname === '/api/files') {
        const serverId = url.searchParams.get('serverId');
        const serverConfig = findServer(serverId);
        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });

        const { files, emptyFolders } = listEditableFiles(serverConfig.cwd);
        return sendJson(res, 200, { files, emptyFolders });
      }

      if (req.method === 'GET' && url.pathname === '/api/file') {
        const serverId = url.searchParams.get('serverId');
        const relPath = url.searchParams.get('path') || '';
        const serverConfig = findServer(serverId);

        if (!serverConfig) return sendJson(res, 404, { error: 'Server not found' });
        if (!isSafePath(serverConfig.cwd, relPath)) return sendJson(res, 400, { error: 'Invalid path' });

        const fullPath = path.resolve(serverConfig.cwd, relPath);
        const ext = path.extname(fullPath).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext)) return sendJson(res, 400, { error: 'File type not allowed' });
        if (!fs.existsSync(fullPath)) return sendJson(res, 404, { error: 'File not found' });

        const stats = fs.statSync(fullPath);
        if (stats.size > MAX_FILE_BYTES) return sendJson(res, 400, { error: 'File too large' });

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
        const ext = path.extname(fullPath).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext)) return sendJson(res, 400, { error: 'File type not allowed' });

        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf8');

        return sendJson(res, 200, { ok: true });
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
