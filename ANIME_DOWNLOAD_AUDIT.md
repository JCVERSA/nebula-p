# Nebula Bot — Anime Download System (Novabox) — Full Audit

**Repository:** `JCVERSA/p` · Branch `arena/01a05555-p` · Commit `31fe212`
**Audit date:** 2026-08-31 · **Mode:** analysis + diagnostics — **the download pipeline source code was NOT modified**
**Deliverable added:** `scripts/anime-doctor.ts` (run `npx tsx scripts/anime-doctor.ts --full` on the server that hosts the bot) + this report.
**Update 2026-08-31 (VPS verification + fixes):** see §6 — the doctor confirmed a full Cloudflare 403 block on the user's VPS (R3), and the pipeline now supports an egress proxy via `NEBULA_ANIME_PROXY`.

---

## Executive summary — why downloads are failing

The anime command (`.a` / `.anime` / `.nv`) is a 6-stage scraping pipeline:

```
[1] search      POST https://anime-sama.to/template-php/defaut/fetch.php   (.asn-search-result)
[2] seasons     GET  /catalogue/<slug>/          → panneauAnime("Saison 1","saison1/vostfr")
[3] episodes    GET  /catalogue/<slug>/<season>/<lang>/episodes.js → var epsN = ['...']
[4] extract     per-mirror player scraping (Smoothpre/Sibnet/Sendvid/VidMoly/Ansembed + generic)
[5] download    Cat-Catch-style parallel HLS downloader → ffmpeg remux  (fallback: network ffmpeg)
[6] delivery    WhatsApp video/document (≤100 MB) or temp-download link
```

**Stages 1–3 are still compatible with the live site** (verified against anime-sama.to on 2026-08-31 and cross-checked with three actively-maintained scrapers of the same site). **Stages 4–5 are where the system rots**, for a mix of external and code-level reasons:

| # | Root cause | Type | Effect |
|---|------------|------|--------|
| **R1** | The player ecosystem rotated. Live `episodes.js` (2026-08-31) serves `lpayer.embed4me.com` (Lecteur 1), `ansembed.net`, `video.sibnet.ru`, `uqload.is`, `minochinos.com`. The bot has dedicated extractors only for **Smoothpre, Sibnet, Sendvid, VidMoly/Ansembed**. embed4me (the new primary player) is **provably unextractable** with the current code: its video id lives in the URL fragment (`#3maxc`, never sent to the server) and the real source comes from `https://lpayer.embed4me.com/api/v1/video?id=…` returning **hex-encoded AES-128-CBC JSON** (key `kiemtienmua911ca`, IV `1234567890oiuytr`) — none of which the bot implements. | Upstream drift | Most mirrors dead ⇒ "Stream unavailable" / "download temporarily unavailable" |
| **R2** | **ffmpeg is a silent hard dependency.** Every HLS download ends in an ffmpeg remux. If the host has no system ffmpeg *and* `ffmpeg-static`'s postinstall could not fetch its binary (it downloads from `release-assets.githubusercontent.com`, which is blocked on many corporate/CI networks — reproduced in this audit sandbox: `npm install` **fails outright**), all downloads fail with no warning at startup. | Environment | 100% download failure while search still works |
| **R3** | **Cloudflare / geo-blocking on anime-sama.to.** The site is behind Cloudflare and Arcom-blocked at French ISPs; it has rotated domains 7+ times (.fr→.org→.eu→.tv→.si→.to). The bot hardcodes `anime-sama.to` with plain axios (Chrome UA but Node TLS fingerprint). Maintainers of comparable scrapers added CF-challenge detection and TLS-fingerprint spoofing (`got-scraping`). If your server is in FR/EU or gets challenged, **stage 1 dies → every command replies "Aucun résultat trouvé"**. | Environment / anti-bot | Total outage, intermittent by server location |
| **R4** | **Packer regex rejects the canonical Dean Edwards form.** Both unpackers (`animeStreamExtractor.ts:116`, `novabox.ts:1460`) require the packed script to end `.split('|'))` and do not accept the standard `.split('|'),0,{}))` tail. Reproduced: canonical form → **no match**. The repo's own test fixture uses the non-standard form, which masks the bug (tests green, live pages can fail). | Code bug | Packed players yield no m3u8 |
| **R5** | **Sibnet protocol-relative URL bug** (`animeStreamExtractor.ts:216`): `src: "//db8.video.sibnet.ru/…"` is prefixed blindly → `https://video.sibnet.ru//db8.video.sibnet.ru/…` → 404. Active scrapers explicitly handle the `//` form. | Code bug | Sibnet mirror (priority 1 in the live mirror set) fails |
| **R6** | `resolveRequestedSeason` falls back to **1-based index** (`quickAnimeParser.ts:320`) — `.a <anime> s3` on a 2-season show silently returns **"Film 1"** as "Saison 3". Reproduced. | Code bug | Wrong content downloaded / confusing UX |
| **R7** | **Relative download links**: `tempDownloadManager.ts:157` builds `/api/media/download/<token>` when `APP_URL` is unset and the panel was never opened from a public host — unusable links pasted into WhatsApp for any file >100 MB and for all batch downloads. | Config / code | Batch users get dead links |
| **R8** | **Fabricated quality options**: when the HLS master can't be parsed, `fetchHlsTracksAndSizes` (`animeStreamExtractor.ts:443`) invents 4 tracks (480/360/720/1080) that all point at the unreachable master URL — the bot confidently offers resolutions that cannot download, then fails. | Code bug | Misleading UX, guaranteed failure |
| **R9** | `downloadHlsAppLevel` accepts `timeoutMs` but **never enforces it** (`hlsDownloader.ts:350` — parameter used zero times). Stalled segment fetches (10 s axios timeout × 5 retries × N segments × concurrency 8) can hang a batch far beyond intended limits. | Code bug | Batch jobs hang |
| **R10** | `urlSafety.ts:169`: if DNS resolution fails for a "trusted" host, traffic is **pinned to 1.1.1.1** — a magic fallback that guarantees TLS failures and masks the real DNS error. The trusted list is also stale (embed4me/uqload/minochinos/vidmoly.biz absent). | Code smell | Confusing failures on DNS issues |
| **R11** | Panel **Retry** for real batch jobs is a *simulation*: `batchDownloadManager.ts:261/519` replay fake progress and package **dummy text files as "episodes"** into a real ZIP presented to the user. | Design bug | Fake deliverables after retry |
| **R12** | Misc: `DEBUG_MEDIA` polarity inconsistent (`hlsDownloader` logs only when `=true`, `prepareLocalHlsPlaylist` logs unless `=false`); duplicated unpacker code in two files; mirror priority list still ranks Smoothpre/Sendvid first though they no longer appear in live episode lists; `checkVfExists` HEAD-only (breaks if the site rejects HEAD); batch flow probes 2 concurrent episodes × 8 segment workers on weak VPS. | Robustness | Noise, maintenance drag |

**Most probable single cause of "nothing works at all":** R3 (or the domain rotating again) — check with the doctor script in 60 seconds. **Most probable cause of "search works but no video ever arrives":** R1+R4+R5 combined with R2.

---

## 1. Verification performed

| Check | Result |
|---|---|
| `npm install` (clean sandbox) | ❌ **fails** — `ffmpeg-static` postinstall: `unable to verify the first certificate` / `release-assets.githubusercontent.com` unreachable. With `--ignore-scripts` it succeeds but leaves `node_modules/ffmpeg-static/ffmpeg` **non-existent** while the module still returns its path → runtime spawn errors (R2). |
| `npx vitest run` | ✅ 14 files, **138/138 tests pass** |
| `npx tsc --noEmit` | ✅ clean (including the new doctor script) |
| Live site probes (external fetch, 2026-08-31) | `anime-sama.to` **up and current** (homepage + catalog + episodes.js + a rendered ansembed player all serve content). `anime-sama.eu` DNS dead (old domain). GET on `fetch.php` → HTTP 500 (POST-only endpoint, expected). |
| Ground-truth cross-check | Compared with 3 actively-maintained scrapers of the same site: `SertraFurr/Anime-Sama-Nakanime-Downloader`, `Mocha1530/consumet.ts` (AnimeSama provider + Lplayer/VidMoly/MoveArnPre extractors), `Gowaru/gowaru-nuvio-providers`. Their code documents the *current* player landscape and extraction requirements. |
| Parser harness | Ran the repo's real `parseQuickDownloadParams`, `isExactAnimeMatch`, `resolveRequestedSeason`, `parseEpisodes` regex and `unpackDeanEdwards` against the live captured `episodes.js` and synthetic packer forms — outputs reproduced in Appendix A. |

### What is verified **still working** (don't chase these)

- `fetch.php` search endpoint + `.asn-search-result`/`.asn-search-result-title` markup — confirmed identical in `Gowaru`'s current extractor.
- `panneauAnime("…","…")` season markup — confirmed by 3 external scrapers + live catalog page.
- `var epsN = [...]` episodes.js format — **captured live**, parses correctly with the repo regex.
- Domain `anime-sama.to` is the current canonical domain (Aug 2026; tracked by multiple domain-trackers).
- `ansembed.net` embeds a plain absolute `.m3u8` URL in the player HTML (external extractors find it with a simple quoted-URL regex, no unpacking) → the bot's generic branch *should* extract Ansembed streams **if the request isn't blocked**.
- Quick-command parser: all documented forms (`.a jjk s3 all r2`, `ep6`, `e1,2,3`, `2-9`, `720p`, bare `6`) parse correctly (harness output in Appendix A).

---

## 2. Live ground truth — the 2026-08-31 player landscape

Captured from `https://anime-sama.to/catalogue/black-torch/saison1/vostfr/episodes.js` (a currently-airing show):

| eps list | Host | Bot support | Verdict |
|---|---|---|---|
| eps1 (Lecteur 1) | `lpayer.embed4me.com/#<id>` | generic branch only | ❌ **Cannot work**: fragment-player; source = `GET /api/v1/video?id=<id>` → hex AES-128-CBC JSON (`kiemtienmua911ca` / `1234567890oiuytr`), then `hls`/`source` field. Bot implements none of this. |
| eps2 (Lecteur 2) | `ansembed.net/embed-*.html` | branch 4 + generic grep | ⚠️ Should work when reachable; packed variant would hit R4 |
| eps3 (Lecteur 3) | `video.sibnet.ru/shell.php?videoid=…` | branch 2 | ⚠️ Breaks on protocol-relative `//cdn…` src (R5) |
| eps4 (Lecteur 4) | `uqload.is/embed-*.html` | generic branch only | ⚠️ Best-effort; m3u8 typically inside packed JS (R4) |
| eps5 (Lecteur 5) | `minochinos.com/embed/*` | generic branch only | ⚠️ Best-effort, no referer handling |

Hosts that appear on the site and have **no support at all**: `voe`, `filemoon` (bysesukior.com), `luluvdo`, `vidzy`, `oneupload`, `movearnpre`, `mivalyo`, `nakanime` (mirror site with XOR-encoded API). Meanwhile the bot still prioritizes **Smoothpre (1) and Sendvid (3)**, which no longer appear in the live lists, and ranks the two hosts that DO appear (`sibnet`=2, `ansembed`=4) with Sibnet first — and Sibnet has the R5 bug.

> The mirror sort order (`downloadWithAllMirrorsFallback`) means the practical download path today is: broken Sibnet → maybe-working Ansembed → dead embed4me → maybe uqload/minochinos. With ffmpeg also missing (R2), the success rate collapses to ~0.

---

## 3. Root-cause details & fixes

### R1 — Player ecosystem drift (High · upstream)
**Evidence:** live episodes.js (above); `SertraFurr/…/extract_embed4me_video_source.py`, `Mocha1530/consumet.ts …/lplayer.ts`, `src/var.py` host registry.
**Fix (recommended, in priority order):**
1. Add an **embed4me/Lplayer extractor**: id = URL fragment or `?id=`; `GET {origin}/api/v1/video?id=<id>&w=1920&h=1080&r=<origin>`; hex-decode → `aes-128-cbc` decrypt (key `kiemtienmua911ca`, IV `1234567890oiuytr`, PKCS7) → JSON → take `hls || source || url || file`; resolve relative against the player origin. ~40 lines, no new deps (`crypto` only).
2. Add a **uqload extractor**: normalize to `https://uqload.is/embed-<code>.html`, grep quoted m3u8, else unpack (fix R4 first).
3. Make the **mirror priority list data-driven** (`extractMultiHostStream` + both sort lambdas in `animeStreamExtractor.ts` share one `HOST_PRIORITY` map) and reorder to what's live: ansembed/sibnet/embed4me/uqload first.
4. Consider reading `getVidMolyUrl`'s "list 2" assumption: list 2 is Ansembed now, not VidMoly — behavior already OK (it matches `ansembed`), just rename/mind the logs.

### R2 — ffmpeg silent dependency (High · environment)
**Evidence:** this sandbox: `npm install` aborts on ffmpeg-static postinstall; with `--ignore-scripts`, `ffmpeg-static` default export = `…/node_modules/ffmpeg-static/ffmpeg` with `exists=false`. `novabox.ts`, `animeStreamExtractor.ts`, `hlsDownloader.ts` all resolve the path at module load and never verify existence.
**Fix:** (a) install ffmpeg system-wide (`apt install ffmpeg`) — required for WhatsApp delivery anyway; (b) add a **startup check** that logs a loud one-time error when the resolved binary doesn't exist; (c) optionally add `ffmpeg-static` existence to the panel checkup endpoint; (d) pin `npm ci` in CI with `--ignore-scripts=false` and network access to GitHub releases.

### R3 — Cloudflare / geo / domain rotation (High · environment)
**Evidence:** consumet fork explicitly detects `Just a moment`/`cf_chl_opt` and uses `got-scraping` (TLS fingerprint spoofing); French ISPs Arcom-block the domain family; the site has changed TLD 7+ times, most recently → `.to` (all confirmed via domain trackers, Aug 2026). The bot uses hardcoded `anime-sama.to` + plain axios everywhere (novabox.ts:122 searchAnime, parseSeasons, parseEpisodes, all extractors).
**Fix:** (1) make the domain configurable `NEBULA_ANIME_DOMAIN` with fallback probes (the doctor script already does this — port its logic); (2) run the doctor from the bot's server to confirm; (3) if challenged, add `got-scraping`/`curl-impersonate` support behind a flag, or a `HTTPS_PROXY` passthrough for scraper requests; (4) short-term operational relief: host/proxy via a non-FR region.

### R4 — Packer regex rejects canonical form (Medium-High · code)
**Evidence (reproduced, Appendix A):** `unpackDeanEdwards` matches the repo-fixture form `'…'.split('|'))` but NOT the canonical `'…'.split('|'),0,{}))`. External scrapers' patterns stop at `.split('|')` and ignore the tail.
**Fix:** in both regexes change the ending `\.split\(['"]\|['"]\)\)` → `\.split\(['"]\|['"]\)(?:\s*,\s*[^)]*)?\)`. Verified to match both forms. Add the canonical form as a second fixture in `tests/animeExtractor.test.ts` / `tests/novaboxDecode.test.ts`.

### R5 — Sibnet protocol-relative URL (Medium · code)
**Evidence:** `animeStreamExtractor.ts:216-218` prefixes `https://video.sibnet.ru` onto any src starting with `/`; `//db8.…` becomes `https://video.sibnet.ru//db8.…`. External scraper explicitly handles `//` → `https:`.
**Fix:** `if (s.startsWith("//")) s = "https:" + s; else if (s.startsWith("/")) s = "https://video.sibnet.ru" + s;`

### R6 — Season fallback returns films (Medium · code)
**Evidence:** reproduced — `resolveRequestedSeason(seasons, 3)` on [S1, S2, Film 1] returns Film 1 @ index 2; `.a jjk s3 …` would download the film while claiming "Saison 3".
**Fix:** only apply the index fallback when the entry at `requestedSeasonNumber-1` actually looks like a season (name/subPath matches `/saison|season/i`); otherwise return null so the command replies "S3 introuvable".

### R7 — Relative download links (Medium · config/code)
**Evidence:** `tempDownloadManager.ts:157`.
**Fix:** set `APP_URL` (documented in README); or default to refusing link-mode delivery and sending the file as a document; or fail loudly at registration time instead of emitting a relative URL.

### R8 — Fabricated quality tracks (Medium · UX correctness)
**Evidence:** `fetchHlsTracksAndSizes` else-branch pushes 4 fake tracks pointing at the master URL; `inspectHlsStreams` fallback does the same in novabox.ts.
**Fix:** when the master can't be parsed, return **no tracks** and let the command say "qualités inconnues, tentative directe" instead of offering r1–r4.

### R9 — Unenforced download timeout (Medium · code)
**Evidence:** `timeoutMs` parameter occurs once (declaration) inside `downloadHlsAppLevel`.
**Fix:** wrap the segment pool + ffmpeg tiers in a global `AbortController`-style deadline; check it inside the worker loop.

### R10 — urlSafety 1.1.1.1 pin (Low-Medium · code)
**Evidence:** `urlSafety.ts:169` returns `1.1.1.1` when a trusted host's DNS fails.
**Fix:** remove the magic address; let DNS errors surface. Refresh the trusted list (add `embed4me.com`, `uqload.is`, `minochinos.com`, `vidmoly.biz`, `topembed.*`, and consider deriving it from the HOST_PRIORITY map).

### R11 — Panel retry is simulated (Medium · design)
**Evidence:** `retryBatchJob`/`retryEpisode`/`simulateBatchDownload` replay timers and `finalizeJobZip` writes text-file dummies ("Simulated video payload…") into a real ZIP and marks the job completed. A real failed batch, retried from the panel, produces a **fake** ZIP.
**Fix:** wire retry to the real per-episode download path (`downloadWithAllMirrorsFallback`), or clearly mark simulated jobs and disable retry for real ones.

### R12 — Misc (Low)
- `DEBUG_MEDIA` polarity: make every check `=== "true"`.
- Deduplicate `decodeJsStringLiteral`/`decodeJsArrayLiteral`/unpacker (novabox.ts ⇄ animeStreamExtractor.ts).
- `checkVfExists`: fall back to GET with Range on HEAD failure; note the site now also exposes `vf1`, `vf2`, `va`, `vkr`, `vqc` language variants — the `/vostfr/ → /vf/` string replace misses them.
- Batch: `CONCURRENCY_LIMIT=2` × segment workers `8` = up to 16 parallel CDN fetches; make it env-tunable.
- `prepareLocalHlsPlaylist` logs unconditionally unless `DEBUG_MEDIA=false` (inverted default vs. the rest).

---

## 4. Diagnostic playbook (find *your* failure in ~1 minute)

On the server that hosts the bot:

```bash
npx tsx scripts/anime-doctor.ts          # DNS, CF, search, seasons, episodes, mirrors, HLS
npx tsx scripts/anime-doctor.ts --full   # + real 90 s segment download & ffmpeg remux probe
NEBULA_ANIME_DOMAIN=anime-sama.si npx tsx scripts/anime-doctor.ts   # probe an alternate TLD
```

Reading the results:

| Failing stage | Meaning | Go to |
|---|---|---|
| 0 ffmpeg | binary missing → all downloads fail silently | R2 |
| 1 HTTPS (CF/403/reset) | server-side network blocked (Arcom/ISP/datacenter) | R3 |
| 2 search | markup changed **or** stage 1 | R3 + `searchAnime` |
| 3 seasons | catalog markup changed | `parseSeasons` |
| 4 episodes | episodes.js format changed | `parseEpisodes` |
| 5 specific mirrors | extractor gaps | R1, R4, R5 |
| 6 tracks | CDN referer/403 or fabricated fallback | R8 |
| 7 download/remux | ffmpeg or segments 403 | R2, R9 |

For deeper tracing at runtime: `DEBUG_MEDIA=true npm run dev` — probe errors in `extractMultiHostStream` and `robustFetch*` are gated on it.

---

## 5. Prioritized fix plan

| P | Work | Effort | Impact |
|---|---|---|---|
| **P0** | Run the doctor on the production host; fix environment (ffmpeg present, egress/CF, `APP_URL`, current domain) | 1 h | Restores whatever is environmentally dead |
| **P1** | embed4me/Lplayer extractor + uqload extractor + shared HOST_PRIORITY reorder | ~0.5–1 day | Restores the majority of live mirrors |
| **P1** | Packer regex tail fix (+ test fixture) and Sibnet `//` fix | 30 min | Un-breaks packed players & Sibnet |
| **P2** | Domain configurability + CF detection logging; startup ffmpeg check; drop fake quality tracks; enforce download timeout | 0.5 day | Robustness & honest UX |
| **P2** | Real (non-simulated) panel retry; remove 1.1.1.1 pin; refresh trusted hosts | 0.5 day | Correctness |
| **P3** | Season fallback guard, VF variant languages, DEBUG polarity, dedupe unpackers, env-tunable concurrency | 0.5 day | Polish |

---

## 6. VPS verification results & shipped mitigations (2026-08-31)

The doctor was run on the production VPS (Debian 11, Node v22.23.2, system ffmpeg 4.3.9):

| Stage | Result |
|---|---|
| 0 ffmpeg / node | PASS |
| 1 anime-sama.to / .tv / .si | **FAIL — HTTP 403 Cloudflare/WAF block page on ALL domains** (DNS fine, `anime-sama.eu` NXDOMAIN) |
| 2–4 search / seasons / episodes.js | FAIL — all 403 (cascade of stage 1) |
| 5–7 | SKIP (no data) |

**Confirmed root cause on that host: R3 (Cloudflare IP-range block).** The parsers never receive HTML to parse.
Note: `fetch_page`-style fetches from a *different* egress succeed — the block is IP-based, not site-wide.

### Shipped in this update

1. **`NEBULA_ANIME_PROXY` egress proxy support** — new `src/bot/services/scrapingProxy.ts`, wired into **all 16 anime-pipeline axios calls** (search, seasons, episodes.js, VF checks, player probes, HLS manifests, direct MP4 download, robust fetchers in `hlsDownloader.ts`). Usage: set `NEBULA_ANIME_PROXY=http://user:pass@host:port` in `.env` (http/https CONNECT proxies; SOCKS not supported by axios' built-in client — export `https_proxy` + agent instead). When unset, behavior is unchanged.
2. **Doctor upgrades** — ASCII-only output (no terminal mojibake), `--proxy <url>` flag (also propagates to the repo's real code paths for stages 5–7), and Cloudflare-aware hints on every stage (previously stages 2–4 misattributed 403s to “markup changed”).

### Decision tree for a blocked VPS

1. Confirm the block scope from the VPS: `curl -sI -A 'Mozilla/5.0' https://anime-sama.to | head -3` — if curl is 403 too → IP-level block.
2. **Preferred:** put an HTTP proxy on an unblocked network in front of the bot (tiny `squid`/`tinyproxy`, a residential proxy, or Cloudflare-friendly hosting) → `NEBULA_ANIME_PROXY=... npm run dev`, verify with `npx tsx scripts/anime-doctor.ts --full --proxy http://...`.
3. If curl passes but Node/axios is 403 → TLS-fingerprint filtering; escalate to a fingerprint-spoofing HTTP client (`got-scraping` / `curl-impersonate`) — not yet implemented (tracked under R3 in §3).
4. FlareSolverr can solve JS challenges but keeps the same egress IP — only helps when the block is challenge-based, not IP-based.

### Unrelated crash observed on the VPS: esbuild deadlock in `npm run dev`

`fatal error: all goroutines are asleep - deadlock!` from the esbuild Go child right after panel start.
The trace (`internalContext.Rebuild`, `RunOnResolvePlugins`) is **Vite's dev-server dependency optimizer** (mounted by `server.ts` in dev), not the bot or anime code — the repo's own `commandCompiler.ts` uses plain `build()` without plugins/contexts. Known intermittent esbuild failure class (evanw/esbuild#3636, #3287). Remediation: re-run (often transient), `rm -rf node_modules/.vite`, check `free -m` / `df -h`, and for a stable VPS deployment use production mode — `npm run build && npm start` — which serves the pre-built panel and never runs Vite's optimizer at runtime.

---

## 7. Fix log — second push (2026-08-31)

Implemented after the VPS verification round (all unit-tested, 153/153 green):

| Finding | Status | Change |
|---|---|---|
| **R1** player drift | **FIXED (main hosts)** | New **embed4me/Lplayer extractor** (`animeStreamExtractor.ts`): reads the video id from the URL fragment/`?id=`, calls `GET {origin}/api/v1/video?id=…`, decrypts the hex **AES-128-CBC** JSON (key `kiemtienmua911ca`, IV `1234567890oiuytr`) and returns the real stream (`cfNative/cf/hls/source/url/file`). uqload/minochinos are covered by the generic branch now that the packer regex is fixed. |
| **R4** packer regex | **FIXED** | Both unpackers (`animeStreamExtractor.ts`, `novabox.ts`) now accept the canonical `.split('|'),0,{}))` tail. Regression test added with the canonical form. |
| **R5** sibnet URL | **FIXED** | `//cdn.host/...` sources are prefixed with `https:` instead of the site origin. |
| **R6** season fallback | **FIXED** | `resolveRequestedSeason` no longer maps a missing season onto a Film/OAV — index fallback applies only to entries that actually look like a season. |
| **R8** fabricated qualities | **FIXED** | `fetchHlsTracksAndSizes` no longer invents 480/360/720/1080 tracks pointing at an unreachable master; it returns `[]` and the menus clearly say "real qualities unavailable (estimates)". `inspectHlsStreams` (novabox) now delegates to the shared extractor instead of duplicating fake variants. |
| wrong file sizes | **FIXED** | Sizes are now computed from the **real variant playlist**: segment `#EXTINF` durations are summed and multiplied by the track bandwidth (falls back to the 24-min heuristic only if the CDN refuses). |
| stale mirror order | **FIXED** | Single shared `hostPriority()`: ansembed > embed4me > sibnet > sendvid > vidmoly/vmpx > smoothpre > other (Smoothpre/Sendvid no longer tried first although retired). |
| misleading labels | **FIXED** | "Play Ad-Free (VidMoly)" now shows the real host (e.g. `ansembed.net`). |
| R10 (partial) | DONE | `urlSafety` trusted hosts refreshed: `embed4me.com`, `uqload.is`, `minochinos.com`. |
| prod registry bug | **FIXED** | `npm start` now sets `NODE_ENV=production` — previously the registry tried to load `novabox.ts` from TypeScript source under plain Node and skipped it with `Cannot find module .../src/bot/types.js`. |

**Not yet done:** R2 startup ffmpeg check, R9 enforced download timeout, R11 real panel retry, multi-layer language variants (vf1/vf2/vkr/…).

---

## 8. nakanime.tv automatic fallback source (2026-08-31, third push)

Both of the user's VPS IPs are hard-blocked by anime-sama's Cloudflare
("Attention Required" + captcha = IP-range block; WARP egress is blocked too,
verified live). The site itself is up, and **nakanime.tv — a content mirror
of anime-sama — answers HTTP 200 from the blocked VPS**.

Implemented: when `fetch.php` search fails (403/network), the bot now falls
back to nakanime automatically — no configuration needed.

- New `src/bot/services/nakanimeClient.ts`:
  - XOR codec for their encrypted JSON API (`nkapiv1` + request-path key
    derivation), unit-tested against captured payloads.
  - `nakanimeSearch()` — `/api/catalog/search` (encrypted) → catalog results.
  - `nakanimeSeasons()` — embedded seasons JSON on the episode page, with the
    encrypted `/api/anime/<id>/episodes` API as fallback.
  - `nakanimeEpisodePlayers()` — per-episode `data-episode-id` +
    `POST /api/sources/anime` (encrypted) → the SAME player-mirror shape the
    anime-sama pipeline uses (`{listNumber: [urlByEpisodeIndex]}`), so the
    existing multi-host extractor, downloader and delivery flow work as-is.
- `novabox.ts`: `searchAnime()` tries anime-sama then nakanime;
  `parseSeasons`/`parseEpisodes`/`checkVfExists` branch on nakanime URLs.
- `urlSafety.ts`: `nakanime.tv` added to trusted hosts.
- Doctor stage 1 now also probes nakanime and reports whether the fallback
  path is available.

Limitations: nakanime carries language per player source (VF/VOSTFR shown as
separate "Lecteurs" instead of the VF/VOSTFR switch), and per-episode source
lookups are capped at 40 episodes/season with concurrency 4.

---

## Appendix A — Reproductions (run with the repo's real code)

```
$ tsx scripts/anime-audit-harness.mjs        (parser harness against live-captured data)

parseEpisodes lists: { "1": [lpayer.embed4me.com…], "2": [ansembed.net…], "3": [sibnet…], "4": [uqload.is…], "5": [minochinos…] }
mirror try order: sibnet (p2) → ansembed ×2 (p4) → embed4me ×2, uqload, minochinos (p5)
.a jjk s3 all r2      => query="jjk" canon="Jujutsu Kaisen" S=3 eps=all(all) res=r2 quick=true
.a jjk s3 ep6 r2      => S=3 eps=ep6(single) res=r2 ✓
.a jjk s3 e1,2,3,5,7,8,9 r2 => list ✓   |   .a jjk s3 2-9 r2 => range ✓
.a demon slayer s2 ep4 720p => res=720P ✓  |  .a jjk s3 6 r1 => single ✓
resolveRequestedSeason(3) on [S1,S2,Film 1] => { season: "Film 1", index: 2 }   ← DEFECT C
unpackDeanEdwards canonical(',0,{}') => NO MATCH (defect); reduced fixture form => matched

$ tsx scripts/anime-audit-repro.mjs

[A] canonical packer (',0,{}' tail)  -> NO MATCH — BUG CONFIRMED
[A] reduced packer (repo fixture)    -> works
[A] relaxed regex matches both forms -> true / true
[B] sibnet '//db8.…' -> https://video.sibnet.ru//db8.video.sibnet.ru/…  ← broken
[C] requested S3 of a 2-season show -> Film 1 @ index 2                  ← should be null
[D] timeoutMs occurrences inside downloadHlsAppLevel: 1 (parameter only)
[E] 1.1.1.1 fallback present in urlSafety.ts
[F] live hosts with a dedicated extractor: ansembed.net, video.sibnet.ru only
```

## Appendix B — Live evidence log (2026-08-31)

- `GET https://anime-sama.to/` → 200, current-season carousel (Black Torch, Tenmaku no Jaaduugar, …), catalogue links on `.to`.
- `GET https://anime-sama.to/catalogue/black-torch/saison1/vostfr/episodes.js` → 5 `var epsN` lists, hosts as tabulated in §2.
- `GET https://anime-sama.to/catalogue/solo-leveling/saison1/vostfr/` → language flags now include VA, VAR, VKR, VCN, VQC, VF1, VF2; player tabs "Lecteur 1/2/3".
- `ansembed.net/embed-8fgve1livt6b.html` → renders a playing video ("Black Torch S1 01 VOSTFR", 23:45) — streams exist server-side.
- `GET …/fetch.php?query=…` → HTTP 500 (POST-only; expected).
- `anime-sama.eu` → NXDOMAIN (dead old domain); `.to`/`.tv`/`.si` resolve (Cloudflare).

### 8.1 nakanime player-host coverage — the wider mirror ecosystem (2026-08-31, fourth push)

**Symptom that motivated this:** on a fresh deployment, `.a rezero s5 ep2 r2`
flowed perfectly through search → seasons → episodes, then died at the quality
probe ("Real qualities unavailable (protected playlist)") AND at download
(multi-mirror + legacy VidMoly both failed) — the WhatsApp card came back with
`Player Source: Direct Stream` and no player link. Root cause: nakanime serves
episodes from a MUCH wider player set than anime-sama, and the extractor only
knew the anime-sama subset (embed4me, smoothpre, sibnet, sendvid,
vidmoly/ansembed/vmpx/topembed).

**Player set observed on nakanime** (from the reference downloader's domain
registry) and the status after this push:

| Host(s) | Recipe | Status |
|---|---|---|
| ansembed.net | plain m3u8 | already supported |
| embed4me/lpayer | /api/v1/video + AES-128-CBC | already supported |
| video.sibnet.ru | direct mp4 | already supported |
| sendvid.com | direct mp4 | already supported |
| vidmoly.* (→.biz), vmpx, topembed | packed/HLS | already supported |
| smoothpre/dramiyos | packed HLS | already supported |
| **movearnpre.com, ovaltinecdn.com** | packed, HLS at `/stream/…` (relative → resolve against embed origin) | **added** |
| **uqload.is** | embed-`<code>`.html, plain or packed m3u8 | **added** |
| **vidzy.live/.org** | packed + fallback `var k=[..]` XOR(base64) body | **added** |
| **luluvdo.com / lulustream.com** | plain or packed m3u8 | **added** |
| **oneupload.net/.to** | jwplayer `file:"…m3u8|mp4"` | **added** |
| **filemoon / bysesukior.com** | `GET /api/videos/<code>` → AES-GCM JSON (key = key_parts[version] ‖ key_parts[31−version], b64url, tag = last 16 B) | **added** |
| **voe** (rotating domains, `/e/<code>`) | application/json payload: rot13 → strip `@$ ^^ ~@ %? *~ !! #&` → b64 → (ord−3) → reverse → b64 → JSON `.source` | **added** |
| **mivalyo.com, dingtezuni.com** | generic packed/m3u8 scan | **added (generic)** |

**Implementation** (`animeStreamExtractor.ts`):
- `scanPlayerHtmlForStreams(html, origin)` — pure scanner: unpack Dean-Edwards,
  then absolute m3u8/txt (master preferred) → relative `/…m3u8` → vidzy XOR body
  → direct mp4. URL regexes EXCLUDE `|` (the packer's word separator caused
  `url|nextword` captures — caught by a unit test).
- `probeGenericPlayerPage(url)` — fetch + scan + real HLS track resolution; used
  by the packed-player family AND as a **last-resort branch for any unknown
  host**, so a future mirror swap degrades gracefully instead of dying.
- `decryptFilemoonPayload`, `decodeVoePayload`, `vidzyXorDecode`, `isVoeStyleUrl`
  exported for tests (16 new unit tests incl. AES-GCM round-trip with Node
  crypto and a full voe chain round-trip). Suite: 178/178.
- `hostPriority` re-ranked: ansembed 1, embed4me 2, sibnet 3, sendvid 4,
  vidmoly 5, smoothpre/movearnpre 6, uqload/vidzy/lulu 7, oneupload/filemoon/
  mivalyo/dingtezuni 8, voe 9, unknown 10.
- `urlSafety.ts`: concrete new hosts added to both trusted lists (fast path
  only — unknown public hosts were already allowed via the DNS/private-IP
  check, so stream CDNs are never blocked).
- `scripts/anime-repro.ts`: one-shot replay of the whole `.a q sN epN rN`
  pipeline on the live host (search source, seasons, per-list player URLs,
  per-mirror HTTP status + extraction result, optional `--dl` download) —
  `npx tsx scripts/anime-repro.ts rezero 5 2 --dl`. `searchAnime`,
  `parseSeasons`, `parseEpisodes` are now exported from novabox for it.

### 8.2 Empty player slots — episode indexing vs DOM order (2026-08-31, fifth push)

**Found by** `npx tsx scripts/anime-repro.ts rezero 5 2` on the live host:
7 player lists of 75-80 entries each, but the entry for **ep2 was empty in
every list** — hence "protected playlist" at the quality probe, `Player Source:
Direct Stream`, no player link, and a failed download (empty mirror set).

**Root cause** (two compounding defects in `nakanimeEpisodePlayers`):
1. `lists[n][ep.number - 1] = url` indexed by EPISODE NUMBER while lookups ran
   over the refs in DOM order. nakanime's season script lists episodes
   newest-first (80..1), and the lookup cap kept only the first 40 refs — so
   slots 40..79 got filled and slots 0..39 stayed empty (padded with "").
2. `MAX_EPISODE_LOOKUPS = 40` silently truncated any season longer than 40
   episodes (Re:ZERO s5 lists 80).

**Fix** (`nakanimeClient.ts`):
- `normalizeNakanimeEpisodeRefs()` (exported, unit-tested): valid numbers,
  ascending sort, dedupe — DOM order and number contiguity no longer matter.
- Player lists are now filled POSITIONALLY (slot i = i-th episode of the
  listing), matching anime-sama's `epsN` array semantics the resolver expects.
- `MAX_EPISODE_LOOKUPS` 40 → 120 (bounded by the existing concurrency of 4).
- Season URLs now end with `/` so `season.url + "episodes.js"` no longer
  produces `season/5episodes.js` (previously healed by accident inside
  `parseEpisodes`).
- `scripts/anime-repro.ts` prints the season's sorted episode ref numbers when
  the source is nakanime; `nakanimeSeasonRefNumbers()` exported for it.

Suite: 183/183 (18 files, +5 nakanime indexing tests).

### 8.3 Quick-mode quality semantics + VF-by-default + language tiers (2026-08-31, sixth push)

**User report:** `.a rezero s5 ep2 r2` downloaded at **1080P (339 MB)** and
returned a temp link instead of a WhatsApp-playable video; language was always
VOSTFR; user expected VF by default and doubted multi-episode ZIP existed.

**Findings & fixes:**

1. **rN was an INDEX, not a quality.** Quick mode parsed `r2` then picked
   `variants[rIdx-1]` from the track list of the FIRST extractable mirror only
   (`resolveBestMirrorStream` was called without the requested resolution).
   For rezero ep2 that mirror was embed4me with tracks `[720P, 1080P]` →
   index 2 = **1080P**. Fixed:
   - `canonicalResolutionForChoice()` (quickAnimeParser, exported): r1=480P,
     r2=360P, r3=720P, r4=1080P (clamped), plus explicit `480p/720p/...`.
   - The quick flow now probes mirrors in reliability order, **searching every
     mirror for the exact canonical quality** (early exit on match; sibnet's
     direct 360P/480P mp4 qualifies), else keeps the nearest track via the
     improved `pickOptimalStream`.
   - `pickOptimalStream(requested)`: exact → tallest ≤ requested → smallest
     overall. No more silent upgrades to 1080P on fast lanes.
2. **VF by default.** anime-sama already defaulted to VF when present, but the
   nakanime path had no VF signal (`checkVfExists` is a no-op there). The
   sources API returns a language per player, so:
   - `nakanimeEpisodePlayersDetailed()` returns `{lists, labels}` (host +
     language per list); `nakanimeEpisodePlayers()` kept as wrapper.
   - Quick + interactive flows store `session.episodeListLabels` and switch
     the session to **VF when VF lists exist and the user did not force**
     (`.a vostfr` sets `session.languageForcedByUser`).
   - Downloads use `splitMirrorsByLanguage()`: session-language mirrors first,
     other-language mirrors as a second attempt (single + batch flows).
3. **Multi-episode ZIP already existed** (`.a <q> sN 1-5 r1`, `e2,e5`,
   `all`) — confirmed to the user with syntax; no code change.
4. `scripts/anime-repro.ts` now prints per-list `host (language)` labels.

Suite: 195/195 (19 files, +12 tests: canonical mapping, nearest-quality
fallback, VF label classification, language tier splitting).

### 8.4 VidMoly-first quality policy + honest Sibnet (2026-08-31, seventh push)

**User report:** `.a code geass s2 ep2 r2` delivered a **299.2 MB** file
labelled "360P". Root cause: the Sibnet extractor branch FABRICATED two tracks
("480P"/85 MB and "360P"/55 MB, hardcoded, same underlying MP4 of unknown real
resolution), and Sibnet sat at priority 3 — ABOVE vidmoly (5). The quick flow's
exact-quality search therefore matched the fake "360P" on sibnet before ever
probing vidmoly, downloaded the real ~1080p file, and labelled it "360P".

Fixes:
- `hostPriority()`: **VidMoly/vmpx/topembed = 1** (quality reference), ansembed
  2, embed4me 3, **sibnet 4** (fallback only), sendvid 5, packed family 6,
  uqload/vidzy/lulu 7, oneupload/filemoon/mivalyo/dingtezuni 8, voe 9.
- Sibnet branch: ONE honest track labelled `Original` with the REAL byte size
  (HTTP HEAD Content-Length). No more invented qualities → no more fake
  exact-matches on fast lanes.
- Quick flow keeps canonical rN semantics (§8.3): on vidmoly's real menu
  (480P/1080P), r2 has no exact match → nearest ≤ → smallest = real 480P →
  auto-compressed (<95 MB target) for in-chat delivery.
- Delivery card now shows the REAL host name when the pre-selected variant
  downloads directly (was "Direct Stream").
- `scripts/anime-repro.ts`: mirrors deduplicated per host before probing
  (7 mirrors → 4 unique hosts on rezero s5; that was the slowness the user
  interrupted) + extraction-stage timing.

Design report: docs/RAPPORT_SYSTEME_TELECHARGEMENT.md (cat-catch source
analysis: variant listing from #EXT-X-STREAM-INF, HEAD-sampled size estimate,
6-thread segment downloader — our downloadHlsAppLevel already matches/exceeds
it at 173 MB/19.8 s).

Suite: 196/196 (19 files).

### 8.5 Latency: kill the compression black hole + early-exit quality scan (2026-08-31, eighth push)

**User report:** ~15 min perceived wait for the temp link on `.a code geass s2
ep2 r2` (VF, 480P, 115.2 MB). Log timestamps told the real story: command at
5:05:55, link registered 5:08:16 — **2 min 21 s in the bot**, the rest being
WhatsApp delivery/queueing. Inside those 2:21:

- ~120 s: an x264 transcode attempt doomed from the start (115 MB > 95 MB
  threshold, `-preset fast`, 120 s kill timer, silent catch → raw file kept).
  Pure waste: the outcome (link) was identical without it.
- ~20-40 s: episode-player lookups (25 POSTs) + quality scan walking EVERY
  mirror of the episode seeking an exact 360P that does not exist on vidmoly.

Fixes:
- **Compression policy**: only when the raw file exceeds the 100 MB WhatsApp
  document ceiling (95–100 MB sends fine as a document — no transcode), preset
  `veryfast`, `-threads 0`, and every outcome is logged (OK + sizes + duration,
  no-smaller-file, timeout/failure). No more silent black hole.
- **`resolveCanonicalQualityTrack()`** (animeStreamExtractor, exported): the
  FIRST mirror with usable tracks decides (vidmoly-first order), exact canonical
  quality or nearest — one probe in the common case instead of one per mirror.
- **Players cache**: `nakanimeEpisodePlayersDetailed` results cached 10 min per
  season (retries/batch follow-ups skip up to 120 source lookups);
  `clearNakanimePlayersCache()` exported.
- **Timings everywhere**: players fetch, quality scan (probe count implicit),
  compression, total pipeline, and WhatsApp send resolution per lane — the next
  slow run is diagnosable from `/root/bot.log` alone.

Expected single-episode latency now: players 10-30 s (cached: ~0 s) + scan
1 probe (~2-5 s) + download 5-15 s + remux ~2-5 s => **~20-40 s to link**
(compression only when >100 MB, and it now actually finishes or logs why).

Suite: 201/201 (19 files, +5 resolver tests with injected probe).

### 8.6 nakanime language labels are unreliable — VF no longer auto-selected (2026-08-31, ninth push)

**User report:** `.a code geass s2 ep2 r2` delivered a file carded `VF` whose
audio was NOT French. The download itself had correctly used the vidmoly list
nakanime labels `VF` (embed-nmi8na05x8w1 → file hiqgnufyody7, 115.2 MB — a
different file from the VOSTFR-labelled vidmoly list, 84.7 MB), so the
selection logic worked as designed: **nakanime's language metadata itself is
wrong for that player** (labelled VF, actually VOSTFR). A server cannot hear
the audio track, so this cannot be verified programmatically.

Policy changes:
- nakanime VF labels now only REGISTER `VF` as an available language (so
  `.a vf` / `.a <q> sN epN vf rN` works and prefers VF-labelled lists via
  splitMirrorsByLanguage) — they no longer auto-select VF. Default is VOSTFR
  again, which is honest in both directions.
- Card "Play Ad-Free (vidmoly…)" link: was ALWAYS the first vidmoly list
  regardless of language/selection (contradicted the downloaded file and fed
  the confusion). getVidMolyUrl() now takes labels+language and picks the
  vidmoly list matching the session language first; legacy order otherwise.
- anime-sama direct path unchanged (VF detection there is URL-based and
  reliable).

Open: user ground-truth check (browser) of the two VF-labelled players —
vidmoly embed-nmi8na05x8w1 and sibnet videoid=3204263 — to decide whether
per-host label trust (e.g. trust sibnet VF, ignore vidmoly VF) can safely
restore a VF-by-default on nakanime.

Suite: 201/201 (19 files).

### 8.7 franime.fr — dedicated VF source with optional FlareSolverr (2026-08-31, tenth push)

**Context:** nakanime's language labels proved unreliable (§8.6), so true VF
needs a VF-first source. User suggested franime.fr; verified live from the
production VPS:

- `GET https://api.franime.fr/api/animes/` → **200, ~10.8 MB** JSON catalog,
  no challenge. Per anime: seasons → episodes → `lang.vf.lecteurs[]` /
  `lang.vo.lecteurs[]` (player names per language). Reliable VF ground truth.
- `GET /api/anime/{id}/{s0}/{e0}/{vf|vo}/{lecteurIdx}` → player URL as text,
  but fronted by a **Cloudflare managed challenge** on datacenter IPs
  (verified: both probes returned "Just a moment..."). Referer + browser UA do
  not bypass it.

**Implementation**:
- `src/bot/services/franimeClient.ts`: catalog fetch with 6 h disk cache
  (`/tmp/franime-catalog.json`), local fuzzy title search (accent/punct
  insensitive), seasons/season-info from the catalog, per-episode player URLs
  (one call per lecteur, concurrency 4, ≤10 lecteurs), CF-challenge detection
  (`isCloudflareChallenge`), and optional one-time challenge solving via
  **FlareSolverr** (`FLARESOLVERR_URL`) caching `cf_clearance` + matching UA
  for 30 min.
- Quick flow (`.a <q> sN epN vf rN`): franime is tried FIRST for VF — the
  season is translated into the standard session shape and player URLs are
  resolved LAZILY for the requested episodes only (`fillFranimePlayers`,
  capped at MAX_BATCH_EPISODES). Any failure (no VF, CF, network) falls back
  to the nakanime path. If franime is CF-blocked with no solver, the user gets
  an actionable message (docker one-liner + env) instead of a dead card.
- `scripts/franime-probe.ts "<q>" [s] [ep] [--dl]`: one-shot VF-path diagnostic
  (catalog, search, lecteurs, VF coverage, player URLs, extraction, download).
- Doctor stage 1 now probes the franime catalog (PASS/WARN + solver hint).
- `.env.example`: documented `FLARESOLVERR_URL`.

Suite: 208/208 (20 files, +7 franime tests).

### 8.8 franime parked behind NEBULA_FRANIME_ENABLED (2026-08-31)

User decision: drop the franime VF path for now (solver friction vs. value).
The §8.7 implementation stays in the tree but is fully inert by default — the
quick-flow branch and the doctor probe are gated behind `NEBULA_FRANIME_ENABLED=1`,
so `.a ... vf` behaves exactly as in §8.6 (nakanime VF-labelled lists, honest
VOSTFR default) with zero franime network calls. Re-enable any time by setting
the flag (+ `FLARESOLVERR_URL` for player URLs).

### 8.9 voir-anime.to — VF-by-structure source, live from datacenter IPs (2026-08-31, eleventh push)

**Selection:** franime parked (§8.8), Fluneo dropped (user). Candidates re-checked
live; **VoirAnime (voir-anime.to)** won — verified from the production VPS:

- HTML pages answer **200 from the datacenter IP** (only `/wp-json/` is CF-403,
  unused). WordPress "Madara" theme, no challenge on content pages.
- **VF is structural**: VF entries carry the `-vf` slug suffix (title " (VF)") —
  the French dub is guaranteed by construction, unlike nakanime labels (§8.6).
- Episodes: `/anime/<slug>/<ep-slug>-NN-vf/` links on the entry page (each
  season is its own entry). Episode pages embed the player at
  **voembed.net/embed-<code>.html** (real HLS qualities inside — the rendered
  player shows Auto/1080p/480p).
- animecat.net (Neko-Sama rebirth): dead from the VPS (000) — rejected.

**Implementation:**
- `src/bot/services/voiranimeClient.ts`: search (`/?s=` + Madara card parsing,
  VF flagged by slug), episode list per entry (numbered `-NN-vf|vostfr/` +
  film/OAV), episode-page player-iframe resolution, `resolveVoiranimeSeason()`
  (season markers or trailing number in title/slug; s1 → first VF entry).
- Quick flow: `.a <q> [sN] epN vf rN` tries voiranime FIRST (disable with
  `NEBULA_VOIRANIME_DISABLED=1`); the VF entry's episodes become the session
  list and the player embed is resolved LAZILY per requested episode
  (`fillVoiranimePlayers`); any failure falls back to nakanime. voembed.net
  added to urlSafety trusted lists and ranked priority 2 (after vidmoly) —
  its `embed-<code>.html` shape is handled by the generic packed-player probe.
- `scripts/voiranime-probe.ts "<q>" [s] [ep] [--dl]`: end-to-end VF diagnostic.
- Doctor stage 1 probes voir-anime.to.

Suite: 217/217 (21 files, +9 voiranime tests).

### 8.10 VF by default via voiranime — live-validated (2026-08-31, twelfth push)

VPS validation of §8.9 (`voiranime-probe "sparks of tomorrow" 1 9 --dl`): search
VF ✅, season ✅, episodes ✅, voembed player ✅, HLS variant 852x480 auto-
selected, **92.28 MB in 5.5 s**. The "SEE [KO] ABOVE" banner was a probe-only
cosmetic bug (`process.exitCode` undefined vs 0) — fixed.

Quick mode now applies the user's original requirement: **VF by default**. When
no language is given, voiranime's VF entry is tried first; titles without a VF
entry fall back to nakanime VOSTFR (honest in both directions). Opt-outs:
`.a ... vostfr` per command, `NEBULA_VF_DEFAULT=0` globally,
`NEBULA_VOIRANIME_DISABLED=1` to bypass voiranime entirely. The interactive
(`.a <q>` step-by-step) flow keeps its explicit language menu.

Suite: 217/217 (21 files).

### 8.11 voe/voembed tracks were not parsed — "720P" label on a 480p file (2026-08-31, thirteenth push)

**User catch:** `.a sparks of tomorrow vf s1 ep9 r2` delivered 92.3 MB labelled
*720P*, while the probe had downloaded the SAME episode at **852x480 / 92.28
MB**. Suspicion confirmed: the Voe/voembed branch returned the master HLS
without parsing its variants, so `resolveCanonicalQualityTrack` synthesized a
fallback track labelled "720P" (the generic hls default) while the downloader's
own master resolver silently picked the 480p variant. Honest size, wrong label.

Fix: the voe branch now runs `fetchHlsTracksAndSizes` on the master (referer =
player origin instead of the hardcoded nakanime one), so quick mode sees the
REAL menu (480P/1080P), labels the nearest quality honestly and hands the exact
variant URL to the downloader (no more silent heuristic pick).

Sanity math: 24 min at ~0.5 MB/s ≈ 92 MB = 480p territory; a true 720p of the
same episode would be ~140-190 MB.

Suite: 217/217 (21 files).

### 8.12 Batch OOM-kill — sequential episodes + backpressure consolidation (2026-08-31, fourteenth push)

**User log (12-episode batch, `.a 1-12` after `r1`):** mid-batch the process
died with a bare `Killed` — the kernel OOM-killer terminated Node. The
interleaved `Starting ... 154 segments` / `Successfully ... 78 segments!` lines
were TWO concurrent episode pipelines (batch CONCURRENCY_LIMIT was 2), not a
miscounting log.

Each pipeline holds ~2x the episode size in flight (segment workspace +
consolidated TS + ffmpeg); two 90 MB episodes in parallel + Baileys + panel
exceeded the container RAM. The consolidation loop also wrote every segment
buffer without waiting for `drain`, queuing the whole episode in memory.

Fixes:
- Batch episodes now run **sequentially** by default
  (`NEBULA_BATCH_CONCURRENCY=1`), overridable on hosts with headroom.
- Consolidation respects write backpressure (awaits `drain`), bounding concat
  memory.
- Note: the segment workspace is cleaned in a `finally` per episode, but an
  OOM kill bypasses it — `/tmp/cat_catch_*` should be swept once after a kill.

Suite: 217/217 (21 files).

### 8.13 Fast-lane size guard — "480P" file at 403 MB (2026-08-31, fifteenth push)

**User log (sequential 12-ep batch, no OOM this time):** ep5 delivered 88.8 MB
but **ep6 delivered 403.53 MB labelled VOSTFR_480P** — a ~2.3 Mbps encode
carrying a 480P label on that mirror. Exact-label matching trusted the CDN's
naming; the fast lane (r1) exists to deliver WhatsApp-friendly files.

Fix (`pickOptimalStream` + `resolveCanonicalQualityTrack`, shared guard):
when the exact fast-lane track (480P/360P) has a KNOWN size above
**FAST_LANE_MAX_BYTES (200 MB)**, the lightest ≤480p alternative is used
instead and labelled honestly (`exact:false`, real resolution in quick mode).
Normal exact matches (≤200 MB) are untouched, and non-fast-lane qualities
(720P/1080P) never downgrade. Batch downloads get the same protection via
`downloadWithAllMirrorsFallback` → `pickOptimalStream`.

Note: `free -m` on that host shows 330 GB (host view); the container's real
ceiling is the cgroup limit — check `cat /sys/fs/cgroup/memory.max` (v2) or
`/sys/fs/cgroup/memory/memory.limit_in_bytes` (v1) before raising
`NEBULA_BATCH_CONCURRENCY`.

Suite: 221/221 (21 files, +4 fast-lane guard tests).

### 8.14 Sequential batch OOM again — V8 ignores the cgroup limit (2026-08-31, sixteenth push)

**User evidence:** redeploy of the size guard OK, batch re-run: E09 delivered
(92.28 MB, Voe, clean pipeline), then `Killed` right after the TempDownload
registration. Same code path that survived the previous 12-episode run.

**Root cause (measured, not guessed):** `cat /sys/fs/cgroup/memory.max` →
`999997440` bytes ≈ **954 MB** — the container cap. `free -m` shows the HOST
view (330 GB), and Node sizes its default V8 heap from that host view, so
`--max-old-space-size` defaults to several GB. V8 therefore defers major GC
indefinitely; each episode leaves ~92 MB of transient Buffer garbage that is
*collectable but never collected*, and around episode 9 RSS crosses the cgroup
cap → kernel OOM kill. Nondeterministic GC timing explains why one run survives
and the next dies with identical code. The per-episode pipeline itself is
bounded (segments written to disk as they arrive, drain-aware consolidation,
temp links served via `createReadStream`, batch sends links not uploads) —
verified by re-reading hlsDownloader/tempDownloadManager/app.ts/novabox.

**Fix:**
- `package.json` start: `node --max-old-space-size=384 --expose-gc` — heap
  capped ~170 MB below the cgroup limit (headroom for external buffers,
  ffmpeg children, runtime).
- Batch worker now calls an explicit `gc()` between episodes (no-op without
  `--expose-gc`).
- Regression guard: `tests/startFlags.test.ts` fails if the flags disappear.

Suite: 224/224 (22 files, +3 start-flag tests).

### 8.15 The REAL batch killer — adm-zip builds the whole archive in RAM (2026-08-31, seventeenth push)

**User evidence (decisive):** after the 8.14 redeploy, the SAME `Killed`
reappeared at the SAME spot — right after `Sparks_of_Tomorrow_VF_480P_S01_E09`
registration. And the bot answered `📦 Episodes to Process: 9 episodes` for a
`1-12` request: **the anime only has 9 episodes**, so E09 was the LAST episode
in both runs. The kill was never mid-download — it fires exactly when the last
episode finishes and the flow enters `BatchZipManager.packageEpisodes`.

**Root cause:** `adm-zip` (`addLocalFile` × 9 then `writeZip`) keeps every entry
buffer in RAM **and** materialises the final archive as a second Buffer before
writing: 9 × 92 MB ≈ 830 MB of entries + ~830 MB zip buffer ≈ **1.6 GB peak**
inside the ~954 MB cgroup → deterministic kernel OOM kill. This also
retro-explains 8.12/8.14: GC luck and concurrency only shifted how close to the
zip step the process got; the zip step itself was always fatal once episodes
accumulated enough bytes.

**Fix — streaming STORE-only zip writer (`streamingZipWriter.ts`):**
- Entries are streamed to disk with backpressure (`for await` + drain waits):
  flat memory (a few MB of chunk buffers) regardless of batch size.
- Method STORE (0): MP4 payloads are already compressed, deflate would burn
  minutes for ~0% gain — packaging now runs at disk-copy speed.
- Maximum compatibility layout: CRC32 + sizes in the LOCAL header (pre-pass
  CRC, no data descriptors), UTF-8 name flag, Unix 0644 external attributes,
  classic (non-ZIP64) limits enforced with an early clear error.
- `batchZipManager.packageEpisodes` now stages entries (README manifest +
  episodes) and streams them; same filenames, same `BatchZipResult` contract,
  same cleanup/TTL/registration behaviour.
- adm-zip is still used — in the TEST suite as an independent parser proving
  round-trip byte-exactness, UTF-8 names, empty files, STORE method, CRCs, and
  a 64 MB streamed-file regression guard.

**8.14 verdict kept honest:** the V8-heap-cap + between-episode gc flags remain
as sound hardening for a 954 MB cgroup, but they were NOT the decisive fix —
the deterministic killer was adm-zip's in-memory archive construction.

Suite: 229/229 (23 files, +5 streaming zip tests +1 renamed count).
### 8.16 No more season ZIP by default + startup debris purge (2026-08-31, eighteenth push)

**User evidence:** 9/9 episodes downloaded with zero crashes (streaming zip
writer held: 178 MB archived in 0.6s mid-run) — then
`Error: Temporary download storage quota reached` at zip registration, and the
bot fell back to per-episode temp links. The user preferred that output and
decided: **drop the zipping, deliver one temp link per episode.**

**Why the quota tripped:** the 4 GB `TEMP_MAX_TOTAL_BYTES` store was full of
debris from the three OOM-killed runs — kernel kills bypass `finally` cleanup,
orphans are only swept after 3h (`ORPHAN_MAX_AGE_MS`) and `cat_catch_*` HLS
staging dirs in os.tmpdir() were covered by NO sweep at all. Since the token
registry is in-memory, every file left by a previous process is unreachable
anyway.

**Changes:**
- `novabox.ts`: season ZIP packaging gated behind `NEBULA_BATCH_ZIP=1`
  (default OFF) — batch delivers per-episode high-speed temp links, exactly
  like the user's paste. Intro card text no longer announces "stream
  packaging"; validity label corrected to the real 120-minute TTL
  ("2 Hours", was "3–4 Hours" — label coherence rule).
- `tempDownloadManager.ts`: `purgeStartupOrphans()` runs at boot — clears ALL
  files in `nebula_temp_downloads` (registry empty ⇒ all unreachable) and
  removes `cat_catch_*` / `batch_zip_*` dirs from os.tmpdir(), logging freed
  MB. The 5-min TTL sweep continues to handle live expiry.
- The streaming zip writer (8.15) stays in place for `NEBULA_BATCH_ZIP=1`.

Suite: 230/230 (24 files, +1 startup purge test).
### 8.17 Interactive flow VF by default + honest language hint (2026-08-31, nineteenth push)

**User evidence:** `.a tomb` → `.a 1` (Tomb Raider King) showed the season
screen with `Language: VOSTFR (Default)` AND the incoherent tip "(To switch to
VOSTFR, type `.a vostfr`)" — the tip offered the language already active, and
the user expects VF by default for downloads generally.

**Root cause (structural, twofold):**
1. The interactive season screen decided the language from nakanime alone:
   `checkVfExists()` is structurally false for nakanime URLs (nakanime carries
   language per player, not per page), and voiranime — our honest VF source —
   was never consulted outside the quick pipeline. So every nakanime-sourced
   title (i.e. whenever anime-sama search 403s and the nakanime fallback
   serves results, as in the user's log) landed on VOSTFR-by-default.
2. The hint line offered the switch to the ALREADY-ACTIVE language.

**Fix (`novabox.ts`):**
- `wireVoiranimeVfSeasons(session, title)`: probes voiranime at the season
  screen; if VF entries exist the session is wired to them (seasons flagged
  `isVoiranime`, `selectedLanguage = "VF"`, languages `[VF, VOSTFR]`), while
  `session.animeUrl` keeps pointing at the nakanime page so `.a vostfr` can
  rebuild the VOSTFR season list. Mirrors the quick pipeline (8.10); same env
  opt-outs (`NEBULA_VF_DEFAULT=0`, `NEBULA_VOIRANIME_DISABLED=1`).
- Season screen: voiranime probe FIRST, nakanime logic only as fallback.
- `.a sN` step: voiranime seasons load their positional episode list
  (`voiranimeEpisodes`) instead of nakanime `episodes.js`; players resolved
  lazily via `fillVoiranimePlayers` (episode selection and season-dl
  inspection), exactly like the quick pipeline.
- Language switch handler: `.a vostfr` on a voiranime-wired session rebuilds
  the nakanime season list (the old URL-rewrite path is nakanime-only and
  would have corrupted voiranime URLs); `.a vf` when VF is not registered
  probes voiranime as a last chance before answering "unavailable".
- `seasonScreenLanguageHint(defaultLang, vfAvailable)`: VF default → offers
  `.a vostfr`; VOSTFR default + VF exists → offers `.a vf`; VOSTFR default +
  no VF anywhere → honestly says "VF non disponible pour cet anime".

Suite: 237/237 (24 files, +7 interactive VF default tests with a mocked
voiranime client).

### 8.18 VPS management script — `manage.sh` (2026-08-31, twentieth push)

**User request:** one script to rule the VPS deployment — start/restart/stop,
clone, update, fill the .env, and the rest.

**Delivered (`manage.sh`, repo root, executable, French UI):**
- `start` (nohup + waits up to 45 s for the panel to answer, prints log tail
  on failure), `stop` (SIGTERM → SIGKILL), `restart`, `status` (branch/rev,
  dirty tree, PID/RSS vs cgroup cap, local panel + public APP_URL probe,
  temp-store usage, staging debris count, disk), `logs [filter]`
  (tail -f + optional grep), `version`.
- `update`: `git config pull.ff only` (kills the divergence hint) +
  `git pull --ff-only` + commit log, npm install ONLY when package*.json
  changed in the range, `npm run build`, restart only if it was running.
- `setup` (npm install + .env from example + build) and `clone [dir]`
  (clone BRANCH → setup) for a fresh VPS.
- `env`: interactive menu over the full key catalog (APP_URL, PANEL_TOKEN,
  GEMINI_API_KEY, OWNER_NUMBER, all NEBULA_* flags) with per-key French
  descriptions and masked secret values; plus `env list|set|get|unset|edit`.
  Refuses to write NODE_ENV into .env (npm start sets it = production).
- `clean`: purges cat_catch_*/batch_zip_* staging older than 60 min and
  expired (3h+) temp-download files — mirrors the app's own sweep ages so a
  download in flight is never touched.
- `doctor`: node/npm/ffmpeg/git checks, branch + origin, .env keys, cgroup
  RAM ceiling with the "tight" note, disk, build presence, process, panel +
  public URL probes, debris count; exit 1 when blocking issues remain.

Env key catalog built from the actual `process.env.*` reads in app/server/src
(26 keys) — not hand-invented. Tested in the sandbox: syntax, help, env
set/get/unset/list round-trip (incl. masking), status/doctor/clean graceful
without a running bot; fixed a false-positive HTTP check found during test.

### 8.19 Jikan (MyAnimeList) integration — `.anime` cards + `.a` poster (2026-08-31, twenty-first push)

**Context:** user picked option 1 from the public-apis survey — MAL info cards
via Jikan (no API key) to make the anime flow visual and pro.

**Delivered:**
- `services/jikanClient.ts`: `/v4/anime?q=…&sfw=true` search with 8 s timeout,
  10-minute response cache (Jikan is rate-limited ~3 req/s), best-effort
  contract (HTTP/network/malformed failures resolve to `[]`). Pure exported
  helpers: `normalizeTitle` (lowercase, accents/punctuation stripped, VF/
  VOSTFR/season-noise tokens dropped), `pickBestMatch` (exact normalized
  > substring > MAL relevance fallback), `formatAnimeCard` (French card, full
  + compact variants, word-boundary synopsis trimming).
- `commands/anime.ts`: `.anime <titre>` — poster image + card (score, votes,
  episodes, type, year, status, genres, synopsis, MAL link); graceful
  not-found message.
- Novabox season screen: fire-and-forget poster message (compact card) sent
  alongside "Select Season" when a MAL match is found — never blocks or breaks
  the flow; `NEBULA_JIKAN_DISABLED=1` opts out.
- README badges/test counts updated (250/250).

Suite: 250/250 (25 files, +13 Jikan tests: normalization, matching, card
formatting, cache single-network-hit, error paths).

### 8.20 One-line installer — `scripts/install.sh` (2026-08-31, twenty-second push)

**User request:** a free-claude-code-style install one-liner so a fresh VPS
gets Nebula + the `nebula` command with zero manual steps.

**Delivered (`scripts/install.sh`, POSIX sh, idempotent):**
`curl -fsSL ".../arena/01a05555-p/scripts/install.sh" | sh`
- Steps: Linux/arch checks → git (apt install if missing) → Node ≥ 18 (NodeSource
  22.x when absent/too old, apt path only) → ffmpeg (best-effort, warns) →
  clone the branch or `git pull --ff-only` when re-run → symlink
  `nebula → manage.sh` into /usr/local/bin (root) or ~/.local/bin (user,
  PATH line appended to the profile when needed) → `manage.sh setup`
  (npm install + build; `NEBULA_SKIP_BUILD=1` test hook) → .env from the
  example + optional interactive `nebula env` wizard.
- Interactive prompts read from /dev/tty only when a TTY exists (the
  free-claude-code pattern): `curl | sh` works non-interactively, and still
  offers the wizard when run from a real terminal. `--dir`, `--skip-build`,
  `--help` flags; non-root installs land in `~/nebula`.
- Sandbox-tested end-to-end (clone + symlink + .env creation); fixed a
  backtick-in-double-quotes bug the test caught (step title executed `nebula`
  as command substitution).
- README quick start and the French migration guide now lead with the
  one-liner.

### 8.21 Installer verification round — symlink bug + ffmpeg-static hardening (2026-08-31, twenty-third push)

**User instinct was right:** "vérifie encore ton travail avant Trace Moe" — the
full re-test (this time THROUGH the installer-created `nebula` symlink, with
build) caught two real issues that `--help`-only tests had missed.

**Bug 1 (critical): symlinked `nebula` was broken for every real command.**
`manage.sh` derived `APP_DIR` from `dirname(BASH_SOURCE)` without resolving
symlinks, so as `/usr/local/bin/nebula` it pointed at `/usr/local/bin` and
`status`/`update`/`doctor`/`env` all died with "must live in the git repo".
Fixed: APP_DIR now resolves through the symlink chain (POSIX loop).

**Bug 2 (reliability): `npm install` hard-fails when ffmpeg-static's
postinstall cannot reach GitHub** (e.g. TLS-intercepting networks; observed in
the sandbox: `UNABLE_TO_VERIFY_LEAF_SIGNATURE` on github.com while
registry.npmjs.org is fine). Fix: `install.sh` and `manage.sh setup` now export
`FFMPEG_BIN=$(command -v ffmpeg)` when a system ffmpeg exists — ffmpeg-static's
installer then sees the binary as present and skips its ~70 MB GitHub download
entirely, and the app ALREADY prefers system ffmpeg at runtime
(`execSync("ffmpeg -version")` probe in hlsDownloader). Faster installs, no
GitHub dependency. Also: installer now fails with clear messages instead of
doomed root-only attempts (git/Node) when run non-root.

**End-to-end evidence (fresh clone from GitHub in the sandbox):** 6/6 steps
green, `dist/server.cjs` built, `.env` created by setup, `nebula` symlink
works for `version`/`status` (repo resolved correctly), ffmpeg-static binary
NOT downloaded (FFMPEG_BIN honored), re-run is idempotent (pull --ff-only,
".env conservé").

### 8.22 `.trace` — anime identification from a screenshot (trace.moe) (2026-08-31, twenty-fourth push)

**User request:** option 2 of the public-apis survey — "un alias et un exécuteur
simple": send/quote a screenshot, get the anime + episode + timecode.

**Delivered:**
- `services/tracemoeClient.ts`: POST `api.trace.moe/search?anilistInfo=1`
  with the raw image bytes (10 MB ceiling, `X-Trace-TTL: 3600`, 15 s timeout)
  or the GET url= variant (trace.moe fetches it, we only validate ^https?://).
  Best-effort contract: network/HTTP/429 failures resolve to a friendly French
  error, never a crash. Pure helpers: `formatTimestamp` (95.3 → "1:35",
  3675 → "1:01:15", invalid → "--:--"), `formatEpisode` (Ép. 7 / Ép. 3-5 /
  Film), `pickBestTrace` (highest similarity), `formatTraceCard` (title EN/romaji
  + native alt, episode, timecode, similarity %, adult flag, `.a <title>`
  download hint, AniList link).
- `commands/trace.ts` with aliases `tracemoe` and `whatanime` (native registry
  alias support). Three input paths: image attached with `.trace` caption,
  `.trace` as a reply to an image (both via `context.downloadMedia()`), or
  `.trace <image url>`. Replies with the card + the matched scene thumbnail
  (trace.moe hosts it); "aucun anime identifié" tips when similarity search
  misses.
- No API key, one request per user action (anonymous rate limit friendly).

Suite: 263/263 (26 files, +13 trace.moe tests).

### 8.23 Full-audit remediation (S1–S4) + `.a watch` episode watcher (2026-09-01, twenty-fifth push)

**Context:** expert-mode audit (Phase 1 report delivered, user approved
execution "fais de ton mieux"). All five Critical findings of the 2026-08-29
audit had already been verified fixed; this batch addressed H1-H3, M3, M6, M7
and delivered the proposed feature.

**S1/H2 — npm audit 5×high (minimatch ReDoS):** real chain is
`yt-search → node-fzf → redstar → minimatch@3.0.8`; redstar only calls basic
`minimatch(file, pattern)` (API-stable across majors) → targeted override
`redstar.minimatch ^10.2.6`. Result: **0 production vulnerabilities**, yt-search
still loads. **H1:** `@whiskeysockets/baileys` pinned to exactly `7.0.0-rc14`
(no surprise RC bumps). **M3:** adm-zip moved to devDependencies (tests-only
since 8.15).

**S2/H3 — R9:** `downloadHlsAppLevel` now enforces a hard global deadline
(`NEBULA_DOWNLOAD_TIMEOUT_MS`, default 10 min/episode) checked in the segment
retry loop — a stalling CDN can no longer hang a batch slot for hours
(per-segment fetches already cap at 15 s; the accumulation was the hole).
**R2:** `server.ts` verifies ffmpeg (PATH, then ffmpeg-static) at boot and
fails LOUDLY without blocking the panel; logged via addLog for the panel.

**S3/M6/M7:** MIT LICENSE + badge; README command counts now honest
(150+ registered — matches `/api/health`) instead of the vendored-corpus
double count "241+".

**S4 — `.a watch` (new feature):** `services/episodeWatchService.ts` —
subscriptions persisted to `database/watch_subscriptions.json` (atomic write,
per-chat cap 20, global 200, dedupe refresh). Cron via `node-cron`
(`NEBULA_WATCH_CRON`, default every 6 h) started from botEngine on connection
open (sender rebound per socket). Quiet hours 23h–7h `Africa/Douala`
(`NEBULA_WATCH_QUIET`/`_TZ`) SKIP without consuming — notifications are
deferred, never lost. Network failures increment `consecutiveErrors` and never
delete user data. Cycle fully dependency-injected (fetch/send/clock/state).
Interactive hook at the episode step: `.a watch` (VF voiranime seasons only,
honest error otherwise), `.a unwatch <titre>`, `.a watchlist`; episode screen
lists the option. New env keys documented in manage.sh + README.

Suite: 277/277 (28 files, +14 watcher tests: deltas, midnight-crossing quiet
hours, notification format, caps, persistence round-trip, injected cycle —
notify/silent/error/quiet-skip).

### 8.24 Debug toolbox — Certificate Transparency lookup (crt.name) (2026-09-01, twenty-sixth push)

**Context:** user found `https://crt.name/v1/search?apex=<domain>` and asked
whether the bot could use it. Verified live: it queries the public Certificate
Transparency logs and lists the subdomains a domain has TLS certificates for.

**Validation (evidence):** `apex=vmget.online` (the Voe CDN) returns
`prx-1316-ant`, `prx-1351-ant-20`, `prx-1357-ant-v` — exactly the hosts seen in
the production download logs, confirming it exposes the CDN's front inventory.

**Decision — documented as a MANUAL debug reflex, NOT integrated in the bot:**
the extractors already receive exact per-episode URLs from player playlists
and multi-mirror fallback handles host rotation, so a CT lookup in the
pipeline would add network surface for zero measurable gain (audit principle:
every addition must serve a real need). The reflex is useful the day a mirror
pattern breaks:

```bash
# Has the CDN rotated/deployed new front hosts (prx-*, gate-*)?
curl -s "https://crt.name/v1/search?apex=vmget.online"     # Voe CDN
curl -s "https://crt.name/v1/search?apex=vmnow.online"     # Voe alt
# same idea for any mirror CDN domain found in [MIRROR_FALLBACK] logs
```

If one day a mirror's hosts stop resolving, compare this list against the
hosts in the bot logs before suspecting our extractor.

### 8.25 Panel redesign integration from `oo-oo` snapshot (2026-09-01, twenty-seventh push)

**User action:** published a "new version" at JCVERSA/oo-oo (fresh 2-commit
history, no inherited git history) and asked to check + merge it into this repo.

**Verification performed before merging:** full tree diff (oo-oo vs our tip
`ed747fc`) — oo-oo contained ALL our latest files (no missing features) plus
exactly 20 paths: 7 new UI components (HeroChip, HeroKbd, HeroSnippet,
HeroUser, ShinyText, SpotlightCard, SystemDiagnostics), 9 reworked UI files
(App.tsx, Sidebar, Topbar, MobileDock/Drawer, Switch, BatchDownloadStatus,
index.css) and 4 tooling files (.env.example, eslint ignores, .prettierignore,
batchZipManager lint comment). Secrets scan on new components: clean.
No test depends on the changed backend path.

**Behaviour change adopted (deliberate, from oo-oo):** the vendored 145-file
legacy command corpus is now QUARANTINED by default — `loadImportedCommands()`
returns [] unless `NEBULA_ENABLE_LEGACY=true` (.env.example documents it,
README + manage.sh env catalog updated; honest command count now 33 native +
opt-in corpus). Rationale: the legacy CJS files predate the ACL bridge and
carry recurring import-time network side effects.

**Sandbox incident handled:** between turns the local repo had been reset to
the session base commit `31fe212` (41 of our pushed files showed as
untracked). Fixed per the documented procedure: `git fetch origin
arena/01a05555-p` (remote tip `ed747fc` intact) + `git reset --mixed` — after
which status showed exactly the 20 oo-oo files pending. Working tree was
never at risk.

**Validation:** npm install (FFMPEG_BIN bypass for the sandbox's
TLS-intercepted GitHub), `tsc --noEmit` OK, vitest 277/277 (28 files),
`npm run build` OK (server bundle 534.6 kB; same known harmless
import.meta/esbuild warning).

### 8.26 Native platform download commands — quarantine-proof `.tiktok/.instagram/.facebook/.youtube` (2026-09-01, twenty-eighth push)

**User request:** with the legacy corpus quarantined (8.25), make TikTok,
Instagram, YouTube and Facebook downloads part of the always-on native set.

**Approach — reuse, not duplication:** the hardened native `.download`
pipeline already handles all four platforms (Cobalt waterfall + fallbacks,
SSRF guard per redirect hop, 60 MB buffer / 500 MB stream caps, temp links
for >100 MB). The new commands are thin wrappers: `socialPlatforms.ts`
(platform catalog + `matchSocialPlatform` hostname validation + usage cards in
French) and four command files that validate the link and delegate with the
same arg grammar (`.yt audio <url>`, quality passthrough). Zero new
dependencies, zero legacy CJS loaded.

**Test-caught fix:** the first implementation matched platforms by substring
(`url.includes("tiktok.com")`), accepting `https://example.com/tiktok.com`.
Rewritten to real hostname matching (`new URL().hostname`, exact/suffix/www).
Bonus: registry verified conflict-free; commands registered natively with
aliases (tt/ttdl, ig/igdl, fb/fbdl, yt/ytdl).

Suite: 285/285 (29 files, +8 tests: hostname matching incl. shorteners and
rejection cases, usage rendering, native registration of all four).

### 8.27 Second audit remediation (T1–T3) + CI (2026-09-01, twenty-ninth push)

**Context:** second expert audit of the session approved for execution
("approved"). Evidence-first findings, incremental fixes only.

**T1a — R11 honest panel retry (`batchDownloadManager.ts`):** the panel retry
buttons flipped episode/job statuses with NO worker behind them — for REAL
WhatsApp-driven jobs that faked "downloading / 25%" forever. Jobs now carry a
`simulated` flag (set by the simulator flow); `retryBatchJob`/`retryEpisode`
REFUSE real jobs with a clear French pointer back to the WhatsApp command and
keep working for simulator jobs.

**T1b — B1 lossless backup (`app.ts` + stores):** the export emitted only
config+aiUsage while the restore could apply six sections — panel backups were
near-useless. Export now emits groups, warnings, stats, accessPolicies,
panelCommands (full sources) and watchSubscriptions; restore applies the new
watch section through `sanitizeWatchSubscriptions()` (bounded to the global
cap, URL/jid/title validated, consecutiveErrors reset — never trusts the
payload). Added `database.getAllGroups()/getAllWarnings()` and
`panelCommands.exportAllPanelCommands()`.

**T2 — preview.gif 10.4 MB → 4.5 MB (-57%):** 160f@60ms full-colour → 80f@120ms
(12 fps) with a shared 96-colour palette, native 480×270 (resampling was
REJECTED: LANCZOS noise grew the file to 7 MB). Integrity verified
programmatically (Pillow decodes all 80 frames; per-frame luminance drift
0.1/255 vs original — no vision available in-session, stated per checklist).

**T3 — CI (`.github/workflows/ci.yml`):** push (arena branch + main) and PR →
Node 22 + npm cache → `npm ci` → `tsc --noEmit` → `vitest run`. 10-min timeout.
Note: the session's GitHub App token lacks the `workflows` permission, so the
workflow file is committed by the owner via the GitHub web UI (same content,
staged in this repo as `.github/workflows/ci.yml` in the working tree).

**T4 (proxy for jikan/tracemoe) — deliberately skipped:** wiring an egress
proxy into `fetch` requires undici dispatcher semantics for no measured need
today (both APIs are CDN-fronted and best-effort by contract). Revisit if the
bot ever runs behind a filtering proxy full-time.

Suite: 291/291 (30 files, +6 tests: retry honesty real/simulated/unknown,
watch sanitizer filtering/caps/non-array).

### 8.28 `.rnyt` — legacy coins top-up (2026-09-01, thirtieth push)

**Request:** the vendored (legacy) `.ytvideo`/`.song` commands charge coins
(150/50) with no way to earn them; user asked for `.rnyt` = +3000 coins per use.

**Evidence first:** the ledger lives in `src/bot/imported/utils/economy.js` —
an in-memory singleton persisted to `economy_db.json`, keyed by sender JID.
Crediting it from a native command only works if BOTH share the module
singleton (Node require cache) — a separate instance would diverge from the
in-memory copy and be overwritten on the next legacy mutation.

**Fix:** native `src/bot/commands/renewYouTube.ts` (`.rnyt`, aliases
`renewyoutube`/`renewyt`/`coins`, category Economy) that requires the economy
module by the SAME absolute path the bridge resolves (`process.cwd()` +
`src/bot/imported/utils/economy.js`) and calls `addCoins(context.sender,
3000)` — same key the legacy commands debit (`extra.sender` = bridge's
`context.sender`). When legacy is quarantined it refuses politely and points
to the FREE native pipeline (`.youtube` / `.download … audio`) instead of
crediting a useless ledger. Tests (5): singleton identity with the legacy
resolution path, credit visible in-memory + on disk, repeatable credit,
quarantine refusal without file mutation, registration metadata. The test
suite snapshots/restores `economy_db.json` and purges the require cache
between tests.

**Deliberate:** unlimited repeats (explicit user request: "à chaque fois"),
no cooldown — it is the owner's private economy; the native pipeline stays
free of any coin mechanic.

### 8.29 Slow `nebula update` (20-30 min) — root causes & fixes (2026-09-01, thirty-first push)

**Complaint:** updates work but take 20-30 min, seemingly stuck at
"Dépendances" / "Build".

**Measurements & evidence:**
- `npm run build` = **10 s** on a 2-core/4 GB idle sandbox — the build itself
  is NOT the bottleneck.
- `ffmpeg-static@5.3.0`'s install.js only skips its download when the binary
  file already exists — the `FFMPEG_BIN` export in our own manage.sh/setup
  did NOT prevent the ~70 MB GitHub-releases download. That message was a
  placebo (my earlier claim was wrong; corrected here). Every fresh install
  and every npm install after a package re-extract hit GitHub — on slow
  GitHub routes that alone is 10-25 min.
- The bot stayed RUNNING during npm install + vite build inside the ~953 MB
  cgroup (bot ≈ 500-600 MB RSS + npm ≈ 300-500 MB) → memory throttling makes
  every step crawl; vite also wipes dist/ mid-build.
- package.json hadn't changed since 627a1ff, so recent updates skipped npm —
  the historical 20-30 min pain concentrated in updates that crossed
  dependency changes.

**Fixes:**
1. **Removed the ffmpeg-static dependency entirely.** The system binary
   (apt-installed by scripts/install.sh, checked by `nebula doctor`) was
   always preferred by every call site anyway. New shared resolver
   `src/bot/ffmpeg.ts` (order: FFMPEG_BIN env → system PATH → best-effort
   ffmpeg-static for dev boxes → plain "ffmpeg"); the four duplicated
   resolution dances (video, novabox, animeStreamExtractor, hlsDownloader)
   now import it. Panel dependency list + anime-doctor updated; the
   FFMPEG_BIN placebo blocks in manage.sh/install.sh replaced with honest
   comments and a setup-time ffmpeg guard.
2. **`cmd_update` stops the bot during install+build** (~1 min downtime)
   with automatic restart, and best-effort recovery of the previous build
   when a step fails (vite wipes dist/, so recovery only when
   dist/server.cjs exists).
3. `npm install --prefer-offline` in update+setup (registry metadata served
   from the local cache when possible).

**Verification:** tsc OK, suite 299/299 (32 files, +3 resolver tests),
build OK, `bash -n` on both shell scripts, and an end-to-end
`./manage.sh update` executed in the dev sandbox through the real new code
path (pull → npm install removing ffmpeg-static without any GitHub access →
build). Expected effect on the VPS: dependency-touching updates drop from
20-30 min to ~1-2 min with a ~1 min bot downtime.

**Post-scriptum (same day):** the E2E run also refreshed package-lock.json
(ffmpeg-static entries removed) — committed separately right after; `npm ci`
(CI) requires the lockfile in sync with package.json. The transient
`was_running` false positive during the sandbox E2E came from the
validation command itself containing the literal NODE_PATTERN string, not
from manage.sh.

### 8.30 Update lock (watchdog-safe updates) + env menu defaults (2026-09-01, thirty-second push)

**Problem:** docs/MIGRATION_NOUVEAU_VPS.md installs a watchdog cron
`*/5 * * * * manage.sh start`. With 8.29's stop-during-install sequence, that
cron would restart the bot mid-update — reintroducing exactly the memory
contention the fix removes.

**Fix (manage.sh):** lock directory `/tmp/nebula-update.lock` (atomic mkdir).
`cmd_update` acquires it (trap-release on exit, holder PID recorded) and sets
an internal `UPDATE_IN_PROGRESS` flag; `cmd_start` refuses to launch while a
FRESH lock exists (exit 0 so the cron stays quiet), while the update's own
recovery/restart paths bypass the guard. Locks older than 15 min are treated
as debris (crashed update) and auto-cleaned. A second concurrent `update` is
refused with the holder's PID.

**Also:** the `nebula env` menu now displays the documented default from
.envexample (`(défaut: 3000)`) for unset keys instead of a bare
"(non défini)" — pairs with the pre-filled .env.example (8513387).

**Verification (functional, in-sandbox):** fresh lock → start defers (exit 0,
lock intact, no process); stale 20-min lock → cleaned then start proceeds;
update-under-lock → refused with holder PID; menu renders
`(défaut: 3000)` / `(défaut: 23-7)`. `bash -n` clean. Doc updated
(MIGRATION_NOUVEAU_VPS.md explains the lock in the watchdog section).

### 8.31 `.w` — dedicated episode-watch command (2026-09-01, thirty-third push)

**User report:** `.a watch` searched for an anime named "watch". Root cause
verified in source: the watch action is only intercepted when
`session.step === "episode"` inside an interactive `.a` flow — with no active
session the word "watch" fell through to the plain search path.

**Fix:** new dedicated command `src/bot/commands/watch.ts` (`.w`, aliases
`watch`/`veille`/`watchlist`, category Anime):
- `.w <titre>` → voiranime search, VF entries only (honest error otherwise)
  → numbered pick list (≤8, 10-min TTL) → `.w <n>` subscribes immediately;
  a single VF result subscribes directly.
- Subscription counts the currently available episodes first
  (`lastSeenEp` = max episode number) so the first cycle announces only
  genuinely NEW episodes instead of replaying the backlog; if the episode
  list cannot be read the command aborts with a retry hint.
- `.w` / `.w list` → this chat's watches; `.w rm <titre>` stops one. Multiple
  anime per chat supported (existing caps: 20/chat, 200 global).
- Bonus over the old hook: when voiranime lists several VF seasons the user
  picks WHICH one to watch (the `.a` hook silently watched season 1 only).
- `.a watch|unwatch|watchlist` without an active session now replies with a
  redirect to `.w` instead of searching "watch" (in-flow handler unchanged).

Suite: 307/307 (33 files, +8 tests: empty list, numbered pick + VF filter,
selection subscribes the chosen entry with the right lastSeenEp, multiple
watches, direct single-result subscribe, VF-only error, stale-pick hint,
remove).

### 8.32 Third expert-audit remediation — P1+P2 (2026-09-01, thirty-fourth push)

**Context:** Phase-1 re-audit of `e6005a7` delivered; user approved all three
plans but explicitly deferred the merge to `main`.

**Retraction (evidence-first discipline):** the audit's M-new claim
("warningsCache unbounded") was a FALSE POSITIVE — `WARNINGS_CACHE_MAX = 2000`
with FIFO eviction already exists (database.ts:44/:167), verified in source
before "fixing". Only a defense-in-depth bound was added: `replaceAllWarnings`
now slices its input to the same cap internally (the route guard remains).

**P1 — memory hygiene:**
- `.w` `pendingPicks`: eager TTL sweep at every execution + hard cap of 200
  entries (oldest evicted) — the lazy per-key expiry left the map unbounded in
  theory. Tests: TTL expiry under fake timers; oldest-chat eviction beyond the
  cap with the newest still selectable.
- warnings bounds tests: 2010 addWarning → ≤2000 with newest kept;
  replaceAllWarnings(2500) → 2000.

**P2 — developer experience:**
- `scripts/**` admitted to the eslint gate (removed from ignores): 0 errors,
  23 warnings — consistent with the documented admission-period philosophy;
  prettier already clean on those files.
- README counts refreshed (311/34).
- New permanent §9 backlog below — decisions now live in this file, never
  only in chat (process fix following the S5 definition loss).

### 9. Backlog permanent (living section — update instead of losing decisions)

1. **Merge PR #1 (arena → main)** — still deferred by the owner. NOTE
   (8.33): the installer now targets the public repo `JCVERSA/nebula-p`
   (branch `main`) regardless; the owner pushes releases there manually and
   will then privatize `p`. Post-merge of PR #1 remains: CI green on main,
   tag `v2.9.x`.
2. **trace.moe live verification** — sandbox egress blocks it; verify on the
   VPS with `.trace` + a real screenshot when convenient.
3. **Status quo decisions (documented, do not re-litigate without need):**
   M1 app.ts monolith (1 722 lines), M2 three HTTP stacks, M5 in-memory
   registries (batch jobs, panel sessions, economy RAM-first by design).
4. **Parked ideas:** `.solde` balance command / crediting others via `.rnyt`,
   VOSTFR watch support (voiranime VF only for now), batch-registry
   persistence on restart (S5 — declined by default, jobs are short).
5. **Watchdog/update interplay** — documented §8.30; lock tested.
6. **Evaluated external tools (2026-09-01, owner-suggested):** `rtk-ai/rtk`
   (terminal-output compressor for coding agents) — NOT applicable: the
   bot's AI never runs shell commands; input compression already covered by
   the memory/turn caps. `Graphify-Labs/graphify` (codebase knowledge-graph,
   tree-sitter, local-first) — NOT for the bot (analyzes code, not
   conversations); CANDIDATE dev tool for the next major audit of this repo
   (god nodes would quantify M1's coupling; cross-file links speed up
   call-site mapping). Neither added as a dependency.

**Suite:** 311/311 (34 files). tsc OK. eslint (now incl. scripts/) 0 errors.

### 8.33 Distribution switch — public repo `nebula-p` (2026-09-01, thirty-fifth push)

**Owner decision:** `JCVERSA/p` will eventually go private; the public
distribution channel becomes `JCVERSA/nebula-p` (created empty). The vitrine
repo `Nebula-bot-2.9` will be deleted by the owner (superseded). The owner
will push the release to nebula-p and privatize p himself; PR #1 stays OPEN
(no merge, explicit instruction).

**Changes (repo pointers):** `REPO_URL`/`BRANCH` in scripts/install.sh and
manage.sh → `https://github.com/JCVERSA/nebula-p` / `main`; README one-liner
and manual-clone; MIGRATION + GUIDE VPS docs (clone/curl/pull refs).

**Privacy genericization before public distribution (standing rule):** real
panel domain (20 refs) in CLOUDFLARE_TUNNEL_DEPLOYMENT.md → `exemple.com`;
`237`-prefixed example numbers in .env.example/manage.sh/auditTrail comment →
neutral; test fixtures use neutral fake JIDs (1000000000x); `Africa/Douala`
KEPT as the functional watch-timezone default (product behavior, not personal
data). ANIME_DOWNLOAD_AUDIT.md retains internal history/domains — the owner
may exclude it (and docs/MIGRATION) when pushing the public repo; exclusion
command provided in the release notes.

**Coherence note:** nebula-p's `main` will be this branch's history —
`git pull --ff-only origin main` from an existing VPS checkout keeps
fast-forwarding (same history), so existing installs only need
`git remote set-url origin …/nebula-p.git`.

**Suite:** 311/311 (34 files), tsc/eslint/build green (numbers unchanged —
fixtures edited in place).

**Post-8.33 verification round (owner-requested pre-push audit):** the first
genericization pass had MISSED 37 real-domain references across
GUIDE_DEPLOIEMENT_VPS.md (16) and MIGRATION_NOUVEAU_VPS.md (21) — now
genericized to `exemple.com`; `logs.txt` (tracked debug artifact: franime
Cloudflare-challenge dumps + an old container hostname) removed from the
tree; full-tree re-scan clean. HISTORY caveat: git history still contains
pre-genericization versions (domain, 237-prefixed JIDs) and the profile-README
commit — pushing this branch's full history to a public repo would expose
them. Recommended for the public repo: orphan (fresh single-commit) history
via `git checkout --orphan main`; existing VPS checkouts then re-align with
`git fetch && git reset --hard origin/main` (runtime state is untracked:
.env, database/, nebula_auth_info/ are gitignored — verified).

### 8.34 Installer audit & optimization (2026-09-01, thirty-sixth push)

**Scope:** `scripts/install.sh` (243 lines, POSIX sh — verified with dash).

**Findings (evidence-based):**
- **H1 real defect:** the "already installed" path pulled `origin main` from
  whatever remote the checkout had — a VPS cloned from the OLD repo
  (`JCVERSA/p`, branch arena) would silently stay on old code/remote while
  the installer claims success. Exactly the live migration scenario.
- M1: Node gate incoherence (installed 22, accepted ≥18; docs/CI say 22).
- M2: `apt install ffmpeg` without `apt update` when git pre-existed.
- M3: no disk pre-check; M4: full clone (repo carries a 4.5 MB gif).
- L1: mojibake on fresh C-locale VPS (seen live on the owner's install);
  L2: ".env créé" message even on cp failure; L3: cryptic `--dir` error;
  L4: apt failures hidden by -qq.
- Non-issues re-verified (no change): PATH profile printf emits literal
  $PATH (single-quoted); TTY gating; symlink handling.

**Changes:** auto-migration block (set-url + fetch + clean-tree switch to
main; dirty tree → explicit warn, never resets); `apt_install` helper (lazy
one-time update + verbose retry); unified Node ≥ 22 gate (one deliberate
behavior change: pre-existing 18–21 now fails, matching README/CI);
`LC_ALL=C.UTF-8` best-effort export; disk pre-check (fail <1 GB, warn <2 GB);
shallow clone `--depth 1 --single-branch` (nebula update pulls fine);
accurate .env message; `--dir` arg validation; banner shows installed
commit. POSIX compliance kept (dash + bash -n clean).

**Verification (in-sandbox E2E):** fresh install in /tmp (20 s, clone→
npm→build→banner, non-root + degraded-ffmpeg paths exercised); idempotent
re-run (pull --ff-only); forced old-remote migration (p.git → nebula-p,
branch renamed → auto-switched to main, tree clean); profile PATH line
emits literal $PATH. Not exercised: root+apt happy path (sandbox egress
blocks apt) — logic reviewed, failure paths warn-and-continue.

### 8.35 NVIDIA NIM AI fallback (2026-09-01, thirty-seventh push)

**Owner decisions (asked explicitly):** NVIDIA as automatic FALLBACK (Gemini
stays primary), owner already holds a key, default model
`meta/llama-3.3-70b-instruct`, text-only scope — images stay Gemini-only.

**Evidence:** NIM is a plain OpenAI-compatible chat-completions API on
`https://integrate.api.nvidia.com/v1` (verified against the referenced
free-claude-code provider implementation); free keys at
build.nvidia.com/settings/api-keys. No new dependency: axios, already in the
stack.

**Implementation:** new `src/bot/nimClient.ts` (`isNimConfigured`,
`getNimModel`, `nimChat` with 2-attempt retry on 429/5xx, truthful
HTTP-status errors, DI'd post for tests). `geminiClient.generateTextWithFallback`
now falls back to NIM when the Gemini key is absent OR every Gemini model
failed (combined truthful error when both engines fail); multimodal prompts
are collapsed to text (image parts dropped — fallback is text-only, honest
error when prompt is textless). New central `isAIConfigured()` replaces raw
GEMINI_API_KEY reads at every gate (.ai command, DM assistant, panel
diagnostics, dynamic-command generation). `NVIDIA_NIM_API_KEY` joined the
panel Secrets allowlist (masked); env surfaces: manage.sh env menu,
.env.example (optional), README.

Quotas unchanged: NIM calls happen INSIDE the existing per-user daily budget
and concurrency cap (fallback inherits them by construction).

**Suite:** 322/322 (35 files, +11: config detection/placeholders/model
override/secret allowlist; body shape + bearer; 429 retry; truthful errors;
empty completion; missing key; integration routes-to-NIM, isAIConfigured,
textless-prompt guard).

### 8.36 Panel secret field for the NVIDIA key (2026-09-01, thirty-eighth push)

**Owner wish:** enter the NVIDIA API key directly in the control panel. The
BACKEND already accepted it (8.35 allowlist), but the panel UI was
hardcoded to GEMINI_API_KEY only (fetchSecretStatus picked Gemini/Owner;
saveSecret always posted GEMINI) — verified in App.tsx before changing.

**Fix:** following the file's existing per-secret convention — new
nimSecret* state, NVIDIA pick in fetchSecretStatus, saveNimSecret /
clearNimSecret (applied to the running bot + persisted to .env, masked
status badge, honest messages), and a dedicated input block in BOTH secret
surfaces (Settings page and the API Secrets card: password input, Enter to
save, Save button, trash-to-remove when configured).

**Also:** the OWNER_NUMBER placeholder in the panel was a 237-prefixed
example — genericized (privacy pass had missed the .tsx).

**Verification:** tsc OK, eslint 0 errors on App.tsx, suite 322/322,
production build (vite + esbuild) OK.

### 8.37 AI persona — Nebula gets a defined voice (2026-09-01, thirty-ninth push)

**Owner decisions (asked explicitly):** SOBER & PROFESSIONAL character,
MIRROR the user's language (French default), chat surfaces only (.ai +
private conversations; internal generations keep their technical prompts),
tuning via env override (my recommendation, accepted).

**Inspiration, not copying:** structure borrowed from production assistant
prompts (identity / voice / language / formatting / good-bad examples /
boundaries) — the leaked Fable-5 document was read for DESIGN ideas; the
text itself is original and WhatsApp-specific.

**New `src/bot/persona.ts`:** compact (~2 KB) bilingual-compliant persona —
direct natural prose, no flattery, never invents facts, adult-to-adult tone;
language mirroring with French default and "tu" register; WhatsApp delivery
rules (≤ ~120 words by default, *single-asterisk* bold, no markdown headers/
tables/**, emoji only when clarifying); honesty boundaries (never claims to
be human, brief non-moralizing refusals, never echoes passwords/PINs).
Surface suffixes adapt context (.ai command vs 1-on-1 DM). Both engines
receive it identically (systemInstruction path of Gemini AND the NIM
fallback).

**Wiring:** the three chat sites now share it — .ai (command surface), the
DM assistant, AND the "Simulator Direct AI" path, whose Gemini-only gate had
escaped the 8.35 isAIConfigured sweep (honest miss, fixed here: the NIM
fallback now covers it too).

**Tuning:** `NEBULA_AI_PERSONALITY` replaces the entire persona (documented
in .env.example + manage.sh env menu + README) — test personas without a
deploy via `nebula env set`.

**Suite:** 329/329 (36 files, +7: sections/placeholder/suffix/compactness/
override + whitespace-ignore + wiring guard on all three surfaces).

### 8.38 Per-conversation persistent AI memory (2026-09-01, fortieth push)

**Owner decisions (asked explicitly):** memory keyed PER CHAT, SLIDING TTL
(counter restarts on every message; default 10 h of silence, env-tunable),
raw turns + ROLLING SUMMARY (supermemory-inspired), full controls.

**Inspiration, right-sized:** supermemory's containers (→ per-chat scope),
distilled memories (→ compaction of old turns into a rolling summary) and
query-time injection (→ memory block appended to the system prompt);
supercontext's centralized shared store was evaluated and REJECTED for this
scale (single bot, ~1 GB container — a JSON store with atomic writes, zero
new dependencies, matches the existing watch-subscriptions pattern).

**New `src/bot/services/aiMemory.ts`:** `ai_memory.json` per-chat entries
{turns, summary, lastTs}; `recordExchange` (write-time secret filter —
password/PIN/API-key-bearing turns are never persisted; turns capped at
1500 chars, 500 chats, LRU eviction); `getMemoryContext` (sliding-TTL check
with on-sight expiry cleanup, injection block ≤ 4000 chars = summary + raw
turns); `compactIfNeeded` (above NEBULA_AI_MEMORY_MAX_TURNS (20), folds
oldest turns into the rolling summary via `defaultMemorySummarizer` — an
INTERNAL maintenance call that does not consume the per-user daily quota;
on failure raw turns are kept, hard-capped at 40); `forgetMemory`;
`memoryStatus`.

**Wiring:** `.ai` (memory-aware system prompt + record + lazy compaction;
new `.ai forget` / `.ai oublie` subcommand) and the DM assistant (same
pattern, keyed by the DM chat). The panel-simulator AI path is deliberately
NOT wired (ephemeral test surface).

**Env:** `NEBULA_AI_MEMORY_TTL_HOURS` (default 10, 0 = disabled),
`NEBULA_AI_MEMORY_MAX_TURNS` (default 20) — .env.example, manage.sh env
menu, README.

**Suite:** 339/339 (37 files, +10: inject/isolation, sliding-TTL keep after
9.5h+9.5h, expiry wipe, TTL=0, secret filter, compaction fold + failure
fallback, forget scoping, status line).

### 8.39 Offline download page — one HTML document instead of a link wall (2026-09-01, forty-first push)

**Owner idea (validated):** multi-episode batches used to deliver N links in
WhatsApp — tapping each meant whatsapp↔chrome ping-pong. Now the bot sends
ONE `.html` document: opened once in Chrome, per-episode "⬇ Télécharger"
buttons plus a "Tout télécharger" action that walks the list automatically.

**Implementation:** `src/bot/services/downloadPage.ts` — self-contained page
(inline CSS only, ~7 KB, works from the WhatsApp download folder with no
network beyond the links). Sequential engine uses hidden iframes pointed at
the temp-link route, which already serves `Content-Disposition: attachment`
(+CORS, +Range) — real downloads, no navigation, cross-origin safe, zero JS
on the target. Live expiry countdown (links' earliest expiresAt, now carried
in generatedLinks), expired state disables everything, first-run hint about
Chrome's one-time "download multiple files" permission. Project palette
(zinc-950/#09090b, cards #18181b, amber-500/#f59e0b, emerald/rose accents).
All user-derived text HTML-escaped (tested with script-injection labels).

**Delivery wiring (novabox):** batches with >1 episode send a compact
summary message + the HTML document (buffer, text/html, quoted reply);
single-episode batches and the ZIP mode are unchanged; if the document send
fails, the legacy full-links message is used (honest fallback, no silent
loss).

**Verification (re-verification pass run explicitly):** suite 348/348
(38 files, +9: URL embedding incl. escaped forms, XSS escaping, palette
constants, buttons/download attrs, totals+countdown+hint, expiry embedding,
self-containment, <16 KB, wiring guard). tsc, eslint 0 errors, production
build OK. Structural validation of a real generated page: python HTMLParser
tag balance OK, 3 buttons, sequential URL list parses as JSON, 6.9 KB.
NOT testable in-sandbox: an actual Chrome download session (egress) — the
iframe+attachment mechanism is the standard pattern and the route headers
were verified in source.

### 8.40 Multi-download failures on urlset master playlists — full download-system audit (2026-09-01, forty-second push)

**Owner report:** some episodes fail during multi-download. Production log
(Gachiakuta S01 E04, vidmoly) showed the exact failure chain:
`_,n,l,.urlset/master.m3u8` → 403 Forbidden to BOTH engines (Cat-Catch app
level AND legacy FFmpeg, twice with fresh tokens), episode silently dropped,
summary only said "Ready Episodes: 4/5".

**Root cause (evidence-based):** every WORKING vidmoly URL in the same batch
has the shape `{prefix}_{q}/index-v1-a1.m3u8` — the failing episode was the
only one whose embed exposed a multi-quality `master.m3u8` (urlset). The
master path 403s (node-level hotlink/token binding) while variant paths stay
downloadable. The existing `deriveSubVariantUrls` fallback guessed
`index.m3u8` / `{prefix}_{q}.m3u8` — names that do not exist on this CDN
family — so every derived candidate also 403'd. Sandbox egress to vidmoly is
blocked (HTTP 000), so the fix is validated against the exact production
URLs from the log as fixtures instead of a live download.

**Fixes:**
1. `hlsDownloader.deriveSubVariantUrls` — derived candidates now lead with
   the production-proven shape `{prefix}_{q}/index-v1-a1.m3u8` (+ `-f1-`
   variant), then the legacy guesses, plus a no-letter fallback; signature
   query (t/s/e/asn tokens) preserved on every candidate.
2. `hlsDownloader.getHeaderCandidates` (now exported) — the vidmoly referer
   rotation (vidmoly.biz/to/net, vmpx, ansembed, anime-sama) previously
   keyed on the URL host containing `vmpx./vidmoly./...`; it now also covers
   the file-host families observed in production (vmeas., vmget., vmnow.)
   with `https://vidmoly.biz/` tried first (the actual embed host).
3. `services/batchRecap.formatFailedEpisodes` — the batch summary now lists
   exactly which episodes failed and tells the user to re-ask for them in a
   few minutes, instead of a bare "4/5".

**Not changed (audited, deliberately):** per-episode mirror loop already
re-probes with a fresh token once (NOVABOX_FFMPEG path) — a third retry adds
latency without benefit since CDN node choice is deterministic per file;
JIKAN 504s are metadata-only with a working fallback; Windows console
mojibake in `nebula logs` is a codepage artifact (use Windows Terminal /
`chcp 65001`), not a bot defect.

**Verification:** 358/358 tests (39 files, +10: proven-shape derivation with
the exact failed URL as fixture, token preservation on candidates, legacy
guesses kept, media-playlist no-op, master.txt legacy branch, referer
rotation coverage for vmeas/vmget/vmnow/vmpx hosts, base-header merge
priority, recap formatting incl. the 4/5 log case, dedup, wiring guard).
tsc, eslint 0 errors, production build OK. Live CDN validation pending on
the VPS (sandbox egress blocked) — the fix targets the exact observed URL
shapes.

### 8.41 Full audit of the HTML download-page pipeline (2026-09-01, forty-third push)

**Owner request:** audit the entire HTML output the bot sends — verify there
are no problems. Audited surface: `services/downloadPage.ts` (generation),
novabox delivery wiring, the consumed `generatedLinks` data, and the
temp-link route contract the page relies on.

**Findings and fixes (7):**

1. **`</script>` breakout in the embedded URL list** (defense-in-depth).
   `var urls = ${JSON.stringify(...)}` does not escape `<`, so a URL
   containing `</script>` would terminate the script block early. Today the
   URLs are internally generated (`/api/dl/<hex token>`) so not exploitable
   via WhatsApp input, but the builder is an exported module. Fixed: the
   JSON literal now escapes `<`, `>` and `&` (`\u003c`…); verified with a
   hostile-URL fixture (page contains exactly ONE closing script tag and the
   payload round-trips through JSON.parse).
2. **Expired per-episode link destroyed the page.** A plain `<a href>` click
   on a 410 link navigated the whole page to the server's expiry card (it
   has no attachment header). Fixed: clicks are intercepted
   (preventDefault), a HEAD probe (route serves CORS `*` + HEAD) detects
   410/404 and shows an honest red "⏳ expiré — redemande au bot" state;
   live links download via the hidden-iframe mechanism. `href` +
   `target="_blank"` kept as no-JS / middle-click fallbacks.
3. **"Tout télécharger" lied on expired links** (marked "✓ lancé"
   blindly). Fixed: every item in the chain is probed first; expired items
   get the failed style and the button reports "⚠️ N lien(s) expiré(s)".
   Probe errors degrade to a best-effort download (no false negative).
4. **Countdown wording with unknown expiry** ("expire dans —"). The
   countdown span is now rendered only when expiresAt is known.
5. **Double delivery in ZIP mode:** the HTML page was sent even when a
   season ZIP would follow. The page is now skipped when `zipDownloadUrl`
   is set (ZIP mode is an explicit one-archive request).
6. **Misleading summary hint:** "Click any link above…" was appended even
   when the message contained no links (page-delivered, no ZIP). Now
   conditional.
7. **Total-failure case was silent-ish:** when EVERY episode failed, the
   user received a "BATCH EPISODES READY" player-links message with no
   failure mention. A `failedEpisodeCount` (all three failure paths) now
   prepends "❌ Download failed for all N episode(s) — every mirror was CDN
   restricted…" to that fallback.

**Checked, no action needed:** title/subtitle/label/size escaping (tested),
UTF-8 buffer + meta charset, `Content-Disposition: attachment` making the
cross-origin `download` attribute irrelevant, countdown math + expired
state, ~8 KB single-file size, mobile viewport, WhatsApp `text/html`
document delivery with quoted reply, legacy-links fallback on send failure,
single-episode and ZIP flows, min-expiresAt selection for the countdown.

**Verification:** 363/363 tests (39 files; downloadPage suite grown to 14:
breakout fixture, HEAD-probe/expired-state wiring, conditional countdown,
blank-target fallbacks, ZIP gate, all-failed notice). tsc, eslint 0 errors,
production build OK. Structural validation of a generated page via python
HTMLParser: balanced tags, exactly one `</script>`, URL list JSON-decodable
after unescaping, 8.2 KB.

### 8.42 Source privacy — the bot never names the private anime sources (2026-09-01, forty-fourth push)

**Owner requirement:** the anime sources (nakanime, voiranime, franime,
anime-sama) are private — the bot must NEVER mention them in anything it
sends. Full sweep of every runtime surface (WhatsApp messages, panel UI,
served HTML, filenames, captions) via a literal scanner (string + template
literals, comments stripped).

**Findings — 15 user-facing mentions, all fixed:**
- novabox: watch hint named voiranime/nakanime; franime.fr named in the VF
  Cloudflare error; searchFailureMessage named anime-sama three times AND
  leaked the domain in a `curl https://anime-sama.to` verification hint
  (replaced with `nebula doctor`); "Language switched to VF! (voiranime)"
  ×2 and "(nakanime)" ×1; "voiranime VF entry" in an error.
- watch: four messages named voiranime, including one that quoted the
  NEBULA_VOIRANIME_DISABLED env var name and one that replied raw
  err.message (DNS/axios errors embed the source domain) — now generic
  text, details stay in VPS logs.
- franimeClient: last-resort catalog title `franime #<id>` could surface in
  the search results list → `Anime #<id>`.

**Deliberately unchanged (internal, never sent):** console.* diagnostics on
the VPS (they are how we debug — 8.40 was solved through them), client URL
builders and origins, SSRF host allowlists (urlSafety), HTTP Referer/Origin
headers (functional requirement), env var NAMES (NEBULA_VOIRANIME_DISABLED
stays — only its display in user messages was removed), repo dev docs
(private repo). Panel UI (all TSX), app.ts and server.ts were already clean.

**Regression guard:** `tests/sourcePrivacy.test.ts` scans every string
literal of every runtime surface on each CI run and fails if a private
source name appears outside the explicit internal allowlist (console lines,
URL/regex builders, module specifiers, session-url key prefix, SSRF host
file). Self-check test proves the scanner flags leaks and passes internals.

**Verification:** 365/365 tests (40 files, +2), tsc, eslint 0 errors,
production build OK.

### 8.43 urlset 403 round 2 — referer matrix at extraction time (2026-09-01, forty-fifth push)

**Owner report:** "pas toujours au point" — Vinland Saga S02 E05 failed with
the same urlset-master 403 on `box-1659-u.vmbox.space`. Critical evidence:
`nebula-p` main was already at `fc01721` ("Fix 8.40") when this happened, so
the 8.40 fix WAS live and still insufficient.

**Why 8.40 missed this case (three gaps):**
1. `vmbox.space` (and `vmcld.space`, which served WORKING episodes in the
   same batch) were not in the CDN-family list, so the full vidmoly referer
   rotation never applied to them — the derived variants were only tried
   with the base (embed) referer, a same-host referer and an anime-sama
   referer.
2. The sub-variant safety net tried only the first 3 header candidates.
3. Even when a referer would have worked, nothing propagated a "winning"
   referer to the download engines.

**Fixes (layered):**
- `isVidmolyCdnUrl` (new, exported): family detection now matches the
  `/hls2/` path signature shared by every URL of this CDN family plus all
  hosts seen in production (vmpx/vmeas/vmget/vmnow/vmbox/vmcld/…) — future
  host rotations are covered.
- `resolveVidmolyUrlset` (new, exported): bounded brute-force matrix — the
   master URL first, then the 4 proven variant shapes × every referer
   candidate (≤26 attempts, 6s timeouts) — returning the media playlist URL
   AND the header set that answered.
- `extractMultiHostStream` (vidmoly branch) resolves urlset masters AT
   EXTRACTION TIME and propagates the winning referer inside
   `ExtractedStreamResult.headers`, so track parsing and both download
   engines (Cat-Catch app-level, legacy FFmpeg) all use the working pair.
- Variant derivation now favours the LAST urlset letter (`_l`) — the
   rendition every single-quality file uses in production.
- `robustFetchText` safety net widened from 3 to 5 header candidates.

If a file 403s on every path×referer (token bound to the master path), the
episode still fails — but now with an explicit `[VIDMOLY_URLSET] Unresolved
after N attempt(s)` log line, and the 8.40 failure recap tells the user
which episodes to re-ask.

**Verification:** 373/373 tests (41 files, +8: family detection incl.
vmbox/vmcld/hls2 signature + negative cases, mocked-axios matrix proving
variant bypass with the winning referer, direct-master-referer bypass,
bounded budget on total failure, no-op for media playlists, `_l`-first
derivation, extraction-time wiring). tsc, eslint 0 errors, build OK. Live
confirmation pending on the VPS (sandbox egress blocked): re-ask Vinland
Saga S02 E05.

### 8.44 urlset 403 round 3 — legacy single-episode path covered + deployment gap identified (2026-09-01, forty-sixth push)

**Owner retest (Vinland Saga S02E05, single episode):** still failing — but
the log contained ZERO `[VIDMOLY_URLSET]` lines, which the 8.43 code emits
unconditionally (success OR failure) on any urlset master. Verification via
the GitHub API: `nebula-p` main WAS already at `3e45dd0` ("8.41-8.43") with
the resolver present in source. Conclusion: the fix reached GitHub but the
VPS process was still running the previous build — `nebula update` had not
taken effect (not run, run before the push, or build step failed).

**Code gap found in the same log (fixed here):** the single-episode flow has
a SECOND download path ("Direct download failed → legacy VidMoly fallback
resolution") that re-extracts the stream itself and hands the raw urlset
master straight to `executeFfmpegDownload` — 8.43 only covered the
mirror/extraction path. The legacy path now resolves urlset masters through
`resolveVidmolyUrlset` as well and propagates the winning Referer/Origin to
the engines. Both paths of both flows (single + batch) are now covered.

**Verification:** 374/374 tests (41 files, +1 wiring guard), tsc, eslint 0
errors, build OK. Deployment checklist for the VPS: `nebula update` then
confirm `grep -c VIDMOLY_URLSET dist/server.cjs` ≥ 1 before retesting.

### 8.45 urlset 403 round 4 — the resolver now sits at the funnel (2026-09-01, forty-seventh push)

**Owner retest with 8.44 live** (`grep -c VIDMOLY_URLSET dist = 8`, resolver
ran and logged `Unresolved after 26 attempt(s)` at the legacy path): E05
still fails — but the log carried the decisive clue.

**The clue:** `[MIRROR_FALLBACK] Attempting download with host "vidmoly.biz"`
— the dedicated vidmoly extraction branch reports hostName `"VidMoly"`;
`"vidmoly.biz"` is the signature of the GENERIC last-resort probe
(`probeGenericPlayerPage`, hostname of the player URL). In production, the
vidmoly branch's embed fetch is rejected (its anime-sama referer gets the
embed page 403'd), so virtually ALL vidmoly extraction flows through the
generic probe — the one branch the 8.43 resolver was NOT wired into. The
extraction-time resolution was dead code on the real path; only the 8.44
legacy-path call ever ran (hence exactly one `[VIDMOLY_URLSET]` log line).

**Fixes:**
- `executeDirectOrFfmpegDownload` (the funnel EVERY branch converges to,
  mirror + quick + generic paths alike) now resolves urlset masters itself
  and merges the winning Referer/Origin into the stream headers before any
  engine starts. Branch-level coverage no longer matters.
- Matrix extended modestly: both urlset letters (`_l` then `_n`) proven
  shapes — 6 variant paths × referers, budget 26 → 34 attempts (still
  bounded, fast-failing attempts).

**About THIS file (Vinland Saga S02E05 on box-1659-u.vmbox.space):** the
full matrix genuinely ran and every path×referer 403'd from the VPS. If the
node blocks at IP/TLS level, no URL shape will fix it — the bot already
degrades honestly (streaming embed link + explicit failure). Decisive
one-command diagnostic for the VPS (fresh URL from a retry):
`curl -so /dev/null -w "%{http_code}\n" -A "Mozilla/5.0" -e "https://vidmoly.biz/" "<variant url>"`
— 403 from curl + playing fine in the owner's browser = network-level block
on that node; anything else = send me the output.

**Verification:** 375/375 tests (41 files, +1 funnel wiring guard with the
hostName evidence documented), tsc, eslint 0 errors, build OK.

### 8.46 Cross-source fallback wheel — rescue for CDN-blocked episodes (2026-09-01, forty-eighth push)

**Owner decision:** when an episode keeps failing on the primary VF source,
fall back to another anime source automatically.

**Evidence recap (8.43–8.45):** the funnel resolver now runs everywhere and
the failing file (Vinland Saga S02E05 on box-1659-u.vmbox.space) 403s EVERY
variant path × referer from the VPS — a node-level network block no URL
shape can bypass. The structural weakness: that episode exposed exactly ONE
mirror, so there was nothing to fall back to inside the source.

**Implementation (`services/animeFallback.ts` + novabox wiring):** the
secondary catalog (nakanime — already integrated, reachable from the VPS,
several players per episode on different CDNs, sometimes VF lists of its
own) is now an automatic rescue wheel:
- search → best-title match → seasons (matching number, VF-named first) →
  episode lists, cached per title|season for 10 min so a 12-episode batch
  pays one lookup, not twelve;
- mirrors are tiered like the main flow (VF/unlabeled lists first, other
  languages second); positional list semantics identical to
  splitMirrorsByLanguage;
- wired in BOTH flows after all primary mirrors fail: single episode (after
  the legacy path) and batch (per-episode rescue before marking failed);
- language honesty: the URL that actually answered is mapped back to its
  list language — filename and message say what was really delivered
  (`Anime_VOSTFR_...mp4` + "via la roue de secours — VF indisponible sur le
  CDN"), and the batch summary counts rescued episodes;
- gate: `NEBULA_VOSTFR_FALLBACK=0` disables (default ON); documented in
  `.env.example`, `manage.sh` env assistant and README.

Deliberate choice: no brand-new unknown streaming site — none can be
verified from the sandbox (egress blocked) and an unverified scraper would
ship blind. The secondary catalog is proven reachable from this VPS.

**Verification:** 386/386 tests (42 files, +11: VF label detection,
URL→language mapping, best-result matching, season pick + VF ordering,
mirror tiering incl. label-less semantics parity, out-of-range no-op,
resolve + cache call-counts, null on unknown season, VF-first mirror
ordering, env/wiring guards). tsc, eslint 0 errors, build OK, manage.sh
syntax OK. Live confirmation on the VPS: re-ask a known-blocked episode —
the log must show `Cross-source fallback: trying N mirror(s)` then either
`succeeded via <host> (VF|VOSTFR)` or the honest failure recap.

### 8.47 Dead-file memory + pointless-compression skip (2026-09-01, forty-ninth push)

**Owner confirmation:** the cross-source wheel WORKS — Vinland Saga S02E05
was rescued in VF via the secondary catalog (mirror 2 = a different upload
of the episode on a healthy node, after mirror 1 re-served the same dead
file id). Owner preference noted: a brand-new site would have been
preferred over nakanime (past issues); accepted since it is proven
VPS-reachable, and `animeFallback.ts` is source-agnostic (deps injected) —
adding a third site later means writing one client, no rewiring.

**Two time sinks visible in that same log, both fixed:**
1. ~3-4 min retrying a known-dead file: the vidmoly family serves the SAME
   file id from several embed hosts (.biz/.org/...); mirror 1 of the
   fallback re-ran the full 34-attempt matrix + two FFmpeg passes on the
   exact file that had just 403'd everywhere. Fix: dead-file slug memory
   (`hlsDownloader`, 30-min TTL, 200-entry cap) checked and marked at every
   retry surface — urlset matrix, funnel engine, mirror loop, novabox
   ffmpeg path (single + batch). A slug marked from one URL form (embed)
   is detected in every other form (urlset/media) of the same file.
2. 121.8 s of futile 480p→480p re-encoding (could only time out; delivery
   fell back to the raw high-speed link anyway). Fix: an 8s-bounded ffprobe
   height check — when the downloaded source is already ≤480p tall,
   compression is skipped and the episode goes straight to link delivery.
   Probe failure (null) keeps the previous behavior.

**Verification:** 394/394 tests (43 files, +8: slug extraction across the
three URL forms + negatives, cross-form dead detection incl. the exact
production case, TTL self-healing with fake timers, compression decision
table incl. null-probe, wiring guards for all check/mark points). tsc,
eslint 0 errors, build OK.

### 9.7 Media tooling references evaluated (sadness-splitter, addyosmani/video-compress — 2026-09-02)

Pre-research for the upcoming media-toolkit story (owner-approved direction).
Both repos cloned and inspected; zero dependencies added, zero code taken.

**DivyanshuChipa/sadness-splitter** — Tauri v2 desktop video suite (Rust +
FFmpeg). Not a scraper: nothing for the anime-source problem. Retained
techniques for the bot's future `.v` toolkit: chained `atempo` for speed
factors >2× (`atempo=2.0,atempo=x/2`), quality GIF recipe
(`fps+lanczos+palettegen/paletteuse`), aspect-preserving scale+pad, annotated
CRF scale (≤20 HQ / ≤23 balanced / >23 small). Thumbnail idea rejected:
base64 vignettes would triple the 8 KB download page against the "optimized"
requirement.

**addyosmani/video-compress** — browser compressor (React + ffmpeg.wasm).
The wasm angle is irrelevant server-side (native FFmpeg on the VPS), but the
**file-size targeting formula** is directly applicable to our WhatsApp
95-100 MB ceiling: `videoKbps = (targetMB × 8 × 1024) / durationSeconds`
(their version omits subtracting the audio bitrate — ours will subtract it
and clamp to sane 480p bounds). Also retained: the percentage→CRF mapping
`crf = 51 − (pct/100) × 33` for a future `.v compress 50%` UX. Combines with
the 8.47 ffprobe helper (duration + height already probed) into a
deterministic "fit under X MB" mode instead of CRF-26-and-hope.

Both fold into the same future story: `.v mp3 | gif | vitesse | trim |
compress [pct|MB]` on the existing VPS FFmpeg infrastructure — fully
locally testable, no network dependency.

### 8.48 Media toolkit `.m` + deterministic WhatsApp-fit compression (2026-09-02, fiftieth push)

Implements the direction approved after the two repo evaluations (§9.7:
size-target formula from addyosmani/video-compress with the audio track
subtracted — the bug their version has — plus sadness-splitter's chained
atempo, palettegen GIF and scale+pad recipes; zero code taken, zero deps).

**New: `services/mediaToolkit.ts`** — pure, fully-tested FFmpeg recipe
builders: `crfFromPercentage` (100%→18 … 0%→51, clamped),
`videoBitrateKbpsForTargetMb` (audio subtracted FIRST, clamped 120–4000),
`estimateSizeMb` round-trip, `atempoChain` (per-filter 2.0 limit, factor
clamped 0.5–4), `speedFilterComplex` (setpts + audio chain, video-only
variant), `gifVideoFilter` (lanczos+palettegen/paletteuse), `scalePadFilter`,
`parseTimeSpec` (MM:SS / HH:MM:SS / 1m30 / s), arg builders for mp3/gif/
speed/trim/compress, `whatsappFitVideoOptions` (deterministic -b:v +
maxrate + `scale=-2:min(480\,ih)` — never upscales), bounded `probeVideoInfo`
(duration+height+audio, one call) and `runFfmpegKit` (hard timeout).

**New: `.m` command (media.ts, alias `m`)** — reply-to-media UX: mp3
extraction (96–320 kbps), quality GIF (12 fps/480px, first 10 s by default,
`full` capped at 60 s), speed 0.5–4× (audio preserved), lossless trim,
compression by `50%`/`95mb`/explicit CRF. Outputs ≤90 MB arrive as WhatsApp
documents; bigger ones as 2 h high-speed links (same infra as anime).
Process-wide single-flight lock (VPS CPU is a shared cgroup resource).

**Engine: quoted-media fallback** — `context.downloadMedia()` now falls back
to the QUOTED message's media when the invoking message has none (pure
helper `utils/quotedMedia.ts`, unwraps ephemeral/viewOnce). This is what
makes "reply to a video with .m gif" work; existing own-media behavior
unchanged.

**Novabox: deterministic WhatsApp fit** — the >100 MB compression path now
probes duration once (8.47's height probe folded into `probeVideoInfo`) and,
when known, splices `whatsappFitVideoOptions` (target 92 MB, margin under
the ~95–100 MB cap) in place of the fixed CRF 26: the output size becomes a
mathematical certainty instead of CRF-and-hope. Unknown duration keeps the
legacy CRF 26 args; the ≤480p skip (8.47) is preserved.

**Self-review fixed before shipping:** initial splice was ineffective
(legacy options came after and ffmpeg lets the LAST option win — CRF 26
would have silently overridden the computed bitrate) and carried a leftover
empty arg; a `min(480\\,ih)` double-escaping bug was caught by rendering the
actual value at runtime; the unreachable sub-0.5 atempo branch was removed.

**Verification:** 408/408 tests (44 files, +14: formula table incl. the
audio-subtraction proof 95 MB/1200 s → 552k and the round-trip, atempo
chains incl. clamps, time-spec parser, builders incl. gif bounds and
deterministic fit 1440 s → 427 kbps → 91.9 MB, quoted-media extraction incl.
viewOnce, wiring guards). tsc, eslint 0 errors, production build OK. FFmpeg
is not installable in the sandbox (no root) — runtime execution validates on
the VPS; every arg array is asserted in tests instead.
