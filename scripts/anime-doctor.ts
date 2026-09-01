/**
 * ============================================================================
 *  NEBULA - Anime Download Doctor (Novabox pipeline diagnostic)
 * ============================================================================
 *  Run ON THE SERVER where the bot lives:
 *
 *      npx tsx scripts/anime-doctor.ts            # safe checks (~60s max)
 *      npx tsx scripts/anime-doctor.ts --full     # + real 2-segment download
 *
 *  Egress proxy (Cloudflare-blocked VPS? see ANIME_DOWNLOAD_AUDIT.md R3):
 *
 *      npx tsx scripts/anime-doctor.ts --proxy http://user:pass@host:port
 *      NEBULA_ANIME_PROXY=http://host:port npx tsx scripts/anime-doctor.ts
 *
 *  It walks the exact stages the `.a` / `.anime` command executes, using the
 *  repo's real code where possible, and prints a PASS/FAIL table with the
 *  most likely remediation for each failure. Exit code 1 if any P0 stage
 *  fails.
 *
 *  Stages
 *   0. Runtime environment (node, ffmpeg binary, APP_URL, proxy)
 *   1. anime-sama reachability (DNS, TLS, Cloudflare challenge)
 *   2. Search endpoint  POST /template-php/defaut/fetch.php   (P0)
 *   3. Catalog page     panneauAnime(...) season parsing       (P0)
 *   4. episodes.js      var epsN = [...] parsing               (P0)
 *   5. Mirror players   extractMultiHostStream() per mirror    (P1)
 *   6. HLS manifest     master playlist + quality tracks       (P1)
 *   7. Segment download + ffmpeg remux (only with --full)      (P1)
 *
 *  NOTE: stages 2-4 replicate the private regexes of
 *  src/bot/commands/novabox.ts verbatim - keep them in sync.
 * ============================================================================
 */

import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import dns from "dns/promises";
import axios from "axios";
import * as cheerio from "cheerio";
import { isSafeDownloadUrl } from "../src/bot/urlSafety.js";
import {
  parseProxyUrl,
  animeProxyOptions,
  describeAnimeProxy,
  ANIME_PROXY_ENV,
} from "../src/bot/services/scrapingProxy.js";
import {
  extractMultiHostStream,
  fetchHlsTracksAndSizes,
  pickOptimalStream,
} from "../src/bot/services/animeStreamExtractor.js";

const FULL = process.argv.includes("--full");
const PROXY_ARG = (() => {
  const i = process.argv.indexOf("--proxy");
  return i !== -1 ? process.argv[i + 1] : undefined;
})();
// --proxy must also reach the repo's real code paths (stages 5-7), which read
// the env var themselves via animeProxyOptions().
if (PROXY_ARG) process.env[ANIME_PROXY_ENV] = PROXY_ARG;
const PROXY_PARSED = parseProxyUrl(PROXY_ARG ?? process.env[ANIME_PROXY_ENV]);
const PROXY_OPTS = animeProxyOptions(PROXY_ARG ?? process.env[ANIME_PROXY_ENV]);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// The site rotates TLDs under legal pressure (.fr->.org->.eu->.tv->.si->.to...).
// Probe a list and use the first that answers.
const CANDIDATE_DOMAINS = (process.env.NEBULA_ANIME_DOMAIN || "")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean)
  .concat(["anime-sama.to", "anime-sama.tv", "anime-sama.si", "anime-sama.eu"]);

interface Row {
  stage: string;
  name: string;
  status: "PASS" | "FAIL" | "WARN" | "SKIP";
  detail: string;
  hint?: string;
  p0?: boolean;
}

const rows: Row[] = [];
function row(
  stage: string,
  name: string,
  status: Row["status"],
  detail: string,
  hint?: string,
  p0 = false,
) {
  rows.push({ stage, name, status, detail, hint, p0 });
}

function hr() {
  console.log("-".repeat(78));
}

/** Cloudflare / WAF detection shared by all stages. */
function looksLikeCloudflare(status: number, body: string): boolean {
  return (
    status === 403 ||
    status === 503 ||
    body.includes("Just a moment") ||
    body.includes("cf_chl_opt") ||
    (body.includes("cloudflare") && body.includes("captcha")) ||
    body.includes("Attention Required")
  );
}

function cloudflareHint(): string {
  return (
    "Cloudflare/WAF is blocking this server's requests (HTTP 403). This VPS IP range is flagged - " +
    "no parser fix can help until egress changes. Options: (1) route the anime pipeline through a " +
    `proxy: set ${ANIME_PROXY_ENV}=http://user:pass@host:port in .env (supported by the bot AND this doctor ` +
    "via --proxy), e.g. a residential/mobile proxy or one in a non-blocked region; (2) host the bot " +
    "(or just a tiny HTTP forward proxy) on a network that is not blocked - verify with: " +
    "curl -sI -A 'Mozilla/5.0' https://anime-sama.to | head -3"
  );
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(t!);
  }
}

// ------------------------------ Stage 0: environment ------------------------------
hr();
console.log("STAGE 0 - Runtime environment");
hr();

console.log(`node            : ${process.version}`);
console.log(
  `proxy           : ${PROXY_PARSED ? describeAnimeProxy(PROXY_ARG ?? process.env[ANIME_PROXY_ENV]) : "none (direct egress)"}`,
);
let ffmpegOk = false;
let ffmpegDetail = "system `ffmpeg` on PATH";
try {
  execSync("ffmpeg -version", { stdio: "ignore" });
  ffmpegOk = true;
} catch {
  const p = process.env.FFMPEG_BIN || "";
  if (p && fs.existsSync(p)) {
    ffmpegOk = true;
    ffmpegDetail = `FFMPEG_BIN=${p}`;
  } else {
    ffmpegDetail = `NOT FOUND (system PATH empty; FFMPEG_BIN ${p ? `set to ${p} but missing` : "unset"})`;
  }
}
row(
  "0",
  "ffmpeg available",
  ffmpegOk ? "PASS" : "FAIL",
  ffmpegDetail,
  ffmpegOk
    ? undefined
    : "Every HLS download ends in an ffmpeg remux. Without the binary ALL downloads fail while search still works. " +
        "Install ffmpeg (apt/yum/brew) or point FFMPEG_BIN to an existing binary.",
  true,
);

const appUrl = process.env.APP_URL || process.env.PUBLIC_URL || "";
row(
  "0",
  "APP_URL configured",
  appUrl ? "PASS" : "WARN",
  appUrl || "not set",
  appUrl
    ? undefined
    : "Batch/oversize downloads are delivered as links built from APP_URL. Without it (and if the panel was never " +
        "opened from a public host) links are relative like '/api/media/download/<token>' - unusable in WhatsApp.",
);

// ---------------------------- Stage 1: upstream reachability ----------------------------
hr();
console.log("STAGE 1 - anime-sama reachability");
hr();

let domain = "";
for (const d of CANDIDATE_DOMAINS) {
  try {
    const ip = await withTimeout(dns.lookup(d, { all: true }), 5000, "dns");
    row("1", `DNS ${d}`, "PASS", ip.map((a) => a.address).join(", "));
  } catch (e: any) {
    row("1", `DNS ${d}`, "FAIL", e.message);
    continue;
  }
  try {
    const res = await withTimeout(
      axios.get(`https://${d}/`, {
        headers: { "User-Agent": UA },
        timeout: 10000,
        validateStatus: () => true,
        ...PROXY_OPTS,
      }),
      15000,
      "http",
    );
    const body = typeof res.data === "string" ? res.data : "";
    if (looksLikeCloudflare(res.status, body)) {
      row(
        "1",
        `HTTPS ${d}`,
        "FAIL",
        `HTTP ${res.status} - Cloudflare/WAF block page detected`,
        cloudflareHint(),
        true,
      );
    } else {
      row(
        "1",
        `HTTPS ${d}`,
        res.status === 200 ? "PASS" : "WARN",
        `HTTP ${res.status}, ${body.length} bytes`,
      );
      if (res.status === 200 && !domain) domain = d;
    }
  } catch (e: any) {
    row(
      "1",
      `HTTPS ${d}`,
      "FAIL",
      e.message,
      "If DNS resolves but TLS/HTTP fails from this server, your host's network is blocked (Arcom/ISP block in FR, " +
        "datacenter IP filtering, or egress firewall). Route via a proxy or host the bot outside the blocked region.",
      true,
    );
  }
  if (domain) break;
}
if (!domain) {
  domain = CANDIDATE_DOMAINS[0];
  row(
    "1",
    "usable domain",
    "FAIL",
    `none of [${CANDIDATE_DOMAINS.join(", ")}] answered`,
    cloudflareHint(),
    true,
  );
} else {
  console.log(`-> using https://${domain} for the following stages`);
}

// nakanime.tv mirror — the bot's AUTOMATIC fallback source when anime-sama is
// blocked. If this answers 200, the anime command works end-to-end even with
// every anime-sama domain 403 above.
try {
  const res = await withTimeout(
    axios.get("https://nakanime.tv/", {
      headers: { "User-Agent": UA },
      timeout: 8000,
      validateStatus: () => true,
      ...PROXY_OPTS,
    }),
    12000,
    "nakanime",
  );
  row(
    "1",
    "nakanime.tv (auto-fallback source)",
    res.status === 200 ? "PASS" : "WARN",
    `HTTP ${res.status}`,
    res.status === 200
      ? "Mirror reachable — the bot falls back to it AUTOMATICALLY when anime-sama is blocked, so the anime command works from this host."
      : "Mirror not fully reachable — the anime command depends on the anime-sama domains above.",
  );
} catch (e: any) {
  row(
    "1",
    "nakanime.tv (auto-fallback source)",
    "FAIL",
    e.message,
    "Fallback mirror unreachable too — the anime command cannot fetch catalog data from this host.",
  );
}

// franime.fr — VF-only source (explicit `.a ... vf`). PARKED behind
// NEBULA_FRANIME_ENABLED=1; only probed when explicitly enabled.
if (process.env.NEBULA_FRANIME_ENABLED === "1")
  try {
    const res = await withTimeout(
      axios.get("https://api.franime.fr/api/animes/", {
        headers: { "User-Agent": UA, Referer: "https://franime.fr/" },
        timeout: 12000,
        validateStatus: () => true,
        ...PROXY_OPTS,
      }),
      16000,
      "franime",
    );
    const bytes = Number(res.headers?.["content-length"] || 0);
    row(
      "1",
      "franime.fr catalog (VF source)",
      res.status === 200 ? "PASS" : "WARN",
      `HTTP ${res.status}${bytes ? ` (${(bytes / 1048576).toFixed(1)} MB)` : ""}`,
      res.status === 200
        ? "VF path available (`.a <q> vf ...`). Player URLs need FLARESOLVERR_URL (docker run -d -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest)."
        : "VF source unreachable from this host — `.a vf` will fall back to nakanime.",
    );
  } catch (e: any) {
    row(
      "1",
      "franime.fr catalog (VF source)",
      "WARN",
      e.message,
      "VF source unreachable — `.a vf` falls back to nakanime.",
    );
  }

// voir-anime.to — VF-by-structure source (explicit `.a ... vf`). HTML pages
// verified reachable from datacenter IPs; VF entries carry the "-vf" slug
// suffix. Players are hosted on voembed.net (generic packed-player probe).
try {
  const res = await withTimeout(
    axios.get("https://voir-anime.to/", {
      headers: { "User-Agent": UA, Referer: "https://voir-anime.to/" },
      timeout: 8000,
      validateStatus: () => true,
      ...PROXY_OPTS,
    }),
    12000,
    "voiranime",
  );
  row(
    "1",
    "voir-anime.to (VF source)",
    res.status === 200 ? "PASS" : "WARN",
    `HTTP ${res.status}`,
    res.status === 200
      ? "VF path available (`.a <q> ... vf ...`) — French dub guaranteed by the -vf entry structure."
      : "VF source unreachable from this host — `.a vf` falls back to nakanime VF lists.",
  );
} catch (e: any) {
  row(
    "1",
    "voir-anime.to (VF source)",
    "WARN",
    e.message,
    "VF source unreachable — `.a vf` falls back to nakanime.",
  );
}

// ---------------------------- Stage 2: search endpoint (P0) ----------------------------
hr();
console.log("STAGE 2 - search endpoint (what `.a <name>` uses first)");
hr();

const TEST_QUERY = process.env.DOCTOR_QUERY || "solo leveling";
let searchFirstUrl = "";
try {
  const params = new URLSearchParams();
  params.append("query", TEST_QUERY);
  const res = await withTimeout(
    axios.post(`https://${domain}/template-php/defaut/fetch.php`, params, {
      headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000,
      validateStatus: () => true,
      ...PROXY_OPTS,
    }),
    15000,
    "search",
  );
  const html = typeof res.data === "string" ? res.data : "";
  const $ = cheerio.load(html);
  const results: Array<{ title: string; url: string }> = [];
  $(".asn-search-result").each((_, el) => {
    const href = $(el).attr("href") || "";
    const title = $(el).find(".asn-search-result-title").text().trim();
    if (href) results.push({ title, url: href });
  });
  if (res.status === 200 && results.length > 0) {
    row(
      "2",
      "fetch.php search",
      "PASS",
      `HTTP 200, ${results.length} results, first: "${results[0].title}"`,
    );
    searchFirstUrl = results[0].url;
  } else if (looksLikeCloudflare(res.status, html)) {
    row(
      "2",
      "fetch.php search",
      "FAIL",
      `HTTP ${res.status} - Cloudflare/WAF block page`,
      cloudflareHint(),
      true,
    );
  } else {
    row(
      "2",
      "fetch.php search",
      "FAIL",
      `HTTP ${res.status}, ${html.length} bytes, ${results.length} parsed results`,
      "Endpoint reachable but markup parse failed -> the site's search HTML changed; update searchAnime() selectors " +
        "in src/bot/commands/novabox.ts.",
      true,
    );
  }
} catch (e: any) {
  row(
    "2",
    "fetch.php search",
    "FAIL",
    e.message,
    "Search is the first network call the command makes - if this fails, EVERYTHING downstream fails with " +
      "'Aucun resultat trouve'. Check stage 1 remediation.",
    true,
  );
}

// ---------------------------- Stage 3: catalog seasons (P0) ----------------------------
hr();
console.log("STAGE 3 - catalog page season parsing (panneauAnime)");
hr();

const catalogUrl = searchFirstUrl || `https://${domain}/catalogue/solo-leveling/`;
let seasonSubPath = "saison1/vostfr";
try {
  const res = await withTimeout(
    axios.get(catalogUrl, {
      headers: { "User-Agent": UA },
      timeout: 10000,
      validateStatus: () => true,
      ...PROXY_OPTS,
    }),
    15000,
    "catalog",
  );
  const html = typeof res.data === "string" ? res.data : "";
  if (looksLikeCloudflare(res.status, html)) {
    row(
      "3",
      `catalog page (${catalogUrl})`,
      "FAIL",
      `HTTP ${res.status} - Cloudflare/WAF block page`,
      cloudflareHint(),
      true,
    );
  } else {
    const regex = /panneauAnime\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;
    const seasons: Array<{ name: string; subPath: string }> = [];
    let m;
    while ((m = regex.exec(html)) !== null) {
      if (m[1].toLowerCase() === "nom" || m[2].toLowerCase() === "url") continue;
      seasons.push({ name: m[1], subPath: m[2] });
    }
    row(
      "3",
      `panneauAnime parse (${catalogUrl})`,
      seasons.length ? "PASS" : "FAIL",
      seasons.length
        ? `${seasons.length} seasons: ${seasons
            .slice(0, 6)
            .map((s) => s.name)
            .join(", ")}...`
        : `HTTP ${res.status}, 0 seasons parsed`,
      seasons.length
        ? undefined
        : "Search works but the catalog page markup changed (or the result URL points at a dead domain - check the " +
            "absolute URL inside fetch.php results). Update parseSeasons() in novabox.ts.",
      true,
    );
    seasonSubPath =
      seasons.find((s) => /saison\s*1/i.test(s.name))?.subPath ||
      seasons[0]?.subPath ||
      seasonSubPath;
  }
} catch (e: any) {
  row("3", "catalog page", "FAIL", e.message, undefined, true);
}

// ---------------------------- Stage 4: episodes.js (P0) ----------------------------
hr();
console.log("STAGE 4 - episodes.js parsing");
hr();

const epsUrl = `${catalogUrl.replace(/\/$/, "")}/${seasonSubPath.replace(/^\//, "")}/episodes.js`;
try {
  const res = await withTimeout(
    axios.get(epsUrl, {
      headers: { "User-Agent": UA },
      timeout: 10000,
      validateStatus: () => true,
      ...PROXY_OPTS,
    }),
    15000,
    "episodes",
  );
  const js = typeof res.data === "string" ? res.data : "";
  const regex = /(?:var|\/\/var|\/\/\/var)\s+eps(\d+)\s*=\s*\[([\s\S]*?)\]\s*;/gi;
  const lists: Record<number, string[]> = {};
  let m;
  while ((m = regex.exec(js)) !== null) {
    const urls: string[] = [];
    const urlRegex = /'([^']+)'|"([^"]+)"/g;
    let um;
    while ((um = urlRegex.exec(m[2])) !== null) urls.push(um[1] || um[2]);
    if (urls.length) lists[parseInt(m[1])] = urls;
  }
  const total = Math.max(0, ...Object.values(lists).map((a) => a.length));
  if (looksLikeCloudflare(res.status, js)) {
    row(
      "4",
      "epsN arrays",
      "FAIL",
      `HTTP ${res.status} - Cloudflare/WAF block page`,
      cloudflareHint(),
      true,
    );
  } else {
    row(
      "4",
      "epsN arrays",
      Object.keys(lists).length ? "PASS" : "FAIL",
      Object.keys(lists).length
        ? `lists ${Object.keys(lists).join(",")} - max ${total} episodes`
        : `HTTP ${res.status}, 0 lists parsed from ${epsUrl}`,
      Object.keys(lists).length
        ? undefined
        : "Season page works but episodes.js format changed. Update parseEpisodes() in novabox.ts.",
      true,
    );
  }

  // ---------------------------- Stage 5: mirror players (P1) ----------------------------
  hr();
  console.log("STAGE 5 - player mirror extraction (first episode)");
  hr();

  const mirrors: string[] = [];
  for (const k of Object.keys(lists).map(Number)) {
    const u = lists[k]?.[0];
    if (u && !mirrors.includes(u)) mirrors.push(u);
  }

  let anyStream: Awaited<ReturnType<typeof extractMultiHostStream>> = null;
  for (const mirror of mirrors) {
    let host: string;
    try {
      host = new URL(mirror).host;
    } catch {
      host = mirror;
    }
    const safe = await isSafeDownloadUrl(mirror).catch(() => false);
    if (!safe) {
      row(
        "5",
        host,
        "FAIL",
        `${mirror} - blocked by urlSafety (SSRF guard)`,
        "Host resolves to a private/unresolvable address or scheme is not http(s).",
      );
      continue;
    }
    try {
      const extracted = await withTimeout(extractMultiHostStream(mirror), 25000, "extract");
      if (extracted && extracted.url) {
        row(
          "5",
          host,
          "PASS",
          `${extracted.hostName} ${extracted.type} - ${extracted.url.slice(0, 70)}...`,
        );
        if (!anyStream) anyStream = extracted;
      } else {
        row(
          "5",
          host,
          "FAIL",
          `${mirror} - no stream extracted`,
          "Player page layout changed or the video needs a dedicated extractor. " +
            "Known gaps in this bot: lpayer.embed4me.com (needs /api/v1/video + AES-128 key 'kiemtienmua911ca'/" +
            "IV '1234567890oiuytr'), uqload.is, minochinos.com, voe/filemoon/luluvdo/vidzy. " +
            "See ANIME_DOWNLOAD_AUDIT.md section R1/R3.",
        );
      }
    } catch (e: any) {
      row("5", host, "FAIL", `${mirror} - ${e.message}`);
    }
  }
  if (mirrors.length === 0) row("5", "mirrors", "SKIP", "no mirrors found in stage 4");

  // ---------------------------- Stage 6: HLS manifest (P1) ----------------------------
  hr();
  console.log("STAGE 6 - HLS manifest + quality tracks");
  hr();

  if (anyStream) {
    try {
      const tracks = await withTimeout(
        fetchHlsTracksAndSizes(anyStream.url, anyStream.headers.Referer || "", undefined),
        20000,
        "hls",
      );
      const pick = pickOptimalStream(tracks);
      row(
        "6",
        "master playlist",
        tracks.length && tracks[0].url ? "PASS" : "WARN",
        `${tracks.length} tracks [${tracks.map((t) => t.resolution).join(", ")}]; would pick ${pick.resolution}`,
        tracks.length && tracks[0].url
          ? undefined
          : "Manifest unreachable -> the 4 offered qualities are FABRICATED fallbacks pointing at the master URL; " +
              "downloads will fail or serve the wrong quality. Check Referer/Origin headers for this CDN.",
      );
    } catch (e: any) {
      row("6", "master playlist", "FAIL", e.message);
    }
  } else {
    row("6", "master playlist", "SKIP", "no stream extracted in stage 5");
  }

  // -------------------------- Stage 7: real download probe (--full) --------------------------
  hr();
  if (FULL) {
    console.log("STAGE 7 - end-to-end download probe (--full)");
    hr();
    const { downloadHlsAppLevel } = await import("../src/bot/services/hlsDownloader.js");
    if (anyStream) {
      const out = path.join(os.tmpdir(), `doctor_${Date.now()}.mp4`);
      try {
        const ok = await withTimeout(
          downloadHlsAppLevel(anyStream.url, out, anyStream.headers, 90000),
          120000,
          "download",
        );
        const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
        row(
          "7",
          "HLS download + remux",
          ok && size > 1000 ? "PASS" : "FAIL",
          ok ? `${(size / 1048576).toFixed(1)} MB written to ${out}` : `ok=${ok}, size=${size}`,
          ok && size > 1000
            ? undefined
            : "Segments fetch but the remux fails -> check stage 0 (ffmpeg). If stage 6 tracks were fabricated, " +
                "the master URL itself may be 403 for this server.",
        );
      } catch (e: any) {
        row("7", "HLS download + remux", "FAIL", e.message);
      }
    } else {
      row("7", "HLS download + remux", "SKIP", "no stream to download");
    }
  } else {
    console.log("STAGE 7 - skipped (re-run with --full for a real 90s download probe)");
  }
} catch (e: any) {
  row("4", "episodes.js", "FAIL", e.message, undefined, true);
}

// ------------------------------ Report ------------------------------
hr();
console.log("RESULTS");
hr();
const icon: Record<Row["status"], string> = {
  PASS: "[PASS]",
  FAIL: "[FAIL]",
  WARN: "[WARN]",
  SKIP: "[SKIP]",
};
for (const r of rows) {
  console.log(`${icon[r.status]} [${r.stage}]${r.p0 ? " (P0)" : "      "} ${r.name}`);
  console.log(`        ${r.detail}`);
  if (r.hint) console.log(`        -> ${r.hint}`);
}
hr();
const p0Fails = rows.filter((r) => r.p0 && r.status === "FAIL");
const p1Fails = rows.filter((r) => !r.p0 && r.status === "FAIL");
console.log(
  `Summary: ${rows.filter((r) => r.status === "PASS").length} pass, ${rows.filter((r) => r.status === "WARN").length} warn, ${p0Fails.length + p1Fails.length} fail, ${rows.filter((r) => r.status === "SKIP").length} skip`,
);
if (p0Fails.length) {
  console.log(
    "\nDiagnosis: a P0 stage failed - the command cannot work at all until this is fixed.",
  );
} else if (p1Fails.length) {
  console.log(
    "\nDiagnosis: discovery works but media extraction is broken - expect 'download temporarily\nunavailable' or link-only replies. Fix the stage 5/6 failures (see ANIME_DOWNLOAD_AUDIT.md).",
  );
} else {
  console.log(
    "\nDiagnosis: the full chain works from this server. If WhatsApp delivery still fails, check the\nbot logs around [NOVABOX]/[MIRROR_FALLBACK] and the WhatsApp 100MB/2GB attachment limits.",
  );
}
process.exit(p0Fails.length ? 1 : 0);
