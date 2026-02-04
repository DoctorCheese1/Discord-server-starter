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

Servers are added through Discord commands.

When registering a server, you provide:

* a unique server ID
* the server directory path

Once registered, the bot can control it.

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

Used as a default location when registering servers.

---

## Summary

* Servers are managed, not installed
* Scripts control behavior
* Discord is the control panel
* The bot remains game-agnostic and stable

---


