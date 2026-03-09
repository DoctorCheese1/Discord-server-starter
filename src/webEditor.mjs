import http from 'http';
import fs from 'fs';
import path from 'path';
import { loadServers } from './serverStore.mjs';

const TEXT_EXTENSIONS = new Set([
  '.txt', '.json', '.cfg', '.ini', '.properties', '.yaml', '.yml', '.xml', '.bat', '.sh', '.log', '.conf'
]);

const MAX_FILE_BYTES = 1024 * 1024; // 1MB

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
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

function listEditableFiles(cwd, maxDepth = 3) {
  const results = [];

  function walk(currentDir, depth, prefix = '') {
    if (depth > maxDepth) return;

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(full, depth + 1, rel);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (TEXT_EXTENSIONS.has(ext) && fs.statSync(full).size <= MAX_FILE_BYTES) {
        results.push(rel);
      }
    }
  }

  walk(cwd, 0);
  return results.sort();
}

function editorPage() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Server File Editor</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 1rem; background: #111; color: #eee; }
    select, textarea, button, input { width: 100%; margin: .4rem 0; padding: .6rem; border-radius: .4rem; border: 1px solid #444; background: #1c1c1c; color: #eee; }
    textarea { min-height: 55vh; font-family: Consolas, monospace; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .muted { color: #aaa; font-size: .9rem; }
  </style>
</head>
<body>
  <h2>📝 Server File Editor</h2>
  <p class="muted">Use this page to edit text config files under discovered server folders.</p>

  <label>API Key (if configured)</label>
  <input id="key" placeholder="WEB_EDITOR_API_KEY" />

  <div class="row">
    <div>
      <label>Server</label>
      <select id="server"></select>
    </div>
    <div>
      <label>File</label>
      <select id="file"></select>
    </div>
  </div>

  <button id="load">Load File</button>
  <textarea id="content" placeholder="File contents..."></textarea>
  <button id="save">Save File</button>
  <div id="status" class="muted"></div>

  <script>
    const status = document.getElementById('status');
    const serverSel = document.getElementById('server');
    const fileSel = document.getElementById('file');
    const content = document.getElementById('content');
    const keyInput = document.getElementById('key');

    function withKey(url) {
      const key = keyInput.value.trim();
      if (!key) return url;
      return url + (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key);
    }

    async function fetchJson(url, opts) {
      const res = await fetch(withKey(url), opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    }

    async function loadServers() {
      const data = await fetchJson('/api/servers');
      serverSel.innerHTML = data.servers.map(s => '<option value="' + s.id + '">' + s.name + ' (' + s.id + ')</option>').join('');
      if (data.servers.length) await loadFiles();
    }

    async function loadFiles() {
      const id = serverSel.value;
      const data = await fetchJson('/api/files?serverId=' + encodeURIComponent(id));
      fileSel.innerHTML = data.files.map(f => '<option value="' + f + '">' + f + '</option>').join('');
    }

    document.getElementById('load').onclick = async () => {
      try {
        const id = serverSel.value;
        const file = fileSel.value;
        const data = await fetchJson('/api/file?serverId=' + encodeURIComponent(id) + '&path=' + encodeURIComponent(file));
        content.value = data.content;
        status.textContent = 'Loaded ' + file;
      } catch (err) {
        status.textContent = '❌ ' + err.message;
      }
    };

    document.getElementById('save').onclick = async () => {
      try {
        const id = serverSel.value;
        const file = fileSel.value;
        await fetchJson('/api/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverId: id, path: file, content: content.value })
        });
        status.textContent = '✅ Saved ' + file;
      } catch (err) {
        status.textContent = '❌ ' + err.message;
      }
    };

    serverSel.onchange = loadFiles;
    keyInput.onchange = loadServers;
    loadServers().catch(err => status.textContent = '❌ ' + err.message);
  </script>
</body>
</html>`;
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

        const files = listEditableFiles(serverConfig.cwd);
        return sendJson(res, 200, { files });
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
