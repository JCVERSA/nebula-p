/**
 * ============================================================================
 *  NEBULA - Anime Pipeline Replay  (one-shot repro for `.a <q> sN epN rN`)
 * ============================================================================
 *  Run ON THE SERVER where the bot lives, with the SAME code the bot uses:
 *
 *      npx tsx scripts/anime-repro.ts rezero 5 2
 *
 *      -> replays: search "rezero" -> season 5 -> episode 2 -> player probes
 *
 *  Options:
 *      --pick 2       use search result #2 instead of #1
 *      --dl           also attempt the real download to /tmp (like `.a r2`)
 *      --proxy URL    egress proxy (http://... or socks5://...) — same as
 *                     NEBULA_ANIME_PROXY, overrides it for this run
 *      --res 480P     resolution preference for --dl (default 360P)
 *
 *  It prints every intermediate artifact (search source, seasons, per-list
 *  episode players, HTTP status of each player page, extracted stream per
 *  mirror, download result) so a failure can be located in ONE paste.
 *  Exit code 0 = a playable stream was resolved (and downloaded with --dl).
 *
 *  NOTE: output is intentionally ASCII-only (safe to paste anywhere).
 */

import fs from "fs";
import path from "path";
import os from "os";

// ---------------------------------------------------------------- args ----
const argv = process.argv.slice(2);
const positional: string[] = [];
let pick = 1;
let doDownload = false;
let res = "360P";
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--pick") pick = parseInt(argv[++i], 10) || 1;
  else if (a === "--dl") doDownload = true;
  else if (a === "--res") res = argv[++i] || "360P";
  else if (a === "--proxy") process.env.NEBULA_ANIME_PROXY = argv[++i];
  else if (a === "--help" || a === "-h") {
    console.log(
      "usage: npx tsx scripts/anime-repro.ts <query> [season] [episode] [--pick N] [--dl] [--res 480P] [--proxy URL]",
    );
    process.exit(0);
  } else positional.push(a);
}

const query = positional[0];
const seasonNum = parseInt(positional[1], 10) || 1;
const epNum = parseInt(positional[2], 10) || 1;
const epIndex = epNum - 1;

if (!query) {
  console.error(
    "usage: npx tsx scripts/anime-repro.ts <query> [season] [episode] [--pick N] [--dl] [--res 480P] [--proxy URL]",
  );
  process.exit(2);
}

// ------------------------------------------------- minimal .env loader ----
// Same spirit as the bot runtime: never override what is already set.
try {
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
} catch {}

const trunc = (s: string, n = 130): string =>
  s && s.length > n ? s.slice(0, n) + "..." : s || "(empty)";
const hr = (t: string) => console.log(`\n===== [${t}] =====`);

let exitCode = 0;

async function main(): Promise<void> {
  // Imports are dynamic so --proxy/.env are applied before modules read env.
  const { searchAnime, parseSeasons, parseEpisodesDetailed } =
    await import("../src/bot/commands/novabox.js");
  const { isNakanimeUrl, nakanimeSeasonRefNumbers } =
    await import("../src/bot/services/nakanimeClient.js");
  const { extractMultiHostStream, downloadWithAllMirrorsFallback, hostPriority } =
    await import("../src/bot/services/animeStreamExtractor.js");
  const { resolveRequestedSeason } = await import("../src/bot/utils/quickAnimeParser.js");
  const { animeProxyOptions, describeAnimeProxy } =
    await import("../src/bot/services/scrapingProxy.js");
  const axios = (await import("axios")).default;

  console.log(
    `NEBULA anime pipeline replay  |  query="${query}"  s${seasonNum}  ep${epNum}  pick=${pick}  dl=${doDownload}`,
  );
  const proxyDesc = describeAnimeProxy();
  console.log(`egress proxy: ${proxyDesc}`);

  // ------------------------------------------------------ 1. SEARCH ----
  hr("1/5 SEARCH");
  let results: Array<{ title: string; subtitle?: string; url: string }>;
  try {
    results = await searchAnime(query);
  } catch (err: any) {
    console.log(`[KO] search threw: ${err?.response?.status || err?.code || err?.message}`);
    process.exit(1);
  }
  if (!results || results.length === 0) {
    console.log("[KO] search returned 0 results");
    process.exit(1);
  }
  const source = isNakanimeUrl(results[0].url) ? "nakanime.tv (fallback)" : "anime-sama (direct)";
  console.log(`[OK] ${results.length} result(s)  |  SOURCE: ${source}`);
  results
    .slice(0, 5)
    .forEach((r, i) => console.log(`  ${i + 1}. ${trunc(r.title, 60)}  ->  ${trunc(r.url, 100)}`));
  const chosen = results[Math.min(Math.max(pick, 1), results.length) - 1];
  console.log(`chosen #${pick}: ${trunc(chosen.title, 60)}  ->  ${trunc(chosen.url, 110)}`);

  // ----------------------------------------------------- 2. SEASONS ----
  hr("2/5 SEASONS");
  const seasons = await parseSeasons(chosen.url);
  if (!seasons || seasons.length === 0) {
    console.log("[KO] 0 seasons parsed");
    process.exit(1);
  }
  console.log(`[OK] ${seasons.length} season(s):`);
  seasons.forEach((s, i) =>
    console.log(`  ${i + 1}. ${s.name}  (${trunc(s.subPath, 50)})  ${trunc(s.url, 100)}`),
  );

  const { season, index } = resolveRequestedSeason(seasons, seasonNum);
  if (!season) {
    console.log(`[KO] season s${seasonNum} could not be resolved (see list above)`);
    process.exit(1);
  }
  console.log(
    `resolved s${seasonNum} -> index ${index}: ${season.name}  ${trunc(season.url, 110)}`,
  );

  // ---------------------------------------------------- 3. EPISODES ----
  hr("3/5 EPISODE PLAYERS");
  const jsUrl = season.url + "episodes.js";
  console.log(`episodes source: ${trunc(jsUrl, 120)}`);
  const { lists: eps, labels: epLabels } = await parseEpisodesDetailed(jsUrl);
  if (isNakanimeUrl(season.url)) {
    try {
      const nums = await nakanimeSeasonRefNumbers(season.url, seasonNum);
      console.log(
        `season episode refs: n=${nums.length}  first=[${nums.slice(0, 10).join(",")}]  last=[${nums.slice(-5).join(",")}]`,
      );
    } catch {}
  }
  const listIds = Object.keys(eps || {})
    .map(Number)
    .sort((a, b) => a - b);
  if (listIds.length === 0) {
    console.log("[KO] episode player lists are EMPTY");
    process.exit(1);
  }
  const mirrors: string[] = [];
  for (const id of listIds) {
    const arr = eps[id] || [];
    const epUrl = arr[epIndex] || "(missing)";
    if (arr[epIndex] && !mirrors.includes(arr[epIndex])) mirrors.push(arr[epIndex]);
    console.log(`  list ${id}: ${arr.length} eps  |  ep${epNum} -> ${trunc(epUrl, 110)}`);
  }
  const labelStr = Object.keys(epLabels)
    .map(Number)
    .sort((a, b) => a - b)
    .map((k) => `${k}: ${epLabels[k].host} (${epLabels[k].language})`)
    .join("  |  ");
  if (labelStr) console.log(`list labels: ${labelStr}`);
  const maxEps = Math.max(...listIds.map((id) => (eps[id] || []).length));
  if (epIndex >= maxEps) {
    console.log(`[KO] ep${epNum} out of range (max ${maxEps})`);
    process.exit(1);
  }
  if (mirrors.length === 0) {
    console.log(`[KO] no player URL at all for ep${epNum} (lists exist but entry missing)`);
    process.exit(1);
  }
  console.log(`[OK] ${mirrors.length} unique mirror(s) for ep${epNum}`);

  // ---------------------------------------------- 4. PLAYER EXTRACTION ----
  hr("4/5 STREAM EXTRACTION PER MIRROR");
  const sorted = [...mirrors].sort((a, b) => hostPriority(a) - hostPriority(b));
  const seenHosts = new Set<string>();
  const deduped = sorted.filter((m) => {
    try {
      const h = new URL(m).hostname;
      if (seenHosts.has(h)) return false;
      seenHosts.add(h);
      return true;
    } catch {
      return true;
    }
  });
  console.log(`probing ${deduped.length} unique host(s) (from ${sorted.length} mirrors)`);
  let anyStream = false;
  const t4 = Date.now();
  for (const m of deduped) {
    const host = (() => {
      try {
        return new URL(m).hostname;
      } catch {
        return "?";
      }
    })();
    let httpStatus = "?";
    try {
      const probe = await axios.get(m, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        timeout: 8000,
        maxRedirects: 5,
        validateStatus: () => true,
        ...animeProxyOptions(),
      });
      httpStatus = String(probe.status);
    } catch (err: any) {
      httpStatus = `ERR:${err?.code || err?.message}`;
    }
    let line = `  [${host}] page HTTP ${httpStatus}  (priority ${hostPriority(m)})`;
    try {
      const extracted = await extractMultiHostStream(m);
      if (extracted && extracted.url) {
        anyStream = true;
        const tracks =
          (extracted.availableTracks || []).map((t: any) => t.resolution).join(",") ||
          "none-listed";
        line += `\n      -> STREAM OK  host=${extracted.hostName}  type=${extracted.type}\n         url=${trunc(extracted.url, 120)}\n         tracks: ${tracks}`;
      } else {
        line += `\n      -> EXTRACTION FAILED (no stream found by any known recipe)`;
      }
    } catch (err: any) {
      line += `\n      -> EXTRACTION THREW: ${err?.message}`;
    }
    console.log(line);
  }
  console.log(`extraction stage took ${((Date.now() - t4) / 1000).toFixed(1)}s`);
  if (!anyStream) {
    console.log(
      "\n[KO] NO mirror produced a playable stream -> this is exactly why WhatsApp got the fallback-links card.",
    );
    exitCode = 1;
  } else {
    console.log("\n[OK] at least one mirror produced a playable stream.");
  }

  // ------------------------------------------------- 5. DOWNLOAD ----
  if (doDownload) {
    hr("5/5 DOWNLOAD ATTEMPT (like .a r2)");
    const outPath = path.join(os.tmpdir(), `nebula_repro_${Date.now()}.mp4`);
    const t0 = Date.now();
    const result = await downloadWithAllMirrorsFallback(mirrors, res, outPath, 240000);
    const size = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
    if (result.success && size > 1000) {
      console.log(
        `[OK] downloaded via ${result.hostName}: ${(size / 1048576).toFixed(2)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      console.log(`     file: ${outPath} (kept for manual inspection / ffprobe)`);
    } else {
      console.log(
        `[KO] download failed (success=${result.success}, size=${size} bytes, host=${result.hostName})`,
      );
      exitCode = 1;
    }
  } else {
    console.log("\n(tip: add --dl to also attempt the real download like .a r2 does)");
  }

  console.log(
    `\n===== RESULT: ${exitCode === 0 ? "PIPELINE HEALTHY" : "PIPELINE BROKEN (see [KO] lines above)"} =====`,
  );
}

main().catch((err) => {
  console.error("replay crashed:", err);
  process.exit(1);
});
process.exitCode = exitCode;
