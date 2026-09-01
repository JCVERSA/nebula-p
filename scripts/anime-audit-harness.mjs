/**
 * Audit evidence harness — runs the repo's REAL parser code against the live
 * anime-sama episodes.js content captured on 2026-08-31, and shows which
 * mirror branch each URL hits in extractMultiHostStream's routing.
 *
 *   npx tsx scripts/anime-audit-harness.mjs
 *
 * Referenced by ANIME_DOWNLOAD_AUDIT.md (Appendix A).
 */
import {
  parseQuickDownloadParams,
  isExactAnimeMatch,
  resolveRequestedSeason,
} from "../src/bot/utils/quickAnimeParser.js";
import { unpackDeanEdwards } from "../src/bot/services/animeStreamExtractor.js";

const liveEpisodesJs = `
var eps1 = [
'https://lpayer.embed4me.com/#3maxc',
'https://lpayer.embed4me.com/#9s9og',
];
var eps2 = [
'https://ansembed.net/embed-8fgve1livt6b.html',
'https://ansembed.net/embed-slvp8y9n6kst.html',
];
var eps3 = [
'https://video.sibnet.ru/shell.php?videoid=6234425',
];
var eps4 = [
'https://uqload.is/embed-40wqdvmbjzuc.html',
];
var eps5 = [
'https://minochinos.com/embed/y11mm0nwzhj6',
];
//`;

// ---- 1. parseEpisodes regex (verbatim from novabox.ts) ----
const regex = /(?:var|\/\/var|\/\/\/var)\s+eps(\d+)\s*=\s*\[([\s\S]*?)\]\s*;/gi;
let match;
const episodeLists = {};
while ((match = regex.exec(liveEpisodesJs)) !== null) {
  const listId = parseInt(match[1]);
  const arrayStr = match[2];
  const urlRegex = /'([^']+)'|"([^"]+)"/g;
  let urlMatch;
  const urls = [];
  while ((urlMatch = urlRegex.exec(arrayStr)) !== null) urls.push(urlMatch[1] || urlMatch[2]);
  if (urls.length > 0) episodeLists[listId] = urls;
}
console.log("parseEpisodes lists:", JSON.stringify(episodeLists, null, 1));

// ---- 2. Mirror routing replication from extractMultiHostStream ----
function route(lowerUrl) {
  if (
    lowerUrl.includes("smoothpre") ||
    lowerUrl.includes("dramiyos") ||
    lowerUrl.includes("embed") ||
    lowerUrl.includes("player")
  )
    return "branch1-generic(embed/player): fetch page, grep m3u8/.txt";
  if (lowerUrl.includes("sibnet.ru")) return "branch2-sibnet: player.src regex";
  if (lowerUrl.includes("sendvid.com")) return "branch3-sendvid";
  if (
    lowerUrl.includes("vidmoly.") ||
    lowerUrl.includes("ansembed.") ||
    lowerUrl.includes("topembed.") ||
    lowerUrl.includes("vmpx.")
  )
    return "branch4-vidmoly/ansembed: sources:/file: m3u8";
  return "NO BRANCH (extractor returns null)";
}
for (const [list, urls] of Object.entries(episodeLists)) {
  for (const u of urls) console.log(`eps${list} ${u}  ->  ${route(u.toLowerCase())}`);
}

// ---- 3. Mirror priority sort replication ----
const priority = (url) => {
  const l = url.toLowerCase();
  if (l.includes("smoothpre")) return 1;
  if (l.includes("sibnet")) return 2;
  if (l.includes("sendvid")) return 3;
  if (l.includes("ansembed") || l.includes("vidmoly")) return 4;
  return 5;
};
const allMirrors = Object.values(episodeLists).flat();
console.log(
  "mirror try order:",
  [...allMirrors].sort((a, b) => priority(a) - priority(b)).map((u) => `${u} (p${priority(u)})`),
);

// ---- 4. quick parser sanity on documented commands ----
const cases = [
  ["jjk", "s3", "all", "r2"],
  ["jjk", "s3", "ep6", "r2"],
  ["jjk", "s3", "e1,2,3,5,7,8,9", "r2"],
  ["jjk", "s3", "2-9", "r2"],
  ["solo", "leveling", "s1", "all"],
  ["demon", "slayer", "s2", "ep4", "720p"],
  ["jjk", "s3", "6", "r1"],
];
for (const c of cases) {
  const p = parseQuickDownloadParams(c);
  console.log(
    `.a ${c.join(" ")} => query="${p.animeQuery}" canon="${p.canonicalQuery}" S=${p.seasonNumber} eps=${p.episodesSpec}(${p.episodesMode}) res=${p.resolutionChoice} quick=${p.isQuickCommand}`,
  );
}

// ---- 5. season resolution defect ----
const seasons = [
  { name: "Saison 1", subPath: "saison1/vostfr", url: "u1" },
  { name: "Saison 2", subPath: "saison2/vostfr", url: "u2" },
  { name: "Film 1", subPath: "film1/vostfr", url: "u3" },
];
console.log(
  "resolveRequestedSeason(3) on [S1,S2,Film 1]:",
  JSON.stringify(resolveRequestedSeason(seasons, 3)),
);

// ---- 6. exact-match sanity ----
const results = [
  { title: "Solo Leveling", subtitle: "Saison 2", url: "u1" },
  { title: "Solo Leveling: ReAwakening", subtitle: "Film", url: "u2" },
];
console.log("isExact('sl'):", JSON.stringify(isExactAnimeMatch("sl", results)));
console.log(
  "isExact('solo leveling'):",
  JSON.stringify(isExactAnimeMatch("solo leveling", results)),
);

// ---- 7. packer form check ----
const canonicalPacked = `<script>eval(function(p,a,c,k,e,d){e=function(c){return c.toString(36)};while(c--){if(k[c]){p=p.replace(new RegExp('\\b'+e(c)+'\\b','g'),k[c])}}return p}('0 1=\\'2://3.4/5.6\\';',7,7,'var|sources|https|cdn|host|stream|m3u8'.split('|'),0,{}))</script>`;
const reducedPacked = `<script>eval(function(p,a,c,k,e,d){while(c--)if(k[c])p=p.replace(new RegExp('\\\\b'+c.toString(a)+'\\\\b','g'),k[c]);return p}('0:\\'1://2.3/4.5\\'',6,6,'file|https|vidmoly|to|stream|m3u8'.split('|')))</script>`;
const UNPACKED = /https:\/\/(?:cdn\.host\/stream|vidmoly\.to\/stream)\.m3u8/;
console.log(
  "unpackDeanEdwards canonical(',0,{}'):",
  UNPACKED.test(unpackDeanEdwards(canonicalPacked)) ? "matched" : "NO MATCH (defect)",
);
console.log(
  "unpackDeanEdwards reduced(fixture form):",
  UNPACKED.test(unpackDeanEdwards(reducedPacked)) ? "matched" : "NO MATCH",
);
