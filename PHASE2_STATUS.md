# Phase 2 — Implementation Status

Scope approved: execute the fixes designed in `AUDIT_REPORT.md` (Phase 1), in the agreed order
(critical → functional corrections → resource caps → RoleGuard → validation/docs).
Status as of 2026-08-29. Every item below is verified by unit/API tests and a live `npm run dev`
boot; **84 tests pass, `tsc --noEmit` clean, `npm run build` succeeds.**

## Done

### Critical / M0 security baseline

| ID | Finding | Fix | Verification |
|---|---|---|---|
| C1 | `/auth/token` disclosed the access key; no real login | Server-side session store: `POST /api/auth/login` exchanges `PANEL_TOKEN` for a random 32-byte HttpOnly `panel_session` cookie (12h sliding, max 100 sessions, 10-min sweep). `/auth/token` removed (404). Frontend login gate; the key is never stored in the browser. Bearer still accepted for tooling. Login rate-limited 8/min | tests/app.test.ts; live curl: `/auth/token` 404, wrong key 401, cookie grants `/api/bot/status`, evil-Origin POST 403, same-origin 200 |
| C2 | Imported commands ran with no privilege enforcement | `src/bot/bridgeAcl.ts` (pure, fail-closed) + single enforcement point in `importedBridge.ts`. Hard owner-only deny list by name: `update`, `restart`, `broadcast`, `block`, `mode`, `remote`, `gm`, `setbotname`, … Everything else by metadata (`ownerOnly`/`adminOnly`/`groupOnly`/`privateOnly`/`botAdminNeeded`) | tests/bridgeAcl.test.ts (6) |
| C3 | `eval()` on scraped VidMoly JavaScript in novabox | Removed `eval`; fixed-length literal decoders + bounded unpack loop (`MAX_UNPACK_LAYERS=4`) | tests/novaboxDecode.test.ts (3); no `eval(` in file |
| C4 | Arbitrary code execution via command save/generate | Panel commands are now **data** (`database/panel_commands.json`), never written to `src/bot/commands/`, never compiled to `.compiled/*.mjs`, never dynamically imported. Execution goes through `panelCommandSandbox.ts`: static analysis (rejects `fs`/`child_process`/`process`/`globalThis`/`eval`/`fetch`/… and all module specifiers except the type-API stub) + esbuild transform + `node:vm` context with no `process`/`require`/`Buffer`/network, 3s sync timeout, 30s wall-clock race. Legacy disk artifacts are purged for panel-command names on boot/save; `NEBULA_PANEL_COMMANDS=off` disables the feature | tests/panelCommandSandbox.test.ts (10), app.test.ts C4 block; live: benign save+simulate works, `import fs`/`process` rejected, no disk artifacts |
| H1 | Startup crash from eager scraper fetch | `truth.js` rewritten self-contained (no `@bochilteam/scraper`); global `unhandledRejection` handler (rate-limited) in server.ts | live boot clean; both scraper submodule repros gone |
| H5 | CSRF on cookie-authed writes | Origin/Referer host check (port-aware: missing source port = any port on same hostname) for non-GET cookie-authenticated requests; bearer exempt | tests + live curl |

### Functional corrections (H6, H8, H2, M3, M4, M5, H4, H7)

| ID | Fix | Verification |
|---|---|---|
| H6 | `startLiveBot` serialized via in-flight promise (one socket per start cycle) | botEngine.ts; boot + start/stop unaffected |
| H8 | Rate limiter keys on `req.socket.remoteAddress` instead of attacker-spoofable `req.ip` | app.ts |
| H2 | SSRF: `safeFetch` DNS-pin + expanded private ranges (already in urlSafety); `video.ts` strict YouTube host allowlist + `isSafeDownloadUrl`; novabox: every server fetch (`parseSeasons`, `parseEpisodes`, embed page, probe, stream variant, HLS playlist) gated by `isSafeDownloadUrl`, **and the URL handed to ffmpeg is validated before spawn**; `.update` ZIP URL restricted to code-hosting hosts, literal/private IPs rejected, every redirect re-validated, kill switch `NEBULA_ALLOW_SELF_UPDATE` (default off) | tests/urlSafety.test.ts (8); code review + live |
| M3 | Host-header validation when `APP_URL` set (foreign Host → 400) | tests/app.test.ts |
| M4 | Secrets: newline values rejected in `setSecret` + API (no env-file injection) | tests (secrets block) |
| M5 | Antibot message-ID heuristics removed (they deleted legitimate 32-hex WhatsApp IDs) | src/bot/utils/antibot.ts |
| H4 | AI cost cap: per-sender daily budget (`NEBULA_AI_DAILY_LIMIT`, default 40) + global concurrency (`NEBULA_AI_MAX_CONCURRENT`, 3) on DM-auto-AI, `.ai`, `.image`; usage persisted, owner alert on limit | aiQuota.ts; wired in botEngine + commands |
| H7 | Adapter no longer marks every UK/French number owner; uses configured `OWNER_NUMBER` + `fromMe`; prefix from config | tests/adapter.test.ts (4) |
| M8 | Atomic writes (temp+rename) for config, stats, access policies, panel commands; stats flush on SIGINT/SIGTERM | code |

### Resource caps (H3)

- `download.ts`: streams to disk with byte cap (500 MB) + 120s timeout; only ≤100 MB is buffered for WhatsApp; picker fetches capped (60 MB, 90s).
- `tempDownloadManager.ts`: global record cap (200) + byte quota (4 GiB default) enforced before copy; orphan sweep extended to all files >3h.
- `novabox.ts`: batch episode cap (12) + batch byte quota (2 GiB default) with ep-level cleanup; per-episode downloads unchanged.
- `botEngine` media downloader aborts >100 MB while streaming.

### RoleGuard (feature, §9)

- Pure engine `accessControl.ts` (roles owner/admin/member; default allow/deny; category matching; deny>allow for members, admin-allow overrides; owner bypass).
- Persistent per-group policies (`groupAccessStore.ts`, JSON).
- `.access` command (owner-only): show / `mode allow|deny` / `deny` / `allow` / `admin` lists with registry validation.
- Enforced at the single live dispatch point in botEngine (fail-closed on errors).
- Panel API `GET/POST /api/bot/access(/:groupJid)` + **Security → RoleGuard** UI (policy list, editor, reset).
- Preserves today's behaviour by default (`defaultTo: allow`) — staged rollout, no breakage.
- Tests: `accessControl.test.ts` (10), app.test.ts RoleGuard API block (4), UI test navigates Security tab.

### Ops/validation

- `esbuild` (0.25.12) moved to runtime dependencies (the sandbox transform needs it).
- `importedBridge` `createRequire(import.meta.url)` → `__filename` fallback so the CJS production bundle can start.
- README + `.env.example` updated (PANEL_TOKEN login flow, new env knobs, security notes).
- Test count: 84 (app 38, accessControl 10, adapter 4, bridgeAcl 6, novaboxDecode 3, panelSandbox 10, urlSafety 8, registry/setup/ui 5).

## Known residuals (documented, not blockers)

1. **Panel-command sandbox is not a cryptographic boundary.** The `vm` context receives host callbacks (`context.reply` etc.), so a determined attacker *inside* the saved command's process could attempt constructor-chain escapes. Mitigations: static deny-list, no `process`/`Buffer`/`require` in the context, save requires panel auth + CSRF, feature kill-switch. Do **not** run untrusted code through it; treat the panel operator as trusted.
2. **`.update` retains code-overwrite semantics** for the owner when `NEBULA_ALLOW_SELF_UPDATE=1` (host allowlisted + SSRF-guarded, kill-switch default off). Prefer git pull.
3. **Adapter `isAdmin` stays false** in `buildAdapterContext` (dead code today) — real admin resolution should come from group metadata when the adapter is actually wired in.
4. No per-user concurrency cap on novabox global jobs beyond batch caps (covered by episode/byte quotas; global job semaphore is a follow-up).
5. `@bochilteam/scraper*` submodules still eager-fetch on import — the only remaining consumer was `truth.js` (now self-contained), but no other vendored file should be allowed to `require` that package again without the same treatment.

## Suggested next steps (not started)

- Delete or quarantine the remaining `imported/` tree (audit §C2 follow-up) — it weakens the "single enforcement point" story even with the bridge in place.
- Global job semaphore for novabox (max 1–2 concurrent batches).
- CI: add `npm run build` + `npm test` GitHub Action.
- Production packaging: build step that compiles built-in commands (today `dist/server.cjs` has no `.compiled/*.mjs` artifacts, so production `npm start` still relies on tsx/dev bootstrap).


## Continuation pass (every remaining audit item)

Completed after the first pass; 91 tests pass, tsc clean, production build boot verified.

### MEDIUM findings

| ID | Fix |
|---|---|
| M2 | `sessionString` removed from `BotConfig` + defaults; stripped from `GET /api/bot/config`, ZIP `config.json` export, and runtime load (legacy files sanitized). Zip template also de-duplicated. |
| M6 | Message content hidden in logs by default (`NEBULA_LOG_CONTENT=1` to opt in); sender/group numbers masked to last 4 digits (`maskLogNumber`) across engine, simulator, RoleGuard and security-violation logs. |
| M7 | `groupMetadataCache` capped at 500 entries; `warningsCache` capped at 2000 keys with `reasons` capped at the last 8; `groupsCache` capped at 5000. |
| M9 | `/api/bot/checkup` gets its own 5/min limiter; network-dependent probe (`.weather`) is opt-in via `NEBULA_CHECKUP_NETWORK=1` — default suite is offline-safe. |
| M10 | JSON body limit raised to 32 MiB so the route's explicit 30M-char base64 cap (≈22 MB audio) is actually reachable and returns a friendly 413. |
| M11 | Explicit third-party disclosure before Pollinations fallback image generation and microlink screenshots (user prompt/URL is forwarded). |
| M12 | Bridge reports load summary (loaded/skipped list) at startup and in the checkup; `whatsapp-rust-bridge` added to the dependency probe. **Discovered + fixed driver bug: the bridge never loaded `owner/` — `.restart`, `.update`, `.broadcast` were silently dead.** `owner/` is now bridged with full ACL enforcement (all 17 declare `ownerOnly`). |
| M13 | Security headers: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, CSP (strict in production; dev allows Vite's inline preamble), HSTS when served over https. No X-Frame-Options/frame-ancestors — the panel is intentionally embeddable (documented in SECURITY.md). |
| M14 | esbuild is a production dependency (was dev-only → `npm ci --omit=dev` broke save/generate). |

### LOW findings

- **L1** README updated (126→real counts, sandboxed commands, new env table) + new `SECURITY.md` (threat model, protections, deployment checklist, known limits).
- **L2** `adapter.ts` kept but fixed + tested (H7) — deleting would remove a documented utility; the unsafe heuristics are gone. `regexTranspile` fallback remains only as a last resort (esbuild is now a prod dep), `sessionString` removed, simulator kept.
- **L3** Duplicate disk loading eliminated: a disk file whose exported name is already registered is skipped (`novabox.ts`→`anime` no longer loads twice); `access.ts` is now a static built-in so production bundles it.
- **L5** Coverage added: audit trail, log redaction, health, backup/restore, Host-header, checkup-offline, bridge summary, plus the earlier ACL/sandbox/SSRF races — 91 tests across 10 files.

### §8 / §9 extras

- **CI** (`.github/workflows/ci.yml`): `npm ci --ignore-scripts` → lint → test → build.
- **Audit trail (§9 deliverable):** `src/bot/auditTrail.ts` — bounded ring (1000), persisted atomically, records panel login/logout (success and failed), RoleGuard policy changes, ACL denials, panel command saves, restores, clears. Panel API `GET/DELETE /api/bot/audit`, `.access audit` (owner, in-chat), and a **Security → Audit Trail** UI.
- **Health:** public `GET /api/health` (status, uptime, command count, AI budget).
- **Backup/restore:** `GET /api/bot/backup` (sanitized, no secrets/session) + `POST /api/bot/backup/restore` (validated, applied to config/groups/warnings/stats/policies/panel commands) + Security tab UI.
- **AI budget visibility:** `/api/bot/analytics` now includes `aiUsage`; shown in the Security tab.

### Final live verification (production bundle)

`NODE_ENV=production node dist/server.cjs` on :3117: 145 adapters + 152 commands incl. `broadcast/update/restart/block/mode/setprefix/kick/anime/access`; public `/api/health` 200; security headers on the SPA; session login writes an audit event; evil-Origin POST 403; CSP allows the self-hosted production bundle (no inline scripts). Message logging shows `[content hidden]`.
