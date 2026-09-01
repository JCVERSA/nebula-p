/**
 * ============================================================================
 *  FRAnime probe — one-shot VF-path diagnostic (audit §8.7)
 * ============================================================================
 *  Run ON THE SERVER where the bot lives:
 *
 *      npx tsx scripts/franime-probe.ts "code geass" 2 2
 *
 *  Steps: catalog fetch (+cache) -> title search -> season/episode lecteurs
 *  -> resolve player URLs for the episode (VF first) -> optional download test
 *  with --dl. Tells you exactly what works and what is Cloudflare-blocked.
 */

import fs from "fs";
import path from "path";
import os from "os";

const argv = process.argv.slice(2);
const positional: string[] = [];
let doDownload = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--dl") doDownload = true;
  else positional.push(argv[i]);
}
const query = positional[0];
const seasonNum = parseInt(positional[1], 10) || 1;
const epNum = parseInt(positional[2], 10) || 1;
if (!query) {
  console.error('usage: npx tsx scripts/franime-probe.ts "<query>" [season] [episode] [--dl]');
  process.exit(2);
}

// minimal .env loader (FLARESOLVERR_URL)
try {
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined)
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {}

const trunc = (s: string, n = 110): string =>
  s && s.length > n ? s.slice(0, n) + "..." : s || "(empty)";
const hr = (t: string) => console.log(`\n===== [${t}] =====`);

async function main() {
  const { franimeSearch, franimeSeasons, franimeSeasonInfo, franimeEpisodePlayers } =
    await import("../src/bot/services/franimeClient.js");
  const { extractMultiHostStream, hostPriority } =
    await import("../src/bot/services/animeStreamExtractor.js");

  console.log(
    `franime probe | query="${query}" s${seasonNum} ep${epNum} | solver=${process.env.FLARESOLVERR_URL || "none"}`,
  );

  hr("1/4 CATALOG + SEARCH");
  const results = await franimeSearch(query, 6);
  if (results.length === 0) {
    console.log("[KO] no match in the franime catalog");
    process.exit(1);
  }
  results.forEach((r, i) => console.log(`  ${i + 1}. ${trunc(r.title, 60)}  ->  ${r.url}`));
  const chosen = results[0];

  hr("2/4 SEASON");
  const seasons = await franimeSeasons(chosen.id);
  console.log(seasons.map((s) => s.name).join(" | ") || "(none)");
  const season = seasons[seasonNum - 1] || seasons[0];
  if (!season) {
    console.log("[KO] no season");
    process.exit(1);
  }
  const ref = season.url; // franime:<id>/<idx>
  const seasonIndex = Number(ref.split("/")[1]);
  const animeId = Number(ref.split(":")[1].split("/")[0]);

  hr("3/4 EPISODE LECTEURS");
  const info = await franimeSeasonInfo(animeId, seasonIndex);
  if (!info) {
    console.log("[KO] no season info");
    process.exit(1);
  }
  const ep = info.episodes[epNum - 1];
  if (!ep) {
    console.log(`[KO] episode ${epNum} out of range (${info.episodes.length} eps)`);
    process.exit(1);
  }
  console.log(`season: ${info.name} | ${info.episodes.length} episodes`);
  console.log(`ep${epNum} VF lecteurs: ${ep.lecteursVf.join(", ") || "(none)"}`);
  console.log(`ep${epNum} VO lecteurs: ${ep.lecteursVo.join(", ") || "(none)"}`);
  const vfCount = info.episodes.filter((e) => e.lecteursVf.length > 0).length;
  console.log(`VF coverage: ${vfCount}/${info.episodes.length} episodes`);

  hr("4/4 PLAYER URLS (VF)");
  const t0 = Date.now();
  const { players, challenged } = await franimeEpisodePlayers(
    animeId,
    seasonIndex,
    epNum - 1,
    "vf",
  );
  console.log(
    `resolved ${players.length} player(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s${challenged ? "  [CF-CHALLENGED]" : ""}`,
  );
  if (players.length === 0) {
    console.log(
      challenged
        ? "[KO] Cloudflare blocked the episode endpoint and no solver passed.\n     Fix: docker run -d --name flaresolverr -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest\n          + FLARESOLVERR_URL=http://localhost:8191/v1 in .env, then restart the bot."
        : "[KO] no VF player URLs returned",
    );
    process.exit(1);
  }
  for (const p of players) {
    let line = `  [${p.host}] ${trunc(p.url)}`;
    try {
      const ex = await extractMultiHostStream(p.url);
      if (ex && ex.url) {
        const tracks = (ex.availableTracks || []).map((t: any) => t.resolution).join(",");
        line += `\n      -> OK ${ex.type} ${tracks ? "tracks=" + tracks : ""}`;
      } else {
        line += `\n      -> extraction failed`;
      }
    } catch (err: any) {
      line += `\n      -> extraction threw: ${err.message}`;
    }
    console.log(line);
  }

  if (doDownload) {
    hr("DOWNLOAD TEST (first extractable player)");
    const { downloadWithAllMirrorsFallback } =
      await import("../src/bot/services/animeStreamExtractor.js");
    const sorted = [...players.map((p) => p.url)].sort((a, b) => hostPriority(a) - hostPriority(b));
    const out = path.join(os.tmpdir(), `franime_probe_${Date.now()}.mp4`);
    const t1 = Date.now();
    const r = await downloadWithAllMirrorsFallback(sorted, "480P", out, 240000);
    const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
    if (r.success && size > 1000) {
      console.log(
        `[OK] ${(size / 1048576).toFixed(2)} MB via ${r.hostName} in ${((Date.now() - t1) / 1000).toFixed(1)}s -> ${out}`,
      );
    } else {
      console.log(`[KO] download failed (success=${r.success} size=${size})`);
      process.exitCode = 1;
    }
  }

  console.log(
    `\n===== RESULT: ${process.exitCode === 0 ? "FRANIME VF PATH USABLE" : "SEE [KO] ABOVE"} =====`,
  );
}

main().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
