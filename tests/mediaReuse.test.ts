import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  __resetMediaReuseForTests,
  animeReuseKey,
  lookupMediaReuse,
  normalizeTitleForReuse,
  pruneMediaReuse,
  purgeAllMediaReuse,
  storeMediaReuse,
  ytvReuseKey
} from "../src/bot/services/mediaReuseStore.js";
import { registerTempDownload, purgeTempRecords, listTempRecords } from "../src/bot/tempDownloadManager.js";

let dir: string;
let staging: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nebula_reuse_test_"));
  staging = fs.mkdtempSync(path.join(os.tmpdir(), "nebula_reuse_staging_"));
  process.env.NEBULA_REUSE_DIR = dir;
  delete process.env.NEBULA_REUSE_ENABLED;
  delete process.env.NEBULA_REUSE_TTL_HOURS;
  delete process.env.NEBULA_REUSE_MAX_MB;
  __resetMediaReuseForTests();
});

afterEach(() => {
  purgeAllMediaReuse();
  delete process.env.NEBULA_REUSE_DIR;
  delete process.env.NEBULA_REUSE_ENABLED;
  delete process.env.NEBULA_REUSE_TTL_HOURS;
  delete process.env.NEBULA_REUSE_MAX_MB;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
});

// Les sources vivent dans un STAGING hors du dossier du cache — comme en
// production (le balayage d'orphelins du cache ne doit jamais les voir).
function makeSource(name: string, bytes = 1024): string {
  const p = path.join(staging, "src_" + name);
  fs.writeFileSync(p, Buffer.alloc(bytes, 7));
  return p;
}

// ── Clés pures ──────────────────────────────────────────────────────────────
describe("9.15 — clés de réutilisation (pures)", () => {
  it("normalizeTitleForReuse : minuscules, sans accents, ponctuation → espaces", () => {
    expect(normalizeTitleForReuse("Kimetsu no Yaiba — L'aube")).toBe("kimetsu no yaiba l aube");
    expect(normalizeTitleForReuse("  SOLO   Leveling! ")).toBe("solo leveling");
    expect(normalizeTitleForReuse("Épîçüï")).toBe("epicui");
  });

  it("animeReuseKey : stable et sensible à chaque paramètre", () => {
    const base = animeReuseKey("Solo Leveling", 2, 4, "VF", "480P");
    expect(base).toBe("a|solo leveling|s2|e4|VF|480P");
    expect(animeReuseKey("solo leveling", "02", 4, "vf", "480p")).toBe(base); // normalisation (zéros initiaux)
    expect(animeReuseKey("Solo Leveling", 3, 4, "VF", "480P")).not.toBe(base); // saison
    expect(animeReuseKey("Solo Leveling", 2, 5, "VF", "480P")).not.toBe(base); // épisode
    expect(animeReuseKey("Solo Leveling", 2, 4, "VOSTFR", "480P")).not.toBe(base); // langue
    expect(animeReuseKey("Solo Leveling", 2, 4, "VF", "720P")).not.toBe(base); // résolution
  });

  it("ytvReuseKey : identifiant fiable requis, sous-titres dans la clé", () => {
    expect(ytvReuseKey("dQw4w9WgXcQ", "720")).toBe("y|dQw4w9WgXcQ|720|def|nosubs");
    expect(ytvReuseKey("dQw4w9WgXcQ", "720", "fr", { lang: "fr", auto: true })).toBe("y|dQw4w9WgXcQ|720|fr|subs-fr-auto");
    expect(ytvReuseKey("pas-un-id", "720")).toBe(""); // pas d'identité → pas de cache
  });
});

// ── Store : insertion, lookup, TTL, cap LRU, auto-guérison ─────────────────
describe("9.15 — mediaReuseStore (intégration disque)", () => {
  it("store → lookup : lien physique (zéro octet de plus), hit rafraîchi", () => {
    const src = makeSource("ep.mp4", 2048);
    const key = animeReuseKey("Solo Leveling", 2, 4, "VF", "480P");
    const stored = storeMediaReuse(key, src, "Solo_Leveling_VF_480P_S02_E04.mp4");
    expect(stored).not.toBeNull();
    // lien physique : même inode, deux noms
    expect(fs.statSync(src).ino).toBe(fs.statSync(stored!.filePath).ino);
    expect(fs.statSync(stored!.filePath).size).toBe(2048);

    const hit = lookupMediaReuse(key);
    expect(hit).not.toBeNull();
    expect(hit!.filename).toBe("Solo_Leveling_VF_480P_S02_E04.mp4");
    expect(hit!.bytes).toBe(2048);
    expect(fs.existsSync(hit!.filePath)).toBe(true);
  });

  it("lookup inconnu → null ; fichier supprimé → null + entrée auto-purgée", () => {
    expect(lookupMediaReuse("a|inconnu|s1|e1|VF|480P")).toBeNull();
    const src = makeSource("ep2.mp4", 512);
    const key = animeReuseKey("Test", 1, 1, "VF", "480P");
    const stored = storeMediaReuse(key, src, "t.mp4");
    fs.unlinkSync(stored!.filePath); // le fichier disparaît (purge système…)
    expect(lookupMediaReuse(key)).toBeNull(); // → chemin normal de re-téléchargement
    const r = pruneMediaReuse();
    expect(r.missing).toBe(1);
  });

  it("TTL glissant : expiré → null (fenêtre 24 h par défaut)", () => {
    const src = makeSource("ep3.mp4", 256);
    const key = animeReuseKey("TTL", 1, 1, "VF", "480P");
    const stored = storeMediaReuse(key, src, "ttl.mp4");
    // vieillissement artificiel de l'index
    const idx = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf-8"));
    idx[0].lastHitAt = Date.now() - 25 * 3600 * 1000;
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(idx));
    __resetMediaReuseForTests();
    expect(lookupMediaReuse(key)).toBeNull();
    expect(fs.existsSync(stored!.filePath)).toBe(false); // purgé par le prune
  });

  it("cap LRU : le plus anciennement utile est évincé, le récent survit", () => {
    process.env.NEBULA_REUSE_MAX_MB = "64"; // min du clamp
    const k1 = animeReuseKey("Vieux", 1, 1, "VF", "480P");
    const k2 = animeReuseKey("Recent", 1, 1, "VF", "480P");
    const s1 = makeSource("old.mp4", 40 * 1024 * 1024);
    const s2 = makeSource("new.mp4", 40 * 1024 * 1024);
    storeMediaReuse(k1, s1, "old.mp4");
    // s1 devient « vieux » : on vieillit son lastHitAt
    const idx = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf-8"));
    const e1 = idx.find((e: any) => e.key === k1);
    e1.lastHitAt = Date.now() - 3600 * 1000;
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(idx));
    __resetMediaReuseForTests();
    const stored2 = storeMediaReuse(k2, s2, "new.mp4"); // dépasse le cap → éviction LRU
    expect(stored2).not.toBeNull();
    expect(lookupMediaReuse(k2)).not.toBeNull(); // le récent survit
    expect(lookupMediaReuse(k1)).toBeNull(); // le vieux est évincé
  });

  it("un fichier servi par un lien vivant du coffre n'est JAMAIS évincé", () => {
    process.env.NEBULA_REUSE_MAX_MB = "64";
    const k1 = animeReuseKey("Vivant", 1, 1, "VF", "480P");
    const s1 = makeSource("live.mp4", 40 * 1024 * 1024);
    const stored1 = storeMediaReuse(k1, s1, "live.mp4");
    // un token noCopy sert ce fichier (lien vivant)
    const rec = registerTempDownload(stored1!.filePath, "live.mp4", { noCopy: true, ttlMinutes: 60 });
    expect(listTempRecords().some((r) => r.filePath === rec.filePath)).toBe(true);
    const k2 = animeReuseKey("Challenger", 1, 1, "VF", "480P");
    const s2 = makeSource("challenger.mp4", 40 * 1024 * 1024);
    const stored2 = storeMediaReuse(k2, s2, "challenger.mp4"); // dépasse le cap
    expect(stored2).not.toBeNull();
    // k1 est LRU mais PROTÉGÉ (lien vivant) → k2 (le récent, seul éligible) est évincé
    expect(lookupMediaReuse(k1)).not.toBeNull();
    expect(lookupMediaReuse(k2)).toBeNull();
    purgeTempRecords([rec.token]); // nettoyage (supprime le fichier, voulu ici)
  });

  it("noCopy : le token sert le fichier SANS copie (aucun fichier token_ créé)", () => {
    const src = makeSource("nocopy.mp4", 4096);
    const rec = registerTempDownload(src, "nocopy.mp4", { noCopy: true, ttlMinutes: 30 });
    // Preuve structurelle (aucun readdir du dossier partagé — les autres
    // fichiers de test y écrivent en parallèle) : le record pointe sur le
    // fichier source LUI-MÊME, résolu — rien n'a été copié ni déplacé.
    expect(rec.filePath).toBe(path.resolve(src));
    expect(rec.sizeBytes).toBe(4096);
    purgeTempRecords([rec.token]);
    expect(fs.existsSync(src)).toBe(false); // c'était bien le MÊME fichier (pas une copie)
  });

  it("NEBULA_REUSE_ENABLED=0 : store et lookup deviennent des no-ops", () => {
    process.env.NEBULA_REUSE_ENABLED = "0";
    const src = makeSource("off.mp4", 128);
    expect(storeMediaReuse(animeReuseKey("Off", 1, 1, "VF", "480P"), src, "off.mp4")).toBeNull();
    expect(lookupMediaReuse(animeReuseKey("Off", 1, 1, "VF", "480P"))).toBeNull();
  });
});

// ── Wiring ──────────────────────────────────────────────────────────────────
describe("9.15 — wiring", () => {
  it("novabox : lookup en tête de tâche épisode + insertion avant register + caption cache", () => {
    const src = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");
    expect(src).toContain("animeReuseKey");
    expect(src).toContain("const cachedEp = lookupMediaReuse(reuseKeyFor(epNum));");
    expect(src).toContain("storeMediaReuse(reuseKeyFor(epNum), localPath, filename);");
    expect(src).toContain("storeMediaReuse(reuseKeyFor(epNum), activeSendPath, deliveredFilename);");
    expect(src).toContain("const cachedSingle = lookupMediaReuse(reuseKeyFor(epNum));");
    expect(src).toContain("Déjà prêt — cache 24 h");
    expect(src).toContain("sans re-téléchargement");
  });

  it("ytvideo : lookup single + playlist, insertion, finally protégé (le cache n'est jamais supprimé)", () => {
    const src = fs.readFileSync("src/bot/commands/ytvideo.ts", "utf-8");
    expect(src).toContain("const reuseKey = ytvReuseKey(ytIdForReuse, quality, audioLang, subs);");
    expect(src).toContain("const rKey = ytvReuseKey(ids[i], quality, audioLang, null);");
    expect(src).toContain("storeMediaReuse(reuseKey, videoPath,");
    expect(src).toContain("storeMediaReuse(rKey, local.filePath,");
    expect(src).toContain("if (videoPath && !reusedHit) {");
  });

  it("privacy : .up n'entre JAMAIS dans le cache de réutilisation", () => {
    const src = fs.readFileSync("src/bot/commands/upload.ts", "utf-8");
    expect(src).not.toContain("mediaReuseStore");
  });

  it("purge owner : vide aussi le cache de réutilisation", () => {
    const src = fs.readFileSync("src/bot/commands/purge.ts", "utf-8");
    expect(src).toContain("purgeAllMediaReuse()");
  });

  it("coffre : l'option noCopy existe et saute le quota d'octets (cap dédié ailleurs)", () => {
    const src = fs.readFileSync("src/bot/tempDownloadManager.ts", "utf-8");
    expect(src).toContain("noCopy?: boolean;");
    expect(src).toContain("!options?.noCopy && currentTotal + sizeBytes > getTempMaxTotalBytes()");
  });
});
