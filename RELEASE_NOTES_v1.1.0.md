# v1.1.0 — Security Hardening, RoleGuard ACL & CI

**Release date:** 2026-08-29
**Branch:** `main`
**Baseline:** `7cd5390` (PR #1 merge)
**Stack:** TypeScript / Express / React panel / Vitest
**Requirements:** Node.js **>= 22.22.2**

This release is the outcome of **Phase 2** of the security program: the fix list
designed in `AUDIT_REPORT.md` (Phase 1) has been implemented, verified, and shipped.
It hardens the panel from "demo-grade" to production-ready, introduces a real
login + declarative access-control layer (RoleGuard), and lands a green CI pipeline.

**Verification:** `npm ci --ignore-scripts` clean · `tsc --noEmit` 0 errors ·
**91 tests pass (10 files)** · `npm run build` succeeds · production bundle boots.

---

## What's new in v1.1.0

### 🛡️ Real panel login (replaces `/auth/token`)
- `GET /auth/token` **removed** (returns 404). The old endpoint publicly disclosed
  the panel key and unlocked every `/api/*` route.
- New `POST /api/auth/login` exchanges `PANEL_TOKEN` for a random 32-byte
  **HttpOnly** `panel_session` cookie (12h sliding, max 100 sessions, 10-min sweep).
- Login is rate-limited (8/min). Bearer token is still accepted for scripts/tooling.
- The key is **never stored in the browser**; the panel gates login behind a UI.
- Evil-Origin POST → 403; same-origin → 200 (CSRF, see below).

### 🔐 RoleGuard — declarative command access control (ACL)
- Pure engine `accessControl.ts` with roles `owner / admin / member`, category
  matching, and `deny > allow` precedence for members (admin-allow overrides, owner bypass).
- Persistent per-group policies (`groupAccessStore.ts`, JSON).
- Owner-only `.access` command: show / `mode allow|deny` / `deny` / `allow` / `admin`.
- Enforced at the **single live dispatch point** in `botEngine` (fail-closed on errors).
- Panel API `GET/POST /api/bot/access(/:groupJid)` + **Security → RoleGuard** UI.
- Default `defaultTo: allow` preserves today's behaviour — staged rollout, no breakage.

### 📋 Audit trail
- `src/bot/auditTrail.ts` — bounded ring (1000), persisted atomically.
- Records panel login/logout (success **and** failure), RoleGuard policy changes,
  ACL denials, panel command saves, restores, and clears.
- Panel API `GET/DELETE /api/bot/audit`, `.access audit` (owner, in-chat),
  and a **Security → Audit Trail** UI.

### 💾 Backup / restore
- `GET /api/bot/backup` — sanitized ZIP export (no secrets / no `sessionString`).
- `POST /api/bot/backup/restore` — validated, applied to config/groups/warnings/
  stats/policies/panel commands.
- Security-tab UI with export + restore controls.

### 🌐 Security headers
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy`, CSP (strict in production; dev allows Vite's inline preamble),
  and HSTS when served over https.
- No `X-Frame-Options`/`frame-ancestors` — the panel is intentionally embeddable
  (documented in `SECURITY.md`).

### ❤️ Health & AI budgets
- Public `GET /api/health` — status, uptime, pid, Node version, command count, AI usage.
- AI cost caps: per-sender daily budget (`NEBULA_AI_DAILY_LIMIT`, default 40) and
  global concurrency (`NEBULA_AI_MAX_CONCURRENT`, default 3) on DM-auto-AI, `.ai`, `.image`.
- Usage persisted; owner alerted on limit.
- `/api/bot/analytics` now surfaces `aiUsage` (seen in the Security tab).

### 🤖 CI (GitHub Actions)
- `.github/workflows/ci.yml` — `npm ci --ignore-scripts` → `npm run lint` →
  `npm test` → `npm run build` on Node 22.

---

## Security fixes

### Critical — C1–C4

| ID | Finding | Fix |
|---|---|---|
| **C1** | `/auth/token` publicly returned the panel key; no real login | Server-side session store; real `POST /api/auth/login` with HttpOnly cookie; `/auth/token` removed (404); login rate-limited |
| **C2** | Imported commands ran with **no** privilege enforcement | `bridgeAcl.ts` (pure, fail-closed) + single enforcement point in `importedBridge.ts`; hard owner-only deny list; metadata enforcement |
| **C3** | `eval()` on scraped VidMoly JavaScript in novabox | Removed `eval`; fixed-length literal decoders + bounded unpack loop (`MAX_UNPACK_LAYERS=4`) |
| **C4** | Arbitrary code execution via command save/generate | Panel commands are **data** (`database/panel_commands.json`), never written to disk or compiled to `.compiled/*.mjs`; executed via `panelCommandSandbox.ts` (static analysis + esbuild transform + `node:vm` with no `process`/`require`/`Buffer`/network, 3s sync / 30s wall-clock) |

### High — H1–H8

| ID | Finding | Fix |
|---|---|---|
| **H1** | Startup crash from eager scraper fetch (unhandled rejection) | `truth.js` rewritten self-contained; global `unhandledRejection` handler (rate-limited) |
| **H2** | SSRF gaps | `safeFetch` DNS-pin + expanded private ranges; `video.ts` strict YouTube host allowlist; novabox every server fetch gated by `isSafeDownloadUrl`; `.update` ZIP URL restricted & redirects re-validated; kill-switch `NEBULA_ALLOW_SELF_UPDATE` (default off) |
| **H3** | No resource caps on untrusted work | Byte/time caps on downloads; temp-download record + byte quota; novabox batch episode/byte caps; media downloader abort |
| **H4** | Open AI proxy (cost abuse) | Per-sender daily budget + global concurrency cap; persisted usage; owner alert on limit |
| **H5** | CSRF on cookie-authed writes | Origin/Referer host check (port-aware) for non-GET cookie-authenticated requests; bearer exempt |
| **H6** | `startLiveBot` race → duplicate WhatsApp sessions | Serialized via in-flight promise (one socket per start cycle) |
| **H7** | Latent privilege escalation in adapter | Real owner resolution via `OWNER_NUMBER` + `fromMe`; prefix from config |
| **H8** | Rate limiting bypass via spoofed `req.ip` | Rate limiter keys on `req.socket.remoteAddress` |

---

## Functional fixes (M2–M14)

| ID | Fix |
|---|---|
| **M2** | `sessionString` removed from config + defaults; stripped from `/api/bot/config`, ZIP export, and runtime load |
| **M3** | Host-header validation when `APP_URL` set (foreign Host → 400) |
| **M4** | Secrets: newline values rejected in `setSecret` + API (no env-file injection) |
| **M5** | Antibot message-ID heuristics removed (they deleted legitimate 32-hex WhatsApp IDs) |
| **M6** | Message content hidden in logs by default (`NEBULA_LOG_CONTENT=1` to opt in); sender/group numbers masked to last 4 digits |
| **M7** | Caches capped: `groupMetadataCache` 500, `warningsCache` 2000 keys / last-8 reasons, `groupsCache` 5000 |
| **M8** | Atomic writes (temp+rename) for config, stats, access policies, panel commands; stats flush on SIGINT/SIGTERM |
| **M9** | `/api/bot/checkup` gets its own 5/min limiter; network-dependent probe opt-in via `NEBULA_CHECKUP_NETWORK=1` |
| **M10** | JSON body limit raised to 32 MiB so the route's explicit 30M-char base64 cap is reachable and returns a friendly 413 |
| **M11** | Explicit third-party disclosure before Pollinations fallback image gen and microlink screenshots |
| **M12** | Bridge reports load summary at startup/checkup; `whatsapp-rust-bridge` added to probe; **fixed driver bug — `owner/` never loaded** (`.restart`/`.update`/`.broadcast` were silently dead) |
| **M13** | Security headers (see above) |
| **M14** | esbuild moved to production dependencies (`npm ci --omit=dev` no longer breaks save/generate) |

---

## Bug & test fixes

- **Per-worker test temp-dir isolation** — each Vitest worker now gets its own unique
  `.test-tmp/run-<pid>-<rand>` directory, eliminating the CI race where one worker
  wiped another's shared temp dir (`zipai.ts` ENOENT / `diskcmd` disappearing).
- **Node 22 workflow** — CI pins `node-version: 22` with `npm ci --ignore-scripts`.
- **Stale root `ci.yml` removed** — the single source of truth is now `.github/workflows/ci.yml`.
- Test suite expanded 38 → **91 tests across 10 files**, covering ACL, sandbox, SSRF,
  audit trail, log redaction, backup/restore, host-header, checkup-offline, and bridge summary.

---

## ⚠️ Upgrade notes

- **Node >= 22.22.2 required** (jsdom@30, undici@8). Older runtimes are unsupported.
- **Breaking panel-auth change:** the frontend no longer auto-fetches the token from
  `/auth/token`. On first visit it prompts for `PANEL_TOKEN` and exchanges it for an
  HttpOnly session cookie. Set `PANEL_TOKEN` explicitly, or a random key is generated
  and printed **once** to the server console at startup.
- **`.update` disabled by default.** The owner-only code-overwrite command requires
  `NEBULA_ALLOW_SELF_UPDATE=1` (host allowlisted + SSRF-guarded). Prefer a `git pull` + restart.
- **New `NEBULA_*` env knobs:** `NEBULA_PANEL_COMMANDS`, `NEBULA_AI_DAILY_LIMIT`,
  `NEBULA_AI_MAX_CONCURRENT`, `NEBULA_TEMP_MAX_BYTES`, `NEBULA_NOVABOX_MAX_EPISODES`,
  `NEBULA_NOVABOX_MAX_BATCH_MB`, `NEBULA_ALLOW_SELF_UPDATE`, `NEBULA_CHECKUP_NETWORK`,
  `NEBULA_LOG_CONTENT`. See `.env.example`.

---

## Known limits (documented, not blockers)

1. **Panel-command sandbox is not a cryptographic boundary.** The `vm` context receives
   host callbacks (`context.reply` etc.), so a determined attacker *inside* a saved
   command's process could attempt constructor-chain escapes. Mitigations exist
   (static deny-list, no `process`/`Buffer`/`require`, save requires auth + CSRF,
   kill-switch). **Do not run untrusted code through it** — treat the panel operator as trusted.
2. **`.update` retains code-overwrite** for the owner when `NEBULA_ALLOW_SELF_UPDATE=1`.
   Prefer `git pull`.
3. **Adapter `isAdmin` stays false** in `buildAdapterContext` (dead code today) — real
   admin resolution should come from group metadata once the adapter is wired in.
4. No per-user concurrency cap on novabox global jobs beyond batch caps.
5. `@bochilteam/scraper*` submodules still eager-fetch on import — the only remaining
   consumer `truth.js` is now self-contained, but no other vendored file should
   `require` that package again without the same treatment.

---

## Suggested next steps (Phase 3 proposals)

See **PHASE3_SCOPE.md** for the prioritized 16-item follow-up batch
(imported-tree quarantine, worker-isolated sandbox, `.update` removal, global job
governor, packaging, observability, multi-user roles, and more).
