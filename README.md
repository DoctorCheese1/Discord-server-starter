# Server Control Bot

A Discord bot for managing game servers using simple start and stop scripts.

This bot is **control-only** by design. It does not install servers, download files, or guess how a server should run. You define how servers start and stop — the bot executes and manages them.

---

## What This Bot Does

✅ Register servers
✅ Start servers
✅ Stop servers
✅ Restart servers
✅ Show server status
✅ Display server info
✅ Enable / disable servers

---

## What This Bot Does NOT Do

❌ Install game servers
❌ Download files
❌ Detect executables automatically
❌ Generate scripts for you

All servers **must already exist and work manually** before being added.

> New: folders inside `BASE_SERVER_DIR` (or `C:/Servers` by default) are now auto-added to `data/servers.json`.

---

## Basic Concept (Important)

Each server is just a folder on disk that contains scripts telling the bot:

* how to start the server
* how to stop the server

The bot does **not** care what game it is, what engine it uses, or how it was installed.

---

## Required Server Files

Every server directory **must contain**:

```
start.bat
stop.bat
```

These files define server behavior.

---

## Example Scripts

### start.bat

```bat
@echo off
cd /d "%~dp0"
start "" server.exe
```

### stop.bat

```bat
@echo off
taskkill /IM server.exe /F
```

> Always test these manually before registering the server.

---

## Folder Structure Example

```
C:\Servers\MyServer
 ├─ start.bat
 ├─ stop.bat
 ├─ server.exe
 └─ config\
```

---

## Registering a Server

Servers can be added through Discord commands **or** auto-discovered from your servers folder.

### Auto-discovery

On config read, the bot scans:

* `BASE_SERVER_DIR` (if set), otherwise
* `C:/Servers` by default

Every direct subfolder is auto-added into `data/servers.json` if it is not already present.

### Type auto-detection

Newly discovered folders are classified as:

* `minecraft` if common Minecraft files exist (`eula.txt`, `server.properties`, or a `minecraft*.jar`)
* `steam` if Steam artifacts are found (`steam_appid`, `steamcmd`, or `.acf`)
* `generic` otherwise

You can still edit server metadata later with `/config` commands.

---

## Available Commands

### /servers

Lists all registered servers and their current state.

---

### /status

Shows a short list of configured servers.

---

### /info id:<serverId>

Displays detailed information about a server:

* name
* ID
* type
* directory
* running state

---

### /start id:<serverId>

Runs the server's `start.bat` script.

---

### /stop id:<serverId>

Runs the server's `stop.bat` script.

---

### /restart id:<serverId>

Stops and then starts the server.

> Lifecycle commands (`/start`, `/stop`, `/restart`) currently run directly and are **not** blocked by iDRAC status checks.

---

### /config list

Lists all servers with status indicators.

---

### /config enable id:<serverId>

Enables a server.

---

### /config disable id:<serverId>

Disables a server (cannot be started while disabled).

---

### /config rename id:<serverId> name:<newName>

Renames a server.

---

### /config set-java id:<serverId> value:<true|false>

Sets whether the server is Java-based (used internally).

---

### /config set-steam id:<serverId> value:<true|false>

Sets whether the server is Steam-based (used internally only).

> These flags do **not** install or configure anything — they are metadata only.

---

## Design Philosophy

This bot follows a **control-first** architecture:

* You install and configure servers
* Scripts define how servers run
* The bot only executes and tracks them

This avoids:

* platform-specific bugs
* game-specific assumptions
* installer edge cases

---

## Common Issues

### Server does not start

* Run `start.bat` manually to confirm it works
* Check paths inside the script

### Server does not stop

* Ensure the correct process name is used
* Make sure the process is not running as another user

---

## Recommended Environment Variables

```env
BASE_SERVER_DIR=C:\Servers
```

Used as the auto-discovery root for server folders.

---


## Web File Editor (Optional)

You can run a built-in browser editor to change text-based game/server files without building a separate website.

Set environment variables:

```env
WEB_EDITOR_ENABLED=true
WEB_EDITOR_PORT=8787
WEB_EDITOR_API_KEY=your-strong-key
```

Then open: `http://<host>:8787/`

Features:
* lists registered servers
* lists editable text files under each server folder
* load/save files directly from browser

Safety limits:
* path traversal blocked (file must stay under server folder)
* allowed extensions only (`.txt`, `.json`, `.cfg`, `.ini`, `.properties`, `.yaml`, `.yml`, `.xml`, `.bat`, `.sh`, `.log`, `.conf`)
* max file size/content: 1MB

> Use `WEB_EDITOR_API_KEY` in production.

---

## Startup Behavior (Current)

- Server startup uses a direct Windows `.bat` launch flow (`cmd /c start "" "<start.bat>"`).
- This keeps startup behavior aligned with legacy script-driven control and avoids PowerShell quoting edge cases.

---

## Roadmap

- Planned: add SSH-native server startup for remote hosts while keeping direct `.bat` launch as fallback compatibility.

---

## Summary

* Servers are managed, not installed
* Scripts control behavior
* Discord is the control panel
* The bot remains game-agnostic and stable

---

