/**
 * Audit evidence repro — proves the concrete code defects with the repo's
 * REAL code paths (no network needed).
 *
 *   npx tsx scripts/anime-audit-repro.mjs
 *
 * Referenced by ANIME_DOWNLOAD_AUDIT.md (Appendix A).
 */
import fs from "fs";
import { fileURLToPath } from "url";

const repoFile = (rel) => fileURLToPath(new URL(rel, import.meta.url));
import { unpackDeanEdwards } from "../src/bot/services/animeStreamExtractor.js";
import { resolveRequestedSeason } from "../src/bot/utils/quickAnimeParser.js";

// DEFECT A — Packer unpacker rejects the canonical Dean Edwards output
const canonicalPacked = `<script>eval(function(p,a,c,k,e,d){e=function(c){return c.toString(36)};while(c--){if(k[c]){p=p.replace(new RegExp('\\b'+e(c)+'\\b','g'),k[c])}}return p}('0 1=\\'2://3.4/5.6\\';',7,7,'var|sources|https|cdn|host|stream|m3u8'.split('|'),0,{}))</script>`;
const reducedPacked = `<script>eval(function(p,a,c,k,e,d){while(c--)if(k[c])p=p.replace(new RegExp('\\\\b'+c.toString(a)+'\\\\b','g'),k[c]);return p}('0:\\'1://2.3/4.5\\'',6,6,'file|https|vidmoly|to|stream|m3u8'.split('|')))</script>`;
const UNPACKED = /https:\/\/(?:cdn\.host\/stream|vidmoly\.to\/stream)\.m3u8/; // present only if token substitution actually ran
const a = unpackDeanEdwards(canonicalPacked);
const b = unpackDeanEdwards(reducedPacked);
console.log(
  "[A] canonical packer (',0,{}' tail) -> unpacked:",
  UNPACKED.test(a) ? "yes" : "NO MATCH — BUG CONFIRMED",
);
console.log("[A] reduced packer (repo fixture form) -> works:", UNPACKED.test(b) ? "YES" : "no");
const relaxed =
  /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?return\s+p;?\}\((?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\.split\(['"]\|['"]\)(?:\s*,\s*[^)]*)?\)/i;
console.log(
  "[A] relaxed regex matches canonical:",
  relaxed.test(canonicalPacked),
  "| reduced:",
  relaxed.test(reducedPacked),
);

// DEFECT B — Sibnet protocol-relative URL construction (verbatim branch logic)
function sibnetNormalize(streamPath) {
  if (streamPath.startsWith("/")) {
    streamPath = "https://video.sibnet.ru" + streamPath;
  }
  return streamPath;
}
console.log(
  "[B] sibnet '//db8.…' ->",
  sibnetNormalize("//db8.video.sibnet.ru/file/abc.mp4"),
  " <-- broken",
);
console.log("[B] sibnet '/v/abc'   ->", sibnetNormalize("/v/abc.mp4"), " <-- ok");

// DEFECT C — resolveRequestedSeason maps a missing season to a Film
const seasons = [
  { name: "Saison 1", subPath: "saison1/vostfr", url: "u1" },
  { name: "Saison 2", subPath: "saison2/vostfr", url: "u2" },
  { name: "Film 1", subPath: "film1/vostfr", url: "u3" },
];
const r = resolveRequestedSeason(seasons, 3);
console.log(
  "[C] requested S3 of a 2-season show -> returns:",
  r.season?.name,
  "@ index",
  r.index,
  " <-- should be null",
);

// DEFECT D — downloadHlsAppLevel ignores its timeoutMs parameter
const hls = fs.readFileSync(repoFile("../src/bot/services/hlsDownloader.ts"), "utf8");
const fn = hls.slice(hls.indexOf("export async function downloadHlsAppLevel"));
console.log(
  "[D] 'timeoutMs' occurrences inside downloadHlsAppLevel:",
  (fn.match(/timeoutMs/g) || []).length,
  "(1 = parameter only, never enforced)",
);

// DEFECT E — urlSafety trusted-host DNS failure pins traffic to 1.1.1.1
const urlSafety = fs.readFileSync(repoFile("../src/bot/urlSafety.ts"), "utf8");
console.log("[E] 1.1.1.1 fallback present in urlSafety.ts:", urlSafety.includes('"1.1.1.1"'));

// DEFECT F — mirror coverage vs live episodes.js (2026-08-31 capture)
const liveHosts = [
  "lpayer.embed4me.com",
  "ansembed.net",
  "video.sibnet.ru",
  "uqload.is",
  "minochinos.com",
];
const dedicated = (h) =>
  [
    "sibnet.ru",
    "ansembed.net",
    "vidmoly.",
    "topembed.",
    "vmpx.",
    "sendvid.com",
    "smoothpre",
    "dramiyos",
  ].some((k) => h.includes(k));
console.log("[F] live hosts with a dedicated extractor:", liveHosts.filter(dedicated));
console.log(
  "[F] live hosts without (generic best-effort only):",
  liveHosts.filter((h) => !dedicated(h)),
);
