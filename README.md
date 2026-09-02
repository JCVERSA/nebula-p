<div align="center">

<img src="docs/images/banner.svg" alt="Nebula Bot" width="860"/>

# 🌌 Nebula Bot

**WhatsApp Media &amp; AI Command Center** — anime VF downloader, Gemini AI, dynamic commands and a full web control panel, in one container.

[![Version](https://img.shields.io/badge/version-1.1.0-8b5cf6?style=flat-square)](./package.json)
[![Node](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](./tsconfig.json)
[![Tests](https://img.shields.io/badge/tests-311%2F311%20passing-brightgreen?style=flat-square)](#-tests)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](./LICENSE)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Baileys%20multi--device-25D366?style=flat-square&logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![ffmpeg](https://img.shields.io/badge/ffmpeg-HLS%20%2B%20remux-007EC7?style=flat-square&logo=ffmpeg&logoColor=white)](https://ffmpeg.org)
[![Panel](https://img.shields.io/badge/panel-React%20%2B%20Express-61DAFB?style=flat-square&logo=react&logoColor=black)](./app.ts)

</div>

---

## 📸 What it looks like

Real bot output (VF by default, one high-speed link per episode, honest size labels):

```text
.a sparks of tomorrow s1 1-12 r1

📦 Nebula Novabox - Batch Media Preparation 🚀
🎬 Anime: Sparks of Tomorrow
🗣️ Language: VF          ← French dub by default (VOSTFR on request)
⚙️ Resolution: 480P
📦 Episodes to Process: 9

🚀 NEBULA NOVABOX - BATCH DOWNLOAD COMPLETED 🚀
📦 Ready Episodes: 9/9          ⏳ Links Validity: 2 Hours
📥 Direct Episode Links:
• 🎬 Episode 1: [88.93 MB]   🔗 https://your-domain/api/media/download/<token>
• 🎬 Episode 2: [89.84 MB]   🔗 …
```

The interactive flow defaults to VF too — and never lies about the language actually delivered:

```text
🎬 Novabox - Select Season 🎬
• Anime: Tomb Raider King
• Language: 🇫🇷 VF (Default)
💡 (Pour passer en VOSTFR, tape `.a vostfr`)
```

## ✨ Features

| | Feature |
|---|---|
| 📺 | **Anime VF downloader** — voir-anime.to (VF-first) with nakanime fallback, VidMoly/Voe HLS mirrors, cat-catch style segment downloader, honest quality+size labels, WhatsApp-friendly files (~90 MB/ep), MyAnimeList info cards (`.anime`, Jikan), anime identification from a screenshot (`.trace`, trace.moe) |
| 🗣️ | **VF by default** — quick mode *and* interactive menus; `.a vostfr` switches back; honest "VF non disponible" when a title has no dub |
| 🔔 | **New-episode watcher** — `.a watch` on a VF season: cron polling (default every 6 h), quiet hours 23h–7h, WhatsApp notification with the ready-made download command; `.a unwatch <title>` / `.a watchlist` |
| 📦 | **Batch episodes** — `1-12` ranges, sequential pipeline hardened for ~1 GB containers, one offline HTML download page per batch (per-episode buttons + "Tout télécharger" in Chrome, 2 h TTL), optional season ZIP via `NEBULA_BATCH_ZIP=1` |
| 🤖 | **Gemini AI** — chat, image generation, audio transcription, voice conversations with TTS, per-user daily budget + global concurrency cap; **NVIDIA NIM fallback** keeps `.ai` alive through Gemini outages (text, `meta/llama-3.3-70b-instruct` by default); defined persona (sober, mirrors the user's language, WhatsApp-tailored, overridable via `NEBULA_AI_PERSONALITY; per-conversation persistent memory (sliding 10 h TTL, rolling summary, `.ai forget`) | |
| 💬 | **WhatsApp multi-device** (Baileys) — QR pairing from the panel, auto-reconnect, bad-session recovery |
| 🧩 | **39 hand-written commands** — incl. native `.tiktok` / `.instagram` / `.facebook` / `.youtube` downloads, `.w` episode watch, `.rnyt` legacy-coins top-up + sandboxed panel-created ones (no fs/process/network, no restart) — the vendored 145-file legacy corpus is quarantined by default, opt-in via `NEBULA_ENABLE_LEGACY=1` (behind strict ACLs) |
| 🛡️ | **Group moderation** — antilink, antitag, welcome/goodbye, hidetag broadcasts, RoleGuard per-group access policies |
| 🖥️ | **Web control panel** — live simulator, secrets manager (masked), command customizer, analytics, ZIP export |
| 🛰️ | **One-command ops** — `manage.sh start/stop/update/doctor/env/logs/clean` on any VPS, behind a Cloudflare Tunnel |

## 🎥 Preview

![Nebula Bot preview](preview.gif)

## 🏗️ Architecture

```mermaid
flowchart LR
  subgraph Clients
    W["📱 WhatsApp users"]
    B["🌐 Browser (control panel)"]
  end
  subgraph CF["Cloudflare Edge"]
    T["Cloudflare Tunnel (HTTPS)"]
  end
  subgraph VPS["Container (managed via manage.sh)"]
    APP["Express + React panel :3000<br/>auth · rate-limit · /api"]
    ENGINE["Bot engine (Baileys)<br/>moderation · registry · 150+ cmds"]
    ANIME["Anime engine<br/>voir-anime.to → voembed/VidMoly → HLS"]
    HLS["Cat-Catch HLS downloader<br/>segments → ffmpeg remux"]
    STORE[("temp store<br/>/tmp · tokens · 2h TTL")]
  end

  W <-->|multi-device| ENGINE
  B -->|HTTPS| T --> APP
  APP --- ENGINE
  ENGINE --> ANIME --> HLS --> STORE
  ANIME --> G["Gemini AI (optional)"]
```

**Repo layout**

```text
server.ts (entry) ── createApp() (app.ts: auth, rate limiting, /api routes)
 ├── src/bot/botEngine.ts        Baileys socket, QR, reconnect, moderation
 ├── src/bot/commands/*.ts       individual commands (BotCommand interface)
 ├── src/bot/services/           anime clients, HLS downloader, streaming zip,
 │                               temp downloads, batch manager, proxies
 ├── src/bot/panelAuth.ts        HttpOnly session cookies (12h sliding)
 ├── app.ts                      panel SPA + media API + health
 ├── manage.sh                   VPS lifecycle: start/stop/update/doctor/env…
 └── docs/                       deployment, tunnel & migration guides
```

## 🚀 Quick Start

### On a VPS (recommended — one line)

```bash
curl -fsSL "https://raw.githubusercontent.com/JCVERSA/nebula-p/main/scripts/install.sh" | sh
```

This installs dependencies (git, Node ≥ 22, ffmpeg), clones the repo, builds it,
creates the `nebula` command available everywhere and offers the `.env` wizard.
Then:

```bash
nebula env        # APP_URL, PANEL_TOKEN, GEMINI_API_KEY… (if not done yet)
nebula start      # start + wait for the panel
```

The installer is idempotent — running it again just updates the installation.
Manual equivalent: `git clone -b main https://github.com/JCVERSA/nebula-p /root/p && cd /root/p && ./manage.sh setup`.

Then put it behind HTTPS with a Cloudflare Tunnel and set `APP_URL` —
see **[docs/MIGRATION_NOUVEAU_VPS.md](docs/MIGRATION_NOUVEAU_VPS.md)** (French, step-by-step).

Tip: `alias nebula='bash /root/p/manage.sh'` — then everything is `nebula <command>`.

### Local development

```bash
npm install
npm run dev        # panel at http://localhost:3000
```

Requirements: **Node.js ≥ 22** and `ffmpeg` on PATH for media — see [Requirements](#-requirements).

### Day-to-day operations

| Command | What it does |
|---|---|
| `./manage.sh start / stop / restart` | Lifecycle; start waits for the panel and tails the log on failure |
| `./manage.sh update` | `git pull --ff-only` → `npm install` (only if deps changed) → build → restart |
| `./manage.sh status` | Process RAM vs cgroup cap, panel + public URL probes, temp usage, disk |
| `./manage.sh logs [filter]` | Live log tail, optionally filtered (e.g. `logs NOVABOX`) |
| `./manage.sh env` | Interactive `.env` wizard — 26 documented keys, secrets masked |
| `./manage.sh doctor` | Full diagnostic: node/ffmpeg/.env/RAM/disk/network, exit 1 on blockers |
| `./manage.sh clean` | Purges orphan staging (>1h) and expired temp files (>3h) |

## 📺 Anime engine

Built and battle-tested against real mirrors (every fix traced in
[ANIME_DOWNLOAD_AUDIT.md](ANIME_DOWNLOAD_AUDIT.md), §8.1–8.18):

- **VF by default** from `voir-anime.to` (VF guaranteed by URL structure), nakanime VOSTFR fallback, VidMoly-first mirror ranking with Voe/voembed support
- **Honest labels** — real HLS variant resolutions and sizes; a fat 403 MB "480P" is auto-downgraded to the lightest ≤480p variant (fast-lane size guard)
- **Container-friendly** — sequential batches, disk-streamed segments with backpressure, capped V8 heap, streaming (STORE) ZIP writer instead of in-RAM archives, startup debris purge
- **Resilience** — when every mirror of an episode fails (CDN-level 403), the bot retries it on the secondary anime catalog (VF lists first, then VOSTFR; honest language in the filename) — disable with `NEBULA_VOSTFR_FALLBACK=0`
- **Media toolkit** — reply to any video/audio with `.m mp3 [kbps]`, `.m gif [fps] [width] [full]`, `.m vitesse 0.5–4`, `.m trim 1:20 3:45`, or `.m compress 50%|95mb` — FFmpeg recipes (palettegen GIFs, chained atempo, lossless trims, size-target compression with the audio track subtracted); oversized outputs arrive as a 2 h high-speed link. WhatsApp-fit anime compression is now deterministic (bitrate computed from ffprobe duration, target 92 MB)
- **Delivery** — batches >1 episode arrive as ONE offline HTML page: per-episode direct buttons + automatic "Tout télécharger" (temp links 2 h TTL, HTTP range streaming); single episodes still get a plain link; optional season ZIP behind `NEBULA_BATCH_ZIP=1`
- Resource ceilings: `NEBULA_NOVABOX_MAX_EPISODES` (12), `NEBULA_NOVABOX_MAX_BATCH_MB` (2048), `NEBULA_TEMP_MAX_BYTES` (4 GiB)

## 🔑 Environment Variables

Copy `.env.example` to `.env` (or run `./manage.sh env`). Highlights:

| Variable | Required | Description |
|---|---|---|
| `APP_URL` | for public links | Public panel URL (e.g. `https://bot.example.com`). Also enables the host-header guard — must match the tunnel hostname exactly |
| `PANEL_TOKEN` | recommended | Panel access key; exchanged for an HttpOnly session cookie, never stored in the browser. Auto-generated and printed once if unset |
| `GEMINI_API_KEY` | for AI | Google Gemini key (settable from the panel, masked display) |
| `NVIDIA_NIM_API_KEY` | optional | NVIDIA NIM key — AI fallback when Gemini is unavailable (free on build.nvidia.com) |
| `PORT` | no | HTTP port (default 3000) |
| `NEBULA_VF_DEFAULT` | no | `0` disables VF-by-default |
| `NEBULA_VOIRANIME_DISABLED` | no | `1` disables the voir-anime.to source |
| `NEBULA_BATCH_ZIP` | no | `1` re-enables the all-in-one season ZIP |
| `NEBULA_BATCH_CONCURRENCY` | no | Parallel episode downloads (default 1 — sequential; keep 1 under ~1 GB RAM) |
| `NEBULA_NOVABOX_MAX_EPISODES` / `_MAX_BATCH_MB` | no | Batch ceilings (12 / 2048) |
| `NEBULA_DOWNLOAD_TIMEOUT_MS` | no | Hard global deadline per episode download (default 600000 = 10 min) |
| `NEBULA_WATCH_CRON` / `_QUIET` / `_TZ` | no | Episode watcher schedule (`0 */6 * * *`), quiet window (`23-7`) and timezone (`Africa/Douala`) |
| `NEBULA_TEMP_MAX_BYTES` | no | Temp storage ceiling (4 GiB) |
| `NEBULA_AI_DAILY_LIMIT` / `_MAX_CONCURRENT` | no | AI budget (40/day/user) and concurrency (3) |
| `NEBULA_PANEL_COMMANDS` | no | `off` disables sandboxed panel-created commands |
| `NEBULA_ENABLE_LEGACY` | no | `1` re-enables the vendored legacy command corpus (quarantined by default) |
| `NEBULA_DATA_DIR` / `NEBULA_ENV_FILE` / `NEBULA_AUTH_DIR` | no | Runtime state, env file and WhatsApp session locations |

Secrets can also be managed from the panel (**Settings &amp; Access → API Secrets**): values are written atomically to `.env`, applied live without restart, and only ever shown masked. Only allowlisted variables can be set from the web UI.

## 🧪 Tests

```bash
npm test           # vitest — 311 tests across 34 files
npm run lint       # strict TypeScript typecheck
npm run build      # production build (client + server)
npm start          # serve the production build (capped V8 heap, gc exposed)
```

Tests run against an isolated temp data directory and never touch real WhatsApp sessions or the Gemini API. The suite covers the anime engine (labels, language routing, fast-lane guard), the streaming ZIP writer (byte-exact round-trips), temp-download purges and start-flag regressions.

## 🔒 Security Notes

- **Panel auth:** every `/api/*` route requires login; cookies are server-side HttpOnly + CSRF-checked (Origin/Referer); bearer tokens work for tooling
- **SSRF guard:** user-supplied URLs validated per redirect hop with DNS pinning + host allowlists
- **Sandboxed commands:** panel-created commands run in a `vm` with no fs/process/network
- **Host-header guard:** foreign `Host` headers rejected when `APP_URL` is set; temp links inherit the validated base URL
- **Resource caps:** streamed downloads with byte caps, temp quotas, batch limits, AI budgets
- ZIP export never embeds your live API key; simulator output is HTML-escaped

Details: [SECURITY.md](SECURITY.md), [AUDIT_REPORT.md](AUDIT_REPORT.md).

## 📚 Documentation

| Doc | Contents |
|---|---|
| [ANIME_DOWNLOAD_AUDIT.md](ANIME_DOWNLOAD_AUDIT.md) | Full anime-download engineering log: every bug, root cause and fix (§1–8.18) |
| [docs/MIGRATION_NOUVEAU_VPS.md](docs/MIGRATION_NOUVEAU_VPS.md) | Move to a new VPS/container; Cloudflare Tunnel on a bare domain (subdomain left empty) |
| [docs/GUIDE_DEPLOIEMENT_VPS.md](docs/GUIDE_DEPLOIEMENT_VPS.md) | Zero-to-production French guide (tunnel, pairing, doctor, troubleshooting) |
| [docs/CLOUDFLARE_TUNNEL_DEPLOYMENT.md](docs/CLOUDFLARE_TUNNEL_DEPLOYMENT.md) | Cloudflare Tunnel reference (tokens, headers, checklist) |
| [docs/RAPPORT_SYSTEME_TELECHARGEMENT.md](docs/RAPPORT_SYSTEME_TELECHARGEMENT.md) | Download-system design report |
| [PHASE2_STATUS.md](PHASE2_STATUS.md) · [PHASE3_SCOPE.md](PHASE3_SCOPE.md) · [RELEASE_NOTES_v1.1.0.md](RELEASE_NOTES_v1.1.0.md) | Hardening status, roadmap, release notes |

## 🧩 Extending

- **Add a command:** drop a `BotCommand` file in `src/bot/commands/` (see `ping.ts`) — auto-loaded at startup; or generate one from the panel (sandboxed, stored as data)
- **Data flow:** WhatsApp message → engine → moderation filters → command registry → command context (`reply`, `react`, `downloadMedia`, `isOwner`, `isAdmin`)
- **Local runner:** the panel's ZIP export ships a self-contained bot (transpiled commands, Baileys runtime, config, placeholder `.env`)

---

<div align="center">

**Nebula Bot** — built container-first, validated on real mirrors. ⭐ if it saves you time.

`./manage.sh doctor` should always end with *RIEN DE BLOQUANT* 🎉

</div>
