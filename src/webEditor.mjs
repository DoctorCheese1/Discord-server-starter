import http from 'http';
import fs from 'fs';
import path from 'path';
import { loadServers } from './serverStore.mjs';

const TEXT_EXTENSIONS = new Set([
  '.txt', '.json', '.cfg', '.ini', '.properties', '.yaml', '.yml', '.xml', '.bat', '.sh', '.log', '.conf'
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

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

function editorPage(prefilledApiKey = '') {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Toolbox - Config Editor</title>
  <style>
    :root {
      --bg: #111318;
      --panel: #0d1015;
      --panel-2: #181d25;
      --text: #d9dde6;
      --muted: #8b95a7;
      --cyan: #1f8698;
      --cyan-soft: #28515a;
      --line: #2a303a;
      --active: #2e7ea0;
      --danger: #e06c75;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: "Segoe UI", Arial, sans-serif; }
    .window-title { height: 30px; padding: 5px 10px; font-size: 14px; background: #0b0d10; border-bottom: 1px solid #1e222a; color: #d3d7de; }
    .menu-bar { height: 30px; display: flex; align-items: center; gap: 2px; padding: 0 8px; background: #151a22; border-bottom: 1px solid #1f2430; position: relative; z-index: 20; }
    .menu { position: relative; }
    .menu-btn { border: none; background: transparent; color: #bfc8d9; padding: 6px 14px; font-size: 14px; cursor: pointer; }
    .menu-btn:hover, .menu-btn.open { background: #2a2f3a; }
    .menu-items { display: none; position: absolute; top: 100%; left: 0; min-width: 220px; background: rgba(29, 33, 41, 0.97); border: 1px solid #363d4b; box-shadow: 0 8px 16px rgba(0,0,0,.35); }
    .menu-items.open { display: block; }
    .menu-item { width: 100%; text-align: left; border: none; background: transparent; color: #c9d2e0; padding: 10px 14px; cursor: pointer; font-size: 15px; border-bottom: 1px solid #2b313d; }
    .menu-item:last-child { border-bottom: none; }
    .menu-item:hover { background: #364252; }
    .header { background: linear-gradient(90deg, #174d5a, #1f8698); padding: 10px 16px; font-size: 36px; letter-spacing: .5px; font-weight: 300; border-bottom: 1px solid #2e3f4c; }
    .toolbar { padding: 8px 12px; display: flex; gap: 8px; align-items: center; border-bottom: 1px solid #222833; background: #141922; }
    .toolbar input, .toolbar select { background: #202733; border: 1px solid #394150; color: var(--text); border-radius: 4px; padding: 7px 10px; }
    .toolbar input { min-width: 240px; }
    .toolbar select { min-width: 200px; }
    .layout { display: grid; grid-template-columns: 300px 1fr; height: calc(100vh - 149px); }
    .sidebar { border-right: 1px solid #212734; background: var(--panel); overflow: auto; }
    .tree-head { padding: 8px 12px; border-bottom: 1px solid #232a36; }
    .tree-head input { width: 100%; background: #171d27; border: 1px solid #2e3645; color: var(--text); border-radius: 4px; padding: 7px 9px; }
    .tree { padding: 8px 5px 24px; font-family: "Consolas", monospace; font-size: 14px; }
    .tree-row { white-space: nowrap; padding: 3px 6px; cursor: pointer; border-radius: 3px; margin: 1px 0; color: #d8dfeb; }
    .tree-row:hover { background: #1f2531; }
    .tree-row.active { background: #2a5f80; color: #f0f7ff; }
    .tree-row.file::before { content: "{}"; color: #dbbf63; margin-right: 6px; font-weight: 700; }
    .tree-row.file.yaml::before { content: "YML"; font-size: 11px; color: #e8cc60; }
    .tree-row.folder::before { content: "▾"; margin-right: 6px; color: #7fa0bf; }
    .tree-row.folder.collapsed::before { content: "▸"; }
    .editor-wrap { display: flex; flex-direction: column; min-width: 0; }
    .tabs { height: 40px; background: #191f28; display: flex; align-items: end; padding: 0 8px; border-bottom: 1px solid #2a3240; }
    .tab { background: #2a3037; color: #bec7d6; border: 1px solid #3f4757; border-bottom: none; border-radius: 6px 6px 0 0; padding: 9px 14px; font-style: italic; min-width: 120px; }
    .tab.active { background: #3b4048; color: #f5f7fb; }
    .editor-grid { flex: 1; display: grid; grid-template-columns: 54px 1fr; min-height: 0; }
    .line-numbers { background: var(--panel-2); border-right: 1px solid var(--line); color: #7f8ca4; font-family: Consolas, monospace; padding: 8px 6px; line-height: 22px; text-align: right; overflow: hidden; user-select: none; }
    textarea { width: 100%; height: 100%; resize: none; border: none; outline: none; background: #1b2029; color: #e8edf6; font-family: Consolas, monospace; line-height: 22px; font-size: 26px; padding: 8px 12px; tab-size: 2; }
    .footer { height: 28px; display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #262e3a; background: #121722; padding: 0 10px; color: var(--muted); font-size: 12px; }
    .popup { position: fixed; top: 12px; right: 12px; background: #1f6f43; color: #fff; border: 1px solid #2ecc71; border-radius: .5rem; padding: .8rem 1rem; opacity: 0; transform: translateY(-8px); pointer-events: none; transition: opacity .2s, transform .2s; z-index: 50; }
    .popup.show { opacity: 1; transform: translateY(0); }
  </style>
</head>
<body>
  <div class="window-title">Toolbox - Config Editor</div>
  <div class="menu-bar">
    <div class="menu">
      <button class="menu-btn" data-menu="file">File</button>
      <div class="menu-items" id="menu-file">
        <button class="menu-item" id="newWindow">New Window</button>
        <button class="menu-item" id="save">Save</button>
        <button class="menu-item" id="revert">Revert File</button>
        <button class="menu-item" id="exit">Exit</button>
      </div>
    </div>
    <div class="menu">
      <button class="menu-btn" data-menu="edit">Edit</button>
      <div class="menu-items" id="menu-edit">
        <button class="menu-item" id="undo">Undo</button>
        <button class="menu-item" id="redo">Redo</button>
        <button class="menu-item" id="cut">Cut</button>
        <button class="menu-item" id="copy">Copy</button>
        <button class="menu-item" id="paste">Paste</button>
      </div>
    </div>
    <div class="menu">
      <button class="menu-btn" data-menu="format">Format</button>
      <div class="menu-items" id="menu-format">
        <button class="menu-item" id="validateJson">Validate JSON</button>
        <button class="menu-item" id="validateYaml">Validate YAML</button>
        <button class="menu-item" id="prettifyJson">Prettify JSON</button>
      </div>
    </div>
  </div>
  <div class="header">Toolbox - Config Editor</div>
  <div class="toolbar">
    <select id="server"></select>
    <input id="key" placeholder="WEB_EDITOR_API_KEY" autocomplete="off" />
    <input id="fileSearch" placeholder="Filter files..." />
  </div>
  <div class="layout">
    <aside class="sidebar">
      <div class="tree-head"></div>
      <div id="tree" class="tree"></div>
    </aside>
    <section class="editor-wrap">
      <div class="tabs"><div id="tab" class="tab active">No file open</div></div>
      <div class="editor-grid">
        <pre id="lineNumbers" class="line-numbers">1</pre>
        <textarea id="content" spellcheck="false" placeholder="Select a file on the left to load contents..."></textarea>
      </div>
      <div class="footer">
        <div id="status">Ready</div>
        <div>Ctrl+S Save • Ctrl+F Find in browser</div>
      </div>
    </section>
  </div>
  <div id="savePopup" class="popup">✅ File saved successfully</div>

  <script>
    const status = document.getElementById('status');
    const serverSel = document.getElementById('server');
    const tree = document.getElementById('tree');
    const content = document.getElementById('content');
    const keyInput = document.getElementById('key');
    const fileSearchInput = document.getElementById('fileSearch');
    const savePopup = document.getElementById('savePopup');
    const tab = document.getElementById('tab');
    const lineNumbers = document.getElementById('lineNumbers');

    const KEY_STORAGE_NAME = 'web_editor_api_key';
    const SERVER_PROVIDED_KEY = ${JSON.stringify(prefilledApiKey)};
    let allFiles = [];
    let currentFile = '';
    let originalContent = '';
    let popupTimer;
    let openMenu = null;
    const collapsedFolders = new Set();

    function showSavePopup(file) {
      savePopup.textContent = '✅ Saved ' + file;
      savePopup.classList.add('show');
      clearTimeout(popupTimer);
      popupTimer = setTimeout(() => savePopup.classList.remove('show'), 1800);
    }

    function updateLineNumbers() {
      const lines = Math.max(1, content.value.split('\\n').length);
      const nums = [];
      for (let i = 1; i <= lines; i++) nums.push(i);
      lineNumbers.textContent = nums.join('\\n');
    }

    function markActiveFile() {
      for (const row of tree.querySelectorAll('.tree-row.file')) {
        row.classList.toggle('active', row.dataset.path === currentFile);
      }
      tab.textContent = currentFile ? pathBase(currentFile) : 'No file open';
    }

    function pathBase(p) {
      const parts = p.split('/');
      return parts[parts.length - 1];
    }

    function renderFiles(filter = '') {
      const query = filter.trim().toLowerCase();
      const files = query
        ? allFiles.filter(f => f.toLowerCase().includes(query))
        : allFiles;

      const root = { folders: new Map(), files: [] };
      for (const file of files) {
        const parts = file.split('/');
        let node = root;
        for (let i = 0; i < parts.length - 1; i++) {
          const folder = parts[i];
          if (!node.folders.has(folder)) node.folders.set(folder, { folders: new Map(), files: [] });
          node = node.folders.get(folder);
        }
        node.files.push(file);
      }

      const rows = [];
      function walk(node, depth, prefix = '') {
        const folders = Array.from(node.folders.keys()).sort((a, b) => a.localeCompare(b));
        for (const folderName of folders) {
          const folderPath = prefix ? prefix + '/' + folderName : folderName;
          const isCollapsed = collapsedFolders.has(folderPath);
          rows.push(
            '<div class="tree-row folder' + (isCollapsed ? ' collapsed' : '') + '" data-folder="' + folderPath + '" style="padding-left:' + (depth * 16 + 8) + 'px">' +
            folderName +
            '</div>'
          );
          if (!isCollapsed) {
            walk(node.folders.get(folderName), depth + 1, folderPath);
          }
        }
        const sortedFiles = node.files.slice().sort((a, b) => a.localeCompare(b));
        for (const filePath of sortedFiles) {
          const ext = filePath.toLowerCase().endsWith('.yml') || filePath.toLowerCase().endsWith('.yaml') ? ' yaml' : '';
          rows.push('<div class="tree-row file' + ext + '" data-path="' + filePath + '" style="padding-left:' + (depth * 16 + 8) + 'px">' + pathBase(filePath) + '</div>');
        }
      }

      walk(root, 0);
      tree.innerHTML = rows.join('');
      markActiveFile();
    }

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
      allFiles = data.files;
      renderFiles(fileSearchInput.value);
    }

    async function loadFile(file) {
      try {
        const id = serverSel.value;
        const data = await fetchJson('/api/file?serverId=' + encodeURIComponent(id) + '&path=' + encodeURIComponent(file));
        content.value = data.content;
        originalContent = data.content;
        currentFile = file;
        status.textContent = 'Loaded ' + file;
        markActiveFile();
        updateLineNumbers();
      } catch (err) {
        status.textContent = '❌ ' + err.message;
      }
    }

    async function saveCurrentFile() {
      try {
        if (!currentFile) throw new Error('No file selected');
        const id = serverSel.value;
        await fetchJson('/api/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverId: id, path: currentFile, content: content.value })
        });
        originalContent = content.value;
        status.textContent = '✅ Saved ' + currentFile;
        showSavePopup(currentFile);
      } catch (err) {
        status.textContent = '❌ ' + err.message;
      }
    }

    tree.onclick = e => {
      const folder = e.target.closest('.tree-row.folder');
      if (folder) {
        const folderPath = folder.dataset.folder;
        if (collapsedFolders.has(folderPath)) {
          collapsedFolders.delete(folderPath);
        } else {
          collapsedFolders.add(folderPath);
        }
        renderFiles(fileSearchInput.value);
        return;
      }
      const row = e.target.closest('.tree-row.file');
      if (row) loadFile(row.dataset.path);
    };

    serverSel.onchange = loadFiles;
    fileSearchInput.oninput = () => renderFiles(fileSearchInput.value);
    keyInput.onchange = () => {
      localStorage.setItem(KEY_STORAGE_NAME, keyInput.value.trim());
      loadServers().catch(err => status.textContent = '❌ ' + err.message);
    };
    content.oninput = updateLineNumbers;
    content.onscroll = () => { lineNumbers.scrollTop = content.scrollTop; };

    document.getElementById('save').onclick = saveCurrentFile;
    document.getElementById('revert').onclick = () => {
      if (!currentFile) return;
      content.value = originalContent;
      updateLineNumbers();
      status.textContent = 'Reverted ' + currentFile;
    };
    document.getElementById('newWindow').onclick = () => window.open(window.location.href, '_blank');
    document.getElementById('exit').onclick = () => window.close();
    document.getElementById('undo').onclick = () => document.execCommand('undo');
    document.getElementById('redo').onclick = () => document.execCommand('redo');
    document.getElementById('cut').onclick = () => document.execCommand('cut');
    document.getElementById('copy').onclick = () => document.execCommand('copy');
    document.getElementById('paste').onclick = () => document.execCommand('paste');
    document.getElementById('validateJson').onclick = () => {
      try {
        JSON.parse(content.value);
        status.textContent = '✅ Valid JSON';
      } catch (err) {
        status.textContent = '❌ JSON: ' + err.message;
      }
    };
    document.getElementById('validateYaml').onclick = () => {
      const lines = content.value.split('\\n');
      const bad = lines.findIndex(l => /^\\s*[^#\\-][^:]*$/.test(l) && l.trim() !== '');
      status.textContent = bad >= 0 ? '⚠️ YAML likely invalid near line ' + (bad + 1) : '✅ YAML looks valid';
    };
    document.getElementById('prettifyJson').onclick = () => {
      try {
        content.value = JSON.stringify(JSON.parse(content.value), null, 2);
        updateLineNumbers();
        status.textContent = '✅ JSON formatted';
      } catch (err) {
        status.textContent = '❌ Cannot format JSON: ' + err.message;
      }
    };

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveCurrentFile();
      }
    });

    document.querySelectorAll('.menu-btn').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const name = btn.dataset.menu;
        const target = document.getElementById('menu-' + name);
        const shouldOpen = openMenu !== target;
        document.querySelectorAll('.menu-items').forEach(m => m.classList.remove('open'));
        document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('open'));
        openMenu = shouldOpen ? target : null;
        if (shouldOpen) {
          target.classList.add('open');
          btn.classList.add('open');
        }
      };
    });
    document.addEventListener('click', () => {
      openMenu = null;
      document.querySelectorAll('.menu-items').forEach(m => m.classList.remove('open'));
      document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('open'));
    });

    const params = new URLSearchParams(window.location.search);
    const keyFromUrl = params.get('key');
    const storedKey = localStorage.getItem(KEY_STORAGE_NAME);
    const initialKey = keyFromUrl || storedKey || SERVER_PROVIDED_KEY || '';

    if (initialKey) {
      keyInput.value = initialKey;
      localStorage.setItem(KEY_STORAGE_NAME, initialKey);
    }

    if (keyFromUrl) {
      params.delete('key');
      const nextQuery = params.toString();
      const nextUrl = window.location.pathname + (nextQuery ? '?' + nextQuery : '') + window.location.hash;
      window.history.replaceState({}, '', nextUrl);
    }

    loadServers().catch(err => status.textContent = '❌ ' + err.message);
    updateLineNumbers();
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
