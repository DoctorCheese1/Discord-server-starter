..

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

* `proxy` if proxy markers are found (`velocity.toml` in root or `config/velocity.toml`, `forwarding.secret`, `modern-forwarding.secret`, or a proxy jar name like velocity/waterfall/bungeecord)
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

### /config set-group id:<serverId> group:<label>

Sets a custom group label (example: `lobby`, `survival`, `network-a`) for organization and filtering.

---

### /config remove id:<serverId>

Removes a server from `data/servers.json`.

---

### /steam update [id:<serverId>] [all:<true|false>]

Runs `update.bat` through Task Scheduler for one Steam server (`id`) or all enabled Steam servers (`all:true`).

Notes:

* Provide either `id` or `all:true`.
* Only servers flagged as Steam are targeted when using `all:true`.

---

## Updating the Bot

Use the included updater from inside the cloned bot folder:

```sh
npm run update:bot
```

The updater checks for Git, confirms the folder is a Git repository, stashes local changes before updating, fetches the repository's default branch, applies the update with a fast-forward merge, and then reapplies the stash. You can override the source repository or branch when needed:

```sh
SERVER_CONTROL_BOT_REPO_URL=https://github.com/DoctorCheese1/Discord-server-starter.git SERVER_CONTROL_BOT_UPDATE_BRANCH=main npm run update:bot
```

---

### /group list [name:<groupName>]

Lists grouped servers, or only servers for a specific group.

### /group add id:<serverId> name:<groupName>
### /group remove id:<serverId>

Adds/removes a server from a group.  
For `/group add`, `id` is optional; if omitted, the group is applied to all enabled servers.

### /group start name:<groupName>
### /group stop name:<groupName>
### /group restart name:<groupName>

Runs lifecycle actions for all enabled servers in that group.

You can also target one server inside that group:

### /group start name:<groupName> [id:<serverId>]
### /group stop name:<groupName> [id:<serverId>]
### /group restart name:<groupName> [id:<serverId>]

When `id` is provided, only that enabled server in the selected group is targeted.

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


For Raspberry Pi / iDRAC-only control, you can run a lightweight mode:

```env
IDRAC_ONLY_MODE=true
```

`IDRAC_ONLY_MODE` is a boolean-like flag. The bot treats these values as **enabled**:

- `1`
- `true`
- `yes`
- `on`

Values are case-insensitive and trimmed, so `TRUE`, ` Yes `, and `on` all work. Any other value (or leaving it unset) means the mode is off.

When enabled, only `/idrac` commands are registered and startup skips server, Steam, web editor, and task-sync subsystems. Presence switches to an iDRAC-only status mode: **green/online + `Server Online (iDRAC)`** when power is on, and **red/dnd + `Server Offline (iDRAC)`** when power is off. Auto-deploy/hash checks still run in this mode, using the iDRAC-only command set signature.

---


## Chrome Extension (Local / Unpacked)

The extension in `chrome-extension/` is meant to be loaded directly from this repository as an **unpacked extension**.

It is **not automatically hosted/published on the Google Chrome Web Store**.

It is intended as a **Spigot premium plugins helper** to capture/use your own session cookies (`xf_user`, `xf_session`, optional `xf_tfa_trust`) so premium plugin download/install flows can authenticate with your account.

### Load it manually in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Choose the `chrome-extension/` folder from this repo

After making local changes to extension files, click **Reload** on the extension card in `chrome://extensions/`.

---

## Web File Editor (Optional)

You can run a built-in browser editor to change text-based game/server files without building a separate website.

Set environment variables:

```env
WEB_EDITOR_ENABLED=true
WEB_EDITOR_PORT=8787
WEB_EDITOR_API_KEY=your-strong-key
# Optional: auth state polling interval in ms (min 1000, default 3600000)
AUTH_CHECK_INTERVAL_MS=1000
```

Then open: `http://<host>:8787/`

Access tips:
* If running on the same machine: `http://localhost:8787/`
* If running on another host/LAN: `http://<server-ip>:8787/`
* If `WEB_EDITOR_API_KEY` is set, paste it into the **API Key** field in the page before loading files
* If API calls show `Unauthorized` / `access denied`, verify the key matches `WEB_EDITOR_API_KEY` and then click into another field to trigger reload
* You can also run `/webeditor` in Discord to confirm the URL/port and whether API-key auth is enabled

Features:
* lists registered servers
* lists editable text files under each server folder
* search files by name/path from inside the editor
* load/save files directly from browser
* Plugin Manager tab can resolve plugin download links from **Modrinth** (name/slug/page ID/URL, filtered by platform + MC version) or **Spigot** (latest resource file link)
* For paid Spigot resources, add your `xf_user` + `xf_session` cookies in the Plugin Manager to download with your own Spigot account session
* To update a Spigot plugin, set source to **Spigot** and enter the plugin page URL or numeric resource ID, then click **Install to /plugins** (older versioned jars for that plugin are replaced automatically)
* remembers API key in browser local storage for easier reconnects

Safety limits:
* path traversal blocked (file must stay under server folder)
* allowed extensions only (`.txt`, `.json`, `.cfg`, `.ini`, `.properties`, `.yaml`, `.yml`, `.xml`, `.bat`, `.sh`, `.log`, `.conf`)
* max file size/content: 1MB

> Use `WEB_EDITOR_API_KEY` in production.

### Spigot account cookies for paid plugins (`xf_user`, `xf_session`)

Paid Spigot plugins require your authenticated Spigot session. You can copy these values from your browser after logging into Spigot:

1. Sign in to https://www.spigotmc.org.
2. Open browser DevTools (`F12`).
3. Go to **Application/Storage** → **Cookies** → `https://www.spigotmc.org`.
4. Copy cookie values for:
   * `xf_user`
   * `xf_session`
5. Paste them into the Plugin Manager fields in the web editor.

Security notes:
* Treat these like passwords/session tokens.
* Do not share them.
* If exposed, log out of Spigot and back in to rotate session cookies.

---

## API Keys / Tokens (How to Get Them Again)

If you lost keys from older versions, you usually **cannot view the old secret again**.  
Generate a new one and update `.env`.

### 1) Discord bot token (`DISCORD_TOKEN`)

1. Open Discord Developer Portal: https://discord.com/developers/applications
2. Select your bot application.
3. Go to **Bot**.
4. Click **Reset Token** (or **Copy** if a visible token is available).
5. Put it in `.env`:

```env
DISCORD_TOKEN=your-new-bot-token
```

> Keep this secret private. If leaked, reset it immediately.

### 2) Web editor API key (`WEB_EDITOR_API_KEY`)

This key is local to your bot config. If you lost it, create a new random value and save it in `.env`:

```env
WEB_EDITOR_API_KEY=replace-with-a-new-random-secret
```

Quick Node.js generator example:

```cmd
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

PowerShell alternative:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

Then restart the bot and use the new key in the web editor login field.

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

---

## Advanced Control Features

### Safety confirmations

Dangerous commands require an explicit `confirm:true` option before they run:

* `/stop`
* `/restart`
* `/console clear`
* `/backup restore`
* `/config remove`
* `/idrac off`
* `/idrac reboot`

This is intended to prevent accidental shutdowns, destructive restores, or host power actions.

### Bot operator permissions

By default, if no permission environment variables are set, the bot treats all users as owners for backwards compatibility.
To lock the bot down, set one or more comma-separated Discord user ID lists:

```env
BOT_OWNER_IDS=111111111111111111
BOT_ADMIN_IDS=222222222222222222,333333333333333333
BOT_MOD_IDS=444444444444444444
```

Permission tiers:

* **owner**: full access
* **admin**: config, templates, backups, iDRAC power, and moderator actions
* **mod**: lifecycle, group, Steam update, schedule, backup create/list, and Minecraft RCON actions
* **viewer**: status, info, disk usage, audit, web editor status, and console read/search

### Persistent audit log

Bot control actions are written to `data/audit.jsonl` and can be reviewed with:

```text
/audit recent
```

Each audit entry records timestamp, user, action, status, and details so history survives bot restarts.

### Console log commands

Servers launched by the bot write to their console log path. You can inspect that log from Discord:

```text
/console tail id:<serverId> lines:50
/console search id:<serverId> query:<text>
/console clear id:<serverId> confirm:true
```

### Backup and restore commands

Folder backups are stored under `data/backups/<serverId>/` as copied directory snapshots:

```text
/backup create id:<serverId> label:<optional-label>
/backup list id:<serverId>
/backup restore id:<serverId> name:<backup-name> confirm:true
```

Backups skip transient PID files and include a `backup-manifest.json` file with source metadata.

### Disk usage command

Show the largest server folders or inspect one server:

```text
/disk summary
/disk summary id:<serverId>
```

### Per-server delayed schedules

Schedule one server action after a delay:

```text
/schedule run id:<serverId> action:<start|stop|restart|update> delay-minutes:<1-1440>
/schedule list
/schedule cancel id:<scheduleId>
```

For grouped delayed actions, keep using `/group schedule`.

### Starter script templates

Generate starter `start.bat`, `stop.bat`, and `update.bat` files inside an existing server folder:

```text
/template create id:<serverId> type:<generic|minecraft|proxy|steam>
/template create id:<serverId> type:minecraft overwrite:true
```

Templates are intentionally basic and should be reviewed before production use.

### Minecraft RCON helpers

Set RCON globally:

```env
MC_RCON_HOST=127.0.0.1
MC_RCON_PORT=25575
MC_RCON_PASSWORD=your-rcon-password
```

Or configure a server-specific RCON connection:

```text
/config set-rcon id:<serverId> host:<host> port:<port> password:<password>
```

Then run:

```text
/mc players id:<serverId>
/mc say id:<serverId> message:<message>
/mc command id:<serverId> command:<command-without-slash>
```

### Steam search registration

The Steam registry search handler is now exposed as a slash command:

```text
/steam search query:<game-name-or-appid>
```

### Web editor file transfer and backup-on-save

The web editor now creates a timestamped copy in `.webeditor-backups/` before overwriting an existing file unless disabled:

```env
WEB_EDITOR_BACKUP_ON_SAVE=false
```

Additional API endpoints are available for file transfer integrations:

* `GET /api/file/download?serverId=<id>&path=<relative-file>` downloads a file
* `POST /api/file/upload` with JSON `{ "serverId": "id", "path": "relative-file.txt", "base64": "..." }` uploads/replaces an allowed text file

The existing read-only key behavior also blocks upload, save, create, rename, duplicate, and delete actions.
