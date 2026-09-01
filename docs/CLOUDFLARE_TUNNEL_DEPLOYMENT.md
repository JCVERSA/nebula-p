# Nebula Bot — Cloudflare Tunnel + PM2 Deployment Guide

This guide documents the deployment of Nebula Bot (`JCVERSA/nova`) behind a
**Cloudflare Tunnel** with **PM2** as the process manager inside a container that
has **no systemd**. It mirrors a verified, working production setup:

- Public hostname: `https://nebula.exemple.com`
- App in a Docker container at `/opt/nebula/nova`, run as `NODE_ENV=production`
- `cloudflared` (connector tokens, remotely-managed) runs **inside the same
  container** and forwards `http://localhost:3001`
- Runtime state lives **outside** the git checkout at `/var/lib/nebula/database`
  and `/var/lib/nebula/auth`
- Verified `http://127.0.0.1:3001/api/health` returns `{"status":"ok","commands":152,...}`
  and `https://nebula.exemple.com/api/health` returns HTTP/2 200 with the CSP
  header (`script-src 'self'` → production mode active).

> Cross-references used throughout: [`README.md`](../README.md),
> [`.env.example`](../.env.example), [`src/bot/tempDownloadManager.ts`](../src/bot/tempDownloadManager.ts).

---

## Table of Contents

1. [Overview & architecture](#1-overview--architecture)
2. [Prerequisites](#2-prerequisites)
3. [Clone & path layout](#3-clone--path-layout)
4. [Build](#4-build)
5. [Environment variables reference (.env)](#5-environment-variables-reference-env)
6. [PM2 full command reference (no systemd container)](#6-pm2-full-command-reference-no-systemd-container)
7. [Cloudflare Tunnel guide](#7-cloudflare-tunnel-guide)
8. [Temp download links](#8-temp-download-links)
9. [Verification checklist](#9-verification-checklist)
10. [Troubleshooting table](#10-troubleshooting-table)
11. [Security & operations notes](#11-security--operations-notes)

---

## 1. Overview & architecture

```
Internet
   │  https://nebula.exemple.com (Cloudflare edge, TLS terminated)
   ▼
Cloudflare Tunnel (cloudflared, connector token, INSIDE the container)
   │  http://localhost:3001  (no published ports needed)
   ▼
Express/React app — NODE_ENV=production, dist/server.cjs
   │
   ├── dist/index.html + assets      (built React SPA, served statically)
   ├── src/bot/*                     (Baileys WhatsApp engine, commands, AI)
   └── /var/lib/nebula/database + auth   (state, OUTSIDE the git checkout)
```

Key points:

- **HTTPS is mandatory.** The panel session cookie is set with
  `httpOnly: true`, `secure: true`, `sameSite: "none"` (see
  [`src/bot/panelAuth.ts`](../src/bot/panelAuth.ts)). A `Secure` cookie is only
  sent over HTTPS, so the panel login **will not work over plain HTTP** — the
  tunnel must present a valid TLS endpoint (Cloudflare does this automatically).
- **State lives outside the repo.** The git checkout holds code only. Databases,
  WhatsApp session, and `.env` are in volumes so that `git pull` / re-deploys
  never wipe them.
- **cloudflared runs in the same container** as the app, pointing at
  `http://localhost:3001`. This is why no ports need to be published.
- The app binds `0.0.0.0` (see [`server.ts`](../server.ts)) and reads
  `PORT` from the environment (`process.env.PORT || 3000`), so a container
  internal port of `3001` is fine.

---

## 2. Prerequisites

### Debian / Ubuntu base packages

```bash
apt-get update
apt-get install -y \
  git curl ca-certificates ffmpeg openssl \
  # nginx is OPTIONAL — only needed if you terminate TLS in front of the app
  # (not required for the Cloudflare-Tunnel-direct architecture below)
  gnupg
```

Verify:

```bash
node -v     # must be >= v22.22.x  (the repo requires node >= 22.22.2)
npm -v
ffmpeg -version   # first line should report a version
```

> **Why ffmpeg is required:** `src/bot/commands/video.ts` and
> `src/bot/commands/novabox.ts` spawn the system `ffmpeg` binary
> (`spawn("ffmpeg", ...)` in `novabox.ts`). Without it, video/novabox
> commands fail at runtime — and it also covers the case where
> `ffmpeg-static`'s postinstall binary download fails in your sandbox.

### Node.js 22 from NodeSource

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node -v      # confirm >= v22.22.x
```

---

## 3. Clone & path layout

### Recommended directories

| What | Path |
|---|---|
| Code (git checkout) | `/opt/nebula/nova` |
| Runtime state (config, groups, warnings, stats, policies, panel commands, AI quota) | `/var/lib/nebula/database` |
| WhatsApp Baileys session | `/var/lib/nebula/auth` |

### Clone into the right place (avoid the nesting pitfall)

If `/opt/nebula` is empty, `git clone` will create `/opt/nebula/nova` for you:

```bash
mkdir -p /opt/nebula /var/lib/nebula/database /var/lib/nebula/auth
cd /opt/nebula
git clone https://github.com/JCVERSA/nova.git nova
```

> **Common pitfall:** running `git clone ... nova` from *inside* an
> already-existing `/opt/nebula/nova` directory creates a nested
> `/opt/nebula/nova/nova`. Check with `ls /opt/nebula/nova` — if you see a
> `nova/` subfolder, move it up one level or re-clone from `/opt/nebula`.

### Ownership for a dedicated service user

```bash
useradd -r -s /usr/sbin/nologin nebula 2>/dev/null || true
chown -R nebula:nebula /opt/nebula/nova /var/lib/nebula
```

> If you run as `root` in a single-user container you can skip `useradd`, but
> keeping state owned by the app user is best practice.

### Why state must NEVER live inside the checkout

- `npm run build` and `git pull` operate on `/opt/nebula/nova`. If
  `database/`, `nebula_auth_info/`, or `.env` were inside it, a re-build or
  re-clone could **delete or overwrite your WhatsApp session and configuration**.
- The repo's `.gitignore` already excludes `database/`, `nebula_auth_info/`,
  `recovery/`, `.env*` (see [`.gitignore`](../.gitignore)), so they won't be
  committed — but they still live on the deployment disk inside the workspace.
  Point `NEBULA_DATA_DIR` and `NEBULA_AUTH_DIR` **outside** the checkout.

---

## 4. Build

Install and build from `/opt/nebula/nova`:

```bash
cd /opt/nebula/nova
npm ci --ignore-scripts --no-audit --no-fund
npm run build
```

- `npm ci` installs pinned versions from `package-lock.json`.
- `--ignore-scripts` skips native postinstall binaries (`ffmpeg-static`,
  `whatsapp-rust-bridge`) which are optional — the system `ffmpeg` covers
  video/novabox. Use this fallback if the `ffmpeg-static` postinstall network
  download fails.
- `npm run build` runs `vite build && esbuild server.ts ...`.

**Expected artifacts** (under `/opt/nebula/nova/dist/`):

```
dist/
├── server.cjs        # Node production server bundle (esbuild, CJS)
├── server.cjs.map    # source map
├── index.html        # built React SPA shell
└── assets/           # JS/CSS bundles
```

> The `[Registry] Failed to load source command "novabox": Cannot find module
> '.../src/bot/types.js'` line is a harmless, known warning in production: the
> bundled `dist/server.cjs` already contains that command. See §10 for details.

---

## 5. Environment variables reference (.env)

Create `/opt/nebula/nova/.env` (it is gitignored and **never committed**):

```bash
cd /opt/nebula/nova
open -e .env   # macOS, or use vim/nano on the server
```

The app loads `.env` via `dotenv/config` in [`server.ts`](../server.ts) (from
`process.cwd()` — so run PM2 **from** `/opt/nebula/nova`).

### `.env` reference table

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PANEL_TOKEN` | **Required** | auto-generated (random, printed once to console) | Panel login key. Set a long random value: `openssl rand -hex 32`. If unset, a random key is generated at startup and printed once to the server console (see [`app.ts`](../app.ts)). Also accepted as a bearer token for tooling. |
| `APP_URL` | **Required** | — | The public hostname, **no trailing slash**: `https://nebula.exemple.com`. Must match the tunnel hostname exactly. When set, requests with a foreign `Host` header are rejected with HTTP 400 (M3 host-header guard). Also drives absolute temp-download URLs. |
| `PORT` | optional | `3000` | HTTP port. The verified setup uses `3001`. |
| `GEMINI_API_KEY` | for AI features | — | Google Gemini key. Can also be set via the panel Secrets UI (written to `.env`). |
| `NEBULA_DATA_DIR` | optional | `./database` | Runtime state dir (config, groups, warnings, stats, audit trail, access policies, panel commands, AI quota). Verified value: `/var/lib/nebula/database`. |
| `NEBULA_AUTH_DIR` | optional | `./nebula_auth_info` | Baileys WhatsApp session dir. Verified value: `/var/lib/nebula/auth` (see [`src/bot/botEngine.ts`](../src/bot/botEngine.ts)). |
| `NEBULA_PANEL_COMMANDS` | optional | `on` | `on` (default) enables sandboxed panel-created commands; `off` disables the feature. |
| `NEBULA_AI_DAILY_LIMIT` | optional | `40` | Per-sender daily AI request budget. |
| `NEBULA_AI_MAX_CONCURRENT` | optional | `3` | Global cap on concurrent AI requests. |
| `NEBULA_TEMP_MAX_BYTES` | optional | `4294967296` (4 GiB) | Total bytes the temp-download storage may hold; records are capped at 200 regardless. |
| `NEBULA_NOVABOX_MAX_EPISODES` | optional | `12` | Cap on batch episodes per novabox request. |
| `NEBULA_NOVABOX_MAX_BATCH_MB` | optional | `2048` | Total bytes for a novabox batch. |
| `NEBULA_ALLOW_SELF_UPDATE` | optional | `0` (off) | **Keep at `0`.** `1` enables the owner-only `.update` command (downloads a code ZIP and rewrites the app). Prefer `git pull` + restart. |
| `ADMIN_NUMBERS` | optional | — | Comma-separated WhatsApp numbers granted the admin role for RoleGuard group policies. |
| `PUBLIC_URL` | optional | — | **Fallback** base URL for absolute links, resolved **only if `APP_URL` is unset** (see §8 and [`src/bot/tempDownloadManager.ts`](../src/bot/tempDownloadManager.ts)). |
| `NEBULA_ENV_FILE` | optional | `./.env` | Path of the env file the Secrets UI writes to (see [`src/bot/secrets.ts`](../src/bot/secrets.ts)). |
| `NEBULA_LOG_CONTENT` | optional | off | `1` opts in to logging message content (default hides it). |
| `NEBULA_CHECKUP_NETWORK` | optional | `0` | `1` enables the network-dependent `.weather` probe in `/api/bot/checkup`. |

> `.env` is gitignored (see [`.gitignore`](../.gitignore): `.env*`, with the
> exception of `.env.example`). Never commit it. `APP_URL` and `PANEL_TOKEN`
> are the two **required** values for the HTTPS/tunnel setup.

---

## 6. PM2 full command reference (no systemd container)

This container runs **without systemd**, so `pm2 startup` / systemd units are
**not available**. PM2 itself is PID 1 (or a child of the entrypoint).

### Install PM2

```bash
npm install -g pm2
```

### Start the production server

```bash
cd /opt/nebula/nova
NODE_ENV=production pm2 start dist/server.cjs --name nebula --time
```

> **IMPORTANT — `--env production` does NOT set `NODE_ENV`.** Only the
> `NODE_ENV=production` prefix (or the exported variable) does. Without it the
> app runs in **dev** mode (Vite middleware, `'unsafe-inline'` CSP, and
> `<script src>` SPA fallback differences). The verified production behavior
> (static `dist/`, CSP `script-src 'self'`) requires `NODE_ENV=production`.
>
> Env vars come from `.env` via `dotenv` (loaded in `server.ts`); the
> `NODE_ENV=production` prefix is the one thing you must pass explicitly.

### Status / process list

```bash
pm2 status          # compact live view
pm2 list            # full table (id, name, status, cpu, memory, uptime, restarts)
```

### Logs

```bash
pm2 logs nebula                 # live tail of both stdout+stderr
pm2 logs nebula --lines 200     # last 200 lines
pm2 logs nebula --nostream      # print once and exit (no live tail)
cat /root/.pm2/logs/nebula-out.log    # stdout
cat /root/.pm2/logs/nebula-error.log  # stderr
```

### Restart / stop / delete

```bash
pm2 restart nebula --update-env   # after editing .env
pm2 stop nebula
pm2 start nebula
pm2 delete nebula                 # remove from PM2 (does not kill existing unless you want it to)
```

### Persistence across container restarts (no systemd)

PM2's process list is **in memory**. It is not automatically restored when the
container restarts:

```bash
# After starting: save the process list
pm2 save

# After a CONTAINER restart:
pm2 resurrect        # reload the saved process list
```

Because there is no systemd, `pm2 startup` will not help. **The durable
alternative** is to run PM2 in **runtime mode as the container's PID 1
entrypoint**, which keeps the app alive as the foreground process:

```bash
pm2-runtime dist/server.cjs --name nebula
```

Put that in your container `CMD` (with `NODE_ENV=production` set in the
environment) so the container's lifecycle owns the process.

### Harmless production log warning

```
[Registry] Failed to load source command "novabox": Cannot find module '.../src/bot/types.js'
```

This is a **known, harmless** warning. The command is still bundled inside
`dist/server.cjs` (the verified deployment registers **152 commands** from
`getCommands().length` — this count is dynamic and depends on what loads at
runtime), so the runtime menu and functionality are unaffected. The warning is
the registry's attempt to load the `novabox.ts` source from disk; that source
branch only runs when `NODE_ENV !== "production"` (see `loadCommandModule` in
[`src/bot/commandRegistry.ts`](../src/bot/commandRegistry.ts)) and in the bundle
the command is already present. Ignore it.

---

## 7. Cloudflare Tunnel guide

This replicates the exact verified working setup: a **remotely-managed**
(connector token) tunnel whose `cloudflared` runs **inside the same container**
as the app.

### 7.1 Existing tunnel facts

- `cloudflared` runs as `cloudflared tunnel run --token-file /etc/cloudflared/token`
  — i.e. a **connector token** (remotely-managed), tunnel ID
  `c89ed500-9d4a-41d3-b3ca-8dc7bd960d1a`.
- Because it runs **inside the same container**, the tunnel's service URL is
  `http://localhost:3001`. **No published ports are needed.**
- The existing host `www.exemple.com` is served by the same tunnel and
  must be **left untouched**.

### 7.2 Add the public hostname (dashboard route)

Cloudflare Zero Trust dashboard → **Networks → Tunnels** → select tunnel
`c89ed500-9d4a-41d3-b3ca-8dc7bd960d1a` → **Public Hostname → Add**:

| Field | Value |
|---|---|
| Subdomain | `nebula` |
| Domain | `exemple.com` |
| Service Type | `HTTP` |
| URL | `http://localhost:3001` |

The DNS record (`nebula.exemple.com` → the tunnel) is **auto-created by
Cloudflare**. The existing `www` hostname is untouched.

> This hostname is added via the **dashboard** (not `config.yml`) because the
> tunnel is **token-file / remotely-managed**, so ingress is configured in the
> Zero Trust dashboard rather than a local config file.

### 7.3 Local `config.yml` equivalent (alternative setup)

If you instead use a local `/etc/cloudflared/config.yml` with an ingress
section, add the entry **above the catch-all**:

```yaml
tunnel: c89ed500-9d4a-41d3-b3ca-8dc7bd960d1a
credentials-file: /etc/cloudflared/<tunnel-id>.json

ingress:
  - hostname: nebula.exemple.com
    service: http://localhost:3001
  - hostname: www.exemple.com
    service: http://<web-browser-target>   # leave the existing entry untouched
  - service: http_status:404               # catch-all must remain LAST
```

Then validate and restart:

```bash
cloudflared tunnel validate
systemctl restart cloudflared      # or restart the in-container cloudflared service
```

> The ingress order matters: more-specific hostnames go **above** the
> catch-all, and the catch-all (`http_status:404`) is always **last**.

### 7.4 Required header semantics

- The tunnel forwards the **real `Host`** header. The app's M3 host-header guard
  rejects any request whose `Host` doesn't match `APP_URL`'s hostname (see
  [`app.ts`](../app.ts)). So `APP_URL` **must** equal the public hostname
  exactly: `https://nebula.exemple.com` (no trailing slash).
- `cloudflared` sets `X-Forwarded-Proto: https`, which the app uses to generate
  **absolute HTTPS** links (see §8 and the `updateServerBaseUrl` call in
  [`app.ts`](../app.ts)). It also lets the security-header middleware emit
  `Strict-Transport-Security`.

### 7.5 Cloudflare dashboard settings checklist

| Setting | Value | Why |
|---|---|---|
| SSL/TLS encryption mode | **Full (strict)** | End-to-end TLS to the origin (if using a proxy/Nginx layer). If the tunnel connects directly to the app over plain HTTP, **Full** (not strict) is fine; strict requires a valid origin cert. |
| **Always Use HTTPS** | **ON** | Forces HTTPS; needed because the session cookie is `Secure`. |
| Minimum TLS version | **1.2** | Baseline security. |
| **WebSockets** | **ON** | Baileys uses WebSocket for the WhatsApp connection. |
| **Rocket Loader** | **OFF** | Can reorder/inject scripts and break the strict CSP `script-src 'self'`. |
| **Auto-Minify** | **OFF** | Same — minifying JS/CSS inline can break the panel under strict CSP. |
| **Cache Rule** | `Hostname equals nebula.exemple.com` **AND** `URI path starts with /api/` → **Bypass cache** | Prevents stale API data and expired 410 download links from being cached. |
| WAF managed rules | **ON** | Extra protection on the public endpoint. |

> The app's CSP in production (`script-src 'self'`) is the reason Rocket Loader
> and Auto-Minify must be off — they can inject inline scripts that CSP blocks,
> leaving the panel blank.

---

## 8. Temp download links

Nebula produces **time-limited, public** download URLs for large media. They are
used when a file exceeds WhatsApp's direct ~100 MB send limit and for novabox /
batch ZIP exports.

### URL format

```
https://nebula.exemple.com/api/media/download/<48-hex-token>
```

- **Short alias:** `https://nebula.exemple.com/d/<48-hex-token>` (same handler).
- Served at `GET`/`HEAD`/`OPTIONS` for both paths (see
  [`app.ts`](../app.ts) and [`src/bot/tempDownloadManager.ts`](../src/bot/tempDownloadManager.ts)).
- The token is `crypto.randomBytes(24).toString("hex")` — **48 hex chars**,
  unguessable.
- **Public by design:** no authentication (these links are sent to WhatsApp
  users). They **do not** require a session cookie (the auth middleware skips
  `/api/media/download/*` and `/d/*`).
- **Resume support:** they set `Accept-Ranges: bytes` and handle `Range`
  requests (206 partial content).
- **Content-Disposition:** `attachment` by default; `?inline=true` serves inline.
- **CORS:** `Access-Control-Allow-Origin: *` (for direct browser downloads).
- **Cache:** `Cache-Control: private, no-cache, no-store, must-revalidate`.

### How the absolute base URL is resolved

`getServerBaseUrl()` (in
[`src/bot/tempDownloadManager.ts`](../src/bot/tempDownloadManager.ts)) resolves
in this **exact order**:

1. `process.env.APP_URL` (stripped of trailing slash) — **preferred**
2. `process.env.PUBLIC_URL` (fallback, only if `APP_URL` is unset)
3. `detectedServerBaseUrl` — learned per-request from the incoming `Host`
   header + `x-forwarded-proto` (via `updateServerBaseUrl`)
4. `""` → the link becomes a **relative** URL like
   `/api/media/download/<token>`, which is **broken when pasted in WhatsApp**.

**Checklist to get absolute HTTPS links:**

- Set `APP_URL=https://nebula.exemple.com` (no trailing slash).
- Ensure the tunnel/proxy sets `X-Forwarded-Proto: https` (cloudflared does).
- Do **not** set only `PUBLIC_URL` if you can set `APP_URL` — `APP_URL` wins and
  also enables the host-header guard.

### TTL / caps table

| Item | Value |
|---|---|
| ZIP exports (e.g. batch ZIP, `.update`-style archives) | **60 min** max TTL (capped at 60 even if a larger TTL is requested) |
| Other media | **120 min** default |
| Sweeper | runs every **5 minutes** (`setInterval(sweepExpiredDownloads, ...)`) |
| Active record cap | **200 records** (beyond → error) |
| Bytes cap | **4 GiB** by default (`NEBULA_TEMP_MAX_BYTES`); beyond → quota error |
| Storage dir | `os.tmpdir()/nebula_temp_downloads` (e.g. `/tmp/nebula_temp_downloads`) |
| Orphan sweep | any file older than **3h** is purged (ZIPs older than 60 min) |

The record/byte caps throw an error like
`"Temporary download storage quota reached. Please try again later."` (see
`registerTempDownload` in
[`src/bot/tempDownloadManager.ts`](../src/bot/tempDownloadManager.ts)). The
user's bot replies with that message when a new link can't be created.

### What happens on expiry / restart

- **Expiry:** a link past its TTL (or whose file was purged) returns **HTTP 410**
  with a styled **"Download Link Expired"** page (an HTML page when the client
  accepts HTML, or a JSON error otherwise). The file is deleted immediately.
- **Server restart:** the temp link registry is an **in-memory map**, so a
  restart makes **all previously issued links die** (they 410). There is no
  on-disk registry to resume from.

### How a user triggers a link

- **`.download` on a file > 100 MB** — the bot detects `fileSizeMB >
  DIRECT_MEDIA_MAX_MB` (100) and replies with a temporary link (see
  [`src/bot/commands/download.ts`](../src/bot/commands/download.ts)):
  `🚀 *TEMPORARY SECURE DOWNLOAD LINK* 🚀 ... ⏳ *Link Validity:* 2 Hours`.
- **novabox episodes** and **batch ZIP export** also call `registerTempDownload`.

### Config checklist for links to work through Cloudflare

1. `APP_URL=https://nebula.exemple.com` (no trailing slash).
2. `/api/*` **bypass cache** (Cache Rule, see §7.5) so live API data and expired
   410 links are never served stale.
3. Do **not** enable Cloudflare caching for `/api/`. The app already sets
   `private, no-cache, no-store` on temp responses; caching those would defeat
   the expiry semantics.
4. Ensure `X-Forwarded-Proto: https` (cloudflared sets this).

---

## 9. Verification checklist

Run these from the **container** first (loopback), then **public**:

### Local health (loopback)

```bash
curl -s http://127.0.0.1:3001/api/health
# {"status":"ok","uptimeSeconds":...,"pid":...,"nodeVersion":"v22...","commands":152,"aiUsage":...}
```

> Note: the host-header guard allows `localhost` / `127.0.0.1` / `::1` even when
> `APP_URL` is set (see [`app.ts`](../app.ts)), so the loopback check always works.

### Public health (through the tunnel)

```bash
curl -I https://nebula.exemple.com/api/health
```

Expect **HTTP/2 200** with headers including:
- `content-security-policy: default-src 'self'; script-src 'self'; ...`
- `x-content-type-options: nosniff`
- (and `strict-transport-security` when served over HTTPS)

### Panel login

Open `https://nebula.exemple.com` in a browser, log in with the
`PANEL_TOKEN`. If you see **"login cookie not set / no session"**, you are on
plain HTTP or the hostname doesn't match `APP_URL`.

### Start Bot + WhatsApp pairing

1. In the panel, click **Start Bot**.
2. Use **QR code** (scan with WhatsApp → Linked Devices) or **pairing code**
   (`/api/bot/pair-code` with a phone number).
3. The Baileys session is written to `NEBULA_AUTH_DIR` (`/var/lib/nebula/auth`).

### Temp-link end-to-end test

1. From WhatsApp, send a `.download <url>` for a file **over 100 MB**.
2. The bot replies with a `https://nebula.exemple.com/api/media/download/<token>`
   link.
3. Open it in a browser — it should download the file.
4. Confirm the link is absolute **https**, not `/api/media/...` or `http://`.

---

## 10. Troubleshooting table

| Symptom | Likely cause | Fix |
|---|---|---|
| `Could not resolve host` | Hostname not yet added / DNS still propagating | Add the public hostname in the Zero Trust dashboard and wait for DNS propagation (a few minutes). |
| **523 / 502 / 503** from Cloudflare | App not running, or tunnel service URL wrong | Check `pm2 status`; confirm the tunnel points at `http://localhost:3001` (not a published port). |
| **HTTP 400** from the app (in browser or curl) | `Host` header vs `APP_URL` mismatch | Ensure `APP_URL=https://nebula.exemple.com` (exact hostname, no trailing slash) and that the tunnel forwards the real Host. |
| Login cookie not set / can't stay logged in | Plain HTTP (cookie is `Secure`) | Confirm you're on **https** and "Always Use HTTPS" is ON (see §7.5). |
| Temp link is **relative** or `http://` | `APP_URL` unset or `X-Forwarded-Proto: https` missing | Set `APP_URL=https://nebula.exemple.com`; ensure cloudflared forwards `X-Forwarded-Proto`. |
| Blank panel (JS broken) | Rocket Loader / Auto-Minify intercepting scripts under strict CSP | Turn **Rocket Loader** and **Auto-Minify** OFF (§7.5). |
| `ffmpeg not found` / video or novabox errors | System ffmpeg missing | `apt-get install -y ffmpeg`. |
| `npm ci` EUSAGE / lockfile error | Lockfile missing — repo not cloned properly | Re-clone from `github.com/JCVERSA/nova.git` (with `package-lock.json`), then `npm ci`. |
| **StreamConflict** (WhatsApp disconnects/reconnects repeatedly) | Two live WhatsApp sessions / a stale session | Stop the bot, clear `NEBULA_AUTH_DIR`, then Start Bot and re-pair (fresh QR/pair-code). |
| Disk filling up | Temp-download accumulation or novabox batch overuse | Lower `NEBULA_TEMP_MAX_BYTES`, reduce `NEBULA_NOVABOX_MAX_EPISODES` / `NEBULA_NOVABOX_MAX_BATCH_MB`; the 5-min sweeper and 3h orphan sweep help but are not a substitute for caps. |
| `[Registry] Failed to load source command "novabox": ...types.js` | Known harmless warning (command is bundled) | Ignore. Verify with `/api/health` → `commands: 152` and by testing the `novabox`/`anime` command. |

---

## 11. Security & operations notes

- **Keep `PANEL_TOKEN` secret and long.** Generate with
  `openssl rand -hex 32`. Treat it like a root password. If lost, set a new one
  and restart (existing sessions stay valid up to the 12h sliding TTL).
- **Never commit `.env`.** It is gitignored. If you need to share a template,
  use `.env.example`.
- **State / backup** = `database/` + `auth/` + `.env`. Back up these three
  separately (e.g. daily volume snapshot or `tar`):
  ```bash
  tar -czf /var/backups/nebula-state-$(date +%F).tar.gz \
    -C /var/lib/nebula database auth \
    -C /opt/nebula/nova .env
  ```
- **Update procedure** (preferred over `.update`):
  ```bash
  cd /opt/nebula/nova
  git pull
  npm ci --ignore-scripts --no-audit --no-fund
  npm run build
  pm2 restart nebula --update-env
  ```
- **Prefer `git pull` over `.update`.** `.update` retains code-overwrite
  semantics and is **disabled by default** (`NEBULA_ALLOW_SELF_UPDATE=0`).
  Keep it at `0`.
- **Do not expose the app without TLS.** The panel cookie is `Secure`. Behind
  Cloudflare Tunnel over HTTPS this is satisfied automatically.
- **CSP is strict in production** (`script-src 'self'`). If you ever add inline
  scripts, they will be blocked — prefer external bundles (the built SPA works fine).

---

## Appendix — How these claims were verified

- `server.ts`: `dotenv/config` load, `await initRegistry()`, `createApp()`,
  listen on `process.env.PORT || 3000`, bind `0.0.0.0`, serve `dist/` when
  `NODE_ENV=production`, Vite middleware in dev.
- `app.ts`: security headers (CSP production `script-src 'self'`,
  `X-Content-Type-Options`, `Strict-Transport-Security`), `app.set("trust proxy",
  true)`, M3 host-header guard (`APP_URL` reject → 400 `Invalid Host header`),
  `updateServerBaseUrl` from Host + `x-forwarded-proto`, `/api/health`,
  `/api/media/download/:token` + `/d/:token` handlers (CORS `*`, `Range`,
  `Cache-Control: private, no-cache, no-store, must-revalidate`, 410 "Download
  Link Expired"), login rate limit 8/min, auth middleware skips media + auth
  routes.
- `src/bot/panelAuth.ts`: cookie `{ httpOnly: true, sameSite: "none",
  secure: true, path: "/", maxAge: 12h }`, `MAX_SESSIONS = 100`, sliding 12h,
  `sweep()` every 10 min.
- `src/bot/tempDownloadManager.ts`: `TEMP_DOWNLOAD_DIR = os.tmpdir()/nebula_temp_downloads`,
  `ZIP_MAX_AGE_MS` 60 min, `TEMP_MAX_TOTAL_BYTES` 4 GiB, `TEMP_MAX_RECORDS`
  200, `ORPHAN_MAX_AGE_MS` 3h, sweeper 5 min, `crypto.randomBytes(24).toString("hex")`,
  `getServerBaseUrl()` order `APP_URL → PUBLIC_URL → detectedServerBaseUrl → ""`,
  quota/full-throw messages.
- `package.json`: `name nebula-bot`, `version 1.1.0`, engines `node >=22.22.2`,
  scripts `dev`/`build`/`start`/`lint`/`test`/`test:coverage`.
- `.env.example`, `README.md`, `.gitignore`, `src/bot/config.ts`,
  `src/bot/database.ts`, `src/bot/commandStats.ts`, `src/bot/auditTrail.ts`,
  `src/bot/aiQuota.ts`, `src/bot/panelCommands.ts`, `src/bot/secrets.ts`,
  `src/bot/commandRegistry.ts`, `src/bot/commands/download.ts`
  (`DIRECT_MEDIA_MAX_MB = 100`), `src/bot/commands/novabox.ts`
  (`spawn("ffmpeg", ...)`), `src/bot/botEngine.ts` (`NEBULA_AUTH_DIR`).
