/**
 * ============================================================================
 *  VoirAnime probe — one-shot VF-path diagnostic (audit 8.9)
 * ============================================================================
 *      npx tsx scripts/voiranime-probe.ts "sparks of tomorrow" 1 9 [--dl]
 *
 *  Steps: search -> VF entries -> season resolve -> episode list -> player
 *  embed (voembed.net) -> stream extraction -> optional real download.
 */

import fs from "fs";
import path from "path";
import os from "os";

const argv = process.argv.slice(2);
const positional: string[] = [];
let doDownload = false;
for (const a of argv) {
  if (a === "--dl") doDownload = true;
  else positional.push(a);
}
const query = positional[0];
const seasonNum = parseInt(positional[1], 10) || 1;
const epNum = parseInt(positional[2], 10) || 1;
if (!query) {
  console.error('usage: npx tsx scripts/voiranime-probe.ts "<query>" [season] [episode] [--dl]');
  process.exit(2);
}
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

process.exitCode = 0;
const trunc = (s: string, n = 110): string =>
  s && s.length > n ? s.slice(0, n) + "..." : s || "(empty)";
const hr = (t: string) => console.log(`\n===== [${t}] =====`);

async function main() {
  const { voiranimeSearch, voiranimeEpisodes, voiranimeEpisodePlayer, resolveVoiranimeSeason } =
    await import("../src/bot/services/voiranimeClient.js");
  const { extractMultiHostStream, hostPriority, downloadWithAllMirrorsFallback } =
    await import("../src/bot/services/animeStreamExtractor.js");

  console.log(`voiranime probe | query="${query}" s${seasonNum} ep${epNum}`);

  hr("1/4 SEARCH");
  const results = await voiranimeSearch(query);
  if (results.length === 0) {
    console.log("[KO] 0 results (site blocked? wrong domain?)");
    process.exit(1);
  }
  results
    .slice(0, 8)
    .forEach((r, i) =>
      console.log(`  ${i + 1}. ${r.isVf ? "[VF] " : "    "}${trunc(r.title, 60)}`),
    );
  const vfEntries = results.filter((r) => r.isVf);
  if (vfEntries.length === 0) {
    console.log("[KO] no VF entry for this title");
    process.exit(1);
  }

  hr("2/4 SEASON RESOLVE");
  const season = resolveVoiranimeSeason(vfEntries, seasonNum);
  if (!season) {
    console.log(
      `[KO] no VF entry matches s${seasonNum} (VF entries: ${vfEntries.map((e) => e.title).join(" | ")})`,
    );
    process.exit(1);
  }
  console.log(`s${seasonNum} -> ${season.title}  ${season.url}`);

  hr("3/4 EPISODES + PLAYER");
  const eps = (await voiranimeEpisodes(season.url)).filter((e) => e.n > 0);
  if (eps.length === 0) {
    console.log("[KO] no numbered episodes on this entry");
    process.exit(1);
  }
  console.log(`${eps.length} episodes (last: ${eps[eps.length - 1].n})`);
  const ep = eps[epNum - 1];
  if (!ep) {
    console.log(`[KO] ep${epNum} out of range`);
    process.exit(1);
  }
  console.log(`ep${epNum} -> ${trunc(ep.url)}`);
  const player = await voiranimeEpisodePlayer(ep.url);
  if (!player) {
    console.log("[KO] no player iframe found on the episode page");
    process.exit(1);
  }
  console.log(`player: ${trunc(player)}  (priority ${hostPriority(player)})`);

  hr("4/4 STREAM EXTRACTION");
  const ex = await extractMultiHostStream(player);
  if (!ex || !ex.url) {
    console.log("[KO] extraction failed (no known recipe matched the player page)");
    process.exit(1);
  }
  const tracks =
    (ex.availableTracks || []).map((t: any) => t.resolution).join(",") || "none-listed";
  console.log(
    `OK  host=${ex.hostName}  type=${ex.type}\n     url=${trunc(ex.url)}\n     tracks: ${tracks}`,
  );

  if (doDownload) {
    hr("DOWNLOAD TEST");
    const out = path.join(os.tmpdir(), `voiranime_probe_${Date.now()}.mp4`);
    const t1 = Date.now();
    const r = await downloadWithAllMirrorsFallback([player], "480P", out, 240000);
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
    `\n===== RESULT: ${process.exitCode === 0 ? "VOIRANIME VF PATH USABLE" : "SEE [KO] ABOVE"} =====`,
  );
}

main().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
