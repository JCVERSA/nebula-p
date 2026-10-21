/**
 * videoSlim (9.7) — amincissement vidéo « même résolution ».
 *
 * Décisions owner 17/10 (retour terrain « sable/CRT » sur un 1080p écrasé
 * à 976 kbps) :
 *  - déclencheur : NEBULA_SLIM_MAX_MB (défaut 250 Mo) — en dessous on ne
 *    touche à rien ;
 *  - PLUS de cible de taille fixe : CRF 22 constant (« très bonne »
 *    qualité, recherche 17/10 : anime 1080p H.264 = 1500-2500 kbps minimum,
 *    transparent ≈ CRF 18-23) plafonné par VBV à 75 % du débit SOURCE —
 *    la sortie fait typiquement 45-75 % de l'entrée, résolution intacte ;
 *  - garde qualité : si 75 % du débit source descend sous le plancher de la
 *    résolution (1080p 2000 / 720p 1100 / 480p 650 kbps), le fichier est
 *    livré TEL QUEL — ré-encoder ne pourrait qu'abîmer ;
 *  - vitesse (priorité owner) : preset superfast + 2 threads encodeur ;
 *    bornes mémoire x264 conservées (9.18aaa : ≤267 Mo mesurés — c'est
 *    elles qui ont fait survivre l'encodage terrain), nice 10, préflight ;
 *  - patience (décision owner) : un message d'attente avec ETA selon la
 *    taille part AVANT l'encodage (voir slimEtaMinutes + novabox).
 *
 * 9.18aaa (retour terrain 17/10, 2e mort) : un 1080P de 536 Mo a tué le
 * MOTEUR entier (OOM killer → SIGKILL, l'encodage x264 par défaut demande
 * ~620 Mo de RAM pour du 1080p). Triple barrage désormais :
 *  1. bornes mémoire x264 MESURÉES (sendrec #205, 1080p30 : défaut 622 Mo
 *     → rc-lookahead=10:ref=1:bframes=0 + -threads 1 = 244 Mo, -61 %) ;
 *  2. préflight : RAM disponible insuffisante (NEBULA_SLIM_MIN_FREE_MB,
 *     défaut 350) ou fichier démesuré (NEBULA_SLIM_INPUT_CAP_MB, défaut
 *     800) → pas d'encodage, l'original est livré (via lien /d/) ;
 *  3. ffmpeg en priorité basse (runFfmpegKit, nice 10) : le moteur garde
 *     le CPU pour la sonde santé — plus de « moteur gelé (SIGKILL) ».
 *
 * Garanties :
 * - échec/timeout/sortie plus grosse → le fichier ORIGINAL est livré ;
 * - UN SEUL encodage à la fois (file de promesses — VPS 1 Go) ;
 * - durée inconnue (ffprobe muet) ou gain impossible → on ne tente pas ;
 * - le fichier est REMPLACÉ sur place : tous les appels en aval
 *   (liens /d/, envois WhatsApp, purge) restent inchangés.
 */

import fs from "fs";
import { readCgroupMemLimitBytes, readCgroupMemUsageBytes, readCgroupPageCacheBytes } from "./memoryGuard.js";
import path from "path";
import { probeVideoInfo, runFfmpegKit } from "./mediaToolkit.js";

export interface SlimResult {
  /** Chemin VALIDE dans tous les cas (fichier original si l'amincissement échoue). */
  path: string;
  originalBytes: number;
  finalBytes: number;
  slimmed: boolean;
  /** Note honnête pour le log (taille estimée par le calcul de débit). */
  note?: string;
}

/** Seuil de déclenchement — NEBULA_SLIM_MAX_MB (défaut 250 depuis 9.18ccc, bornes 50-2000). */
export function slimTriggerBytes(): number {
  const mb = Number(process.env.NEBULA_SLIM_MAX_MB || 250);
  const clamped = Number.isFinite(mb) ? Math.min(2000, Math.max(50, Math.round(mb))) : 250;
  return clamped * 1024 * 1024;
}

/** RAM minimale disponible pour tenter un encodage — NEBULA_SLIM_MIN_FREE_MB (défaut 350, 0 = garde off). */
export function slimMinFreeBytes(): number {
  const mb = Number(process.env.NEBULA_SLIM_MIN_FREE_MB);
  if (!Number.isFinite(mb)) return 350 * 1024 * 1024;
  return Math.max(0, Math.floor(mb)) * 1024 * 1024;
}

/** Taille d'entrée au-delà de laquelle l'encodage est sans espoir sur un petit VPS — NEBULA_SLIM_INPUT_CAP_MB (défaut 2048 depuis 9.18ccc, 0 = cap off). */
export function slimInputCapBytes(): number {
  const mb = Number(process.env.NEBULA_SLIM_INPUT_CAP_MB);
  if (!Number.isFinite(mb)) return 2048 * 1024 * 1024;
  return Math.max(0, Math.floor(mb)) * 1024 * 1024;
}

/** Timeout d'encodage — NEBULA_SLIM_TIMEOUT_MS (défaut 30 min : 1080p très rapide sur 1 cœur). */
export function slimTimeoutMs(): number {
  const v = Number(process.env.NEBULA_SLIM_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 60_000 ? Math.floor(v) : 30 * 60_000;
}

/** Pur : extrait MemAvailable (octets) du texte /proc/meminfo, null si absent. */
export function parseMemAvailableBytes(procText: string): number | null {
  const m = /MemAvailable:\s+(\d+)\s+kB/.exec(procText || "");
  return m ? Number(m[1]) * 1024 : null;
}

/** IO : RAM disponible (Linux), null ailleurs / en cas d'échec. */
export function readMemAvailableBytes(): number | null {
  try {
    return parseMemAvailableBytes(fs.readFileSync("/proc/meminfo", "utf8"));
  } catch {
    return null;
  }
}

/**
 * Pur (9.18eeee) : disponible vu DU CONTENEUR à partir des compteurs cgroup.
 * Terrain 21/10 : /proc/meminfo montre la RAM de l'HÔTE (dizaines de Go)
 * alors que le cgroup plafonne à 953 Mo — le préflight aaa validait des
 * encodages que le OOM killer tuait ensuite (SIGKILL passe 1, 1080P 490 Mo).
 * Le working set = usage − cache fichier (le kernel peut réclamer le cache,
 * mais on ne compte pas dessus — conservateur par design).
 */
export function cgroupAvailableBytes(
  usageBytes: number | null,
  limitBytes: number | null,
  cacheBytes: number | null
): number | null {
  if (usageBytes === null || limitBytes === null || !Number.isFinite(limitBytes) || limitBytes <= 0) return null;
  const workingSet = Math.max(0, usageBytes - (cacheBytes ?? 0));
  return Math.max(0, limitBytes - workingSet);
}

/** IO : disponible effectif — conteneur d'abord, /proc/meminfo sinon (hôte nu). */
export function slimEffectiveAvailableBytes(): number | null {
  const container = cgroupAvailableBytes(readCgroupMemUsageBytes(), readCgroupMemLimitBytes(), readCgroupPageCacheBytes());
  return container ?? readMemAvailableBytes();
}

export interface SlimPreflight {
  run: boolean;
  reason?: string;
}

/** Pur : peut-on raisonnablement lancer CET encodage sur CETTE machine ? */
export function slimPreflightDecision(inputBytes: number, memAvailableBytes: number | null): SlimPreflight {
  const cap = slimInputCapBytes();
  if (cap > 0 && inputBytes > cap) {
    return { run: false, reason: `entrée ${MB(inputBytes)} Mo > plafond ${MB(cap)} Mo — encodage sans espoir sur ce VPS` };
  }
  const minFree = slimMinFreeBytes();
  if (minFree > 0 && memAvailableBytes !== null && memAvailableBytes < minFree) {
    return { run: false, reason: `RAM disponible ${MB(memAvailableBytes)} Mo < ${MB(minFree)} Mo requis` };
  }
  return { run: true };
}

/** Pur : plancher de débit par hauteur — en dessous, la qualité s'effondre (recherche 17/10 : anime 1080p H.264 = 1500-2500 kbps). */
export function slimFloorKbpsForHeight(height: number): number {
  if (height >= 1000) return 2000;
  if (height >= 700) return 1100;
  return 650;
}

export interface SlimQualityDecision {
  encode: boolean;
  reason?: string;
  /** CRF constant (22) — la qualité ne dépend plus d'une taille visée. */
  crf: number;
  /** Plafond VBV (kbps) = 75 % du débit source. */
  maxrateKbps: number;
}

/**
 * Pur (9.18ccc) : décision qualité-d'abord. CRF 22 plafonné par VBV à 75 %
 * du débit source. Garde qualité : sous le plancher de la résolution, on ne
 * ré-encode PAS — l'ancienne cible fixe ~186 Mo écrasait un 1080p à
 * 976 kbps (« sable » terrain) ; un fichier déjà frugal ne doit pas être
 * abîmé pour un principe.
 */
export function slimQualityDecision(inputBytes: number, durationSec: number, height: number): SlimQualityDecision {
  // Contrat : durationSec > 0 (garanti par l'appelant — ffprobe muet = refus amont).
  const sourceKbps = Math.round((inputBytes * 8) / 1000 / durationSec);
  const maxrateKbps = Math.floor(sourceKbps * 0.75);
  const floorKbps = slimFloorKbpsForHeight(height);
  if (maxrateKbps < floorKbps) {
    return {
      encode: false,
      crf: 22,
      maxrateKbps,
      reason: `source déjà frugale (${sourceKbps} kbps ; plafond ${maxrateKbps} < plancher ${floorKbps} kbps en ${height}p) — ré-encoder n'abîmerait que la qualité`
    };
  }
  return { encode: true, crf: 22, maxrateKbps };
}

/**
 * Pur (9.18ccc) : ETA du message de patience (décision owner : prévenir
 * l'utilisateur, temps estimé selon la taille). Vitesse mesurée terrain :
 * 1,15 Mo/s d'entrée en veryfast/1 thread (511,6 Mo en 446 s) ;
 * superfast + 2 threads ≈ ×2 → 2,5 Mo/s retenus (prudent : mieux vaut
 * annoncer 3 min et livrer en 2 que l'inverse).
 */
export function slimEtaMinutes(inputBytes: number, mode: "gentle" | "aggressive" = "gentle"): number {
  const mb = inputBytes / (1024 * 1024);
  // aggressive = 2 passes : ~2,2× le temps d'une passe superfast.
  const factor = mode === "aggressive" ? 2.2 : 1;
  return Math.max(1, Math.round((mb / 2.5 / 60) * factor));
}

/** Cible de l'allègement à la demande (.slim) — NEBULA_SLIM_TARGET_MB (défaut 190, bornes 80-400). */
export function slimTargetMB(): number {
  const mb = Number(process.env.NEBULA_SLIM_TARGET_MB);
  if (!Number.isFinite(mb)) return 190;
  return Math.min(400, Math.max(80, Math.round(mb)));
}

/**
 * Pur (9.18fff, terrain « film 90 min refusé ») : la cible S'ADAPTE à la
 * durée. 190 Mo conviennent à un épisode de 24 min (~988 kbps) mais un
 * film de 90 min à 190 Mo = 193 kbps = bouillie — d'où l'ancien refus
 * honnête mais inutile. Désormais : la cible ne descend jamais sous
 * ~800 kbps vidéo (plancher qualité long-métrage), et ne dépasse jamais
 * 80 % de la source (aucun intérêt). Un épisode reste à ~190 Mo ; le film
 * de 90 min vise ~590 Mo. NEBULA_SLIM_TARGET_MB devient le MINIMUM
 * (une valeur haute rehausse la qualité de tout).
 */
export function slimEffectiveTargetMB(sourceBytes: number, durationSec: number, targetMB: number): number {
  const VIDEO_FLOOR_KBPS = 800; // + audio 96k + conteneur ~2 %
  const minMB = Math.ceil((((VIDEO_FLOOR_KBPS + 96) * Math.max(1, durationSec) * 1000) / 8 / 1048576) * 1.02);
  const maxMB = Math.floor((sourceBytes / 1048576) * 0.8);
  // Jamais sous le plancher qualité (les films longs visent plus que la
  // base), jamais plus que 80 % de la source (aucun intérêt) — le garde
  // 400 kbps de slimAggressiveKbps reste le filet anti-bouillie final.
  return Math.min(Math.max(targetMB, minMB), Math.max(maxMB, 1));
}

/**
 * Pur (9.18ddd) : débit vidéo pour atteindre la cible exacte. Budget cible
 * (conteneur ≈ 2 %) − audio 96k. Plancher 400 kbps : en dessous, même en
 * 2-pass tune animation, l'image devient bouillie — on refuse plutôt.
 */
export function slimAggressiveKbps(inputBytes: number, durationSec: number, targetMB: number): number | null {
  const targetKbps = Math.floor((targetMB * 1024 * 1024 * 8) / 1000 / durationSec * 0.98) - 96;
  if (targetKbps < 400) return null;
  return targetKbps;
}

/**
 * Pur (9.18ddd) : args d'UNE passe du mode agressif. 2-pass = la façon
 * qualité-optimale d'atteindre une taille EXACTE (la passe 1 cartographie
 * la complexité, la passe 2 distribue le budget). tune animation : flat
 * areas/lignes de l'anime — gros gain qualité à bas débit. Bornes mémoire
 * raisonnées (lookahead 12, ref 2, bframes 3 : l'ADN du tune animation
 * sans l'empreinte des défauts).
 */
export function slimAggressiveArgs(
  inputPath: string,
  videoKbps: number,
  pass: 1 | 2,
  passlogfile: string,
  outPath: string
): string[] {
  const common = [
    "-y", "-fflags", "+genpts", "-threads", "1", "-i", inputPath,
    "-c:v", "libx264", "-preset", "superfast", "-tune", "animation",
    "-b:v", `${videoKbps}k`, "-maxrate", `${Math.round(videoKbps * 1.45)}k`, "-bufsize", `${videoKbps * 2}k`,
    "-x264-params", "rc-lookahead=12:ref=2:bframes=3",
    "-pass", String(pass), "-passlogfile", passlogfile
  ];
  if (pass === 1) return [...common, "-an", "-f", "null", "/dev/null"];
  return [
    ...common, "-threads", "2",
    "-af", "aresample=async=1:first_pts=0",
    "-c:a", "aac", "-b:a", "96k",
    "-avoid_negative_ts", "make_zero", "-movflags", "+faststart",
    outPath
  ];
}

/**
 * Pur (9.18ccc) : arguments ffmpeg de l'encodage SLIM. CRF 22 constant +
 * VBV (maxrate = 75 % du débit source, bufsize 1,6×) : la qualité ne
 * descend jamais sous « très bonne », la taille suit. Preset superfast +
 * 2 threads encodeur (priorité owner : la rapidité) — les bornes mémoire
 * x264 (rc-lookahead=10:ref=1:bframes=0, sendrec #205 : 622 → 267 Mo
 * mesurés en 1080p avec -threads 2) restent : c'est elles qui ont fait
 * survivre l'encodage terrain du 17/10. L'audio est ré-encodé en AAC 96k
 * avec aresample=async : l'hygiène 9.18k pour les TS consolidés (DTS non
 * monotones) — un -c:a copy ferait ressurgir le muxer aborté. Coût
 * négligeable (l'audio est une goutte du budget d'encodage).
 */
export function slimEncodeArgs(inputPath: string, decision: SlimQualityDecision, outPath: string): string[] {
  return [
    "-y", "-fflags", "+genpts", "-threads", "1", "-i", inputPath,
    "-c:v", "libx264", "-preset", "superfast", "-crf", String(decision.crf),
    "-maxrate", `${decision.maxrateKbps}k`, "-bufsize", `${Math.round(decision.maxrateKbps * 1.6)}k`,
    "-x264-params", "rc-lookahead=10:ref=1:bframes=0",
    "-threads", "2",
    "-af", "aresample=async=1:first_pts=0",
    "-c:a", "aac", "-b:a", "96k",
    "-avoid_negative_ts", "make_zero", "-movflags", "+faststart",
    outPath
  ];
}

// ── Un seul ffmpeg à la fois (le VPS n'a que 1 Go de RAM) ──────────────────
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job);
  chain = run.catch(() => {});
  return run;
}

const MB = (b: number) => (b / (1024 * 1024)).toFixed(1);

/**
 * Amincit le fichier SUR PLACE si (et seulement si) c'est utile :
 * - taille > déclencheur (opts.triggerBytes, défaut slimTriggerBytes()) ;
 * - durée connue (le débit source en dépend) ;
 * - débit source assez riche pour absorber CRF 22 + 75 % sans perte
 *   visible (slimQualityDecision — sinon le fichier est livré tel quel).
 */
export async function slimVideoIfNeeded(
  inputPath: string,
  opts: {
    triggerBytes?: number;
    timeoutMs?: number;
    memAvailableBytes?: number | null;
    /** 9.18ddd : gentle (auto, CRF 22) ou aggressive (.slim, cible exacte 2-pass). */
    mode?: "gentle" | "aggressive";
    targetMB?: number;
    /** 9.18ddd : ne pas remplacer l'original — la sortie vit à outPath (.slim). */
    keepOriginal?: boolean;
  } = {}
): Promise<SlimResult> {
  const trigger = opts.triggerBytes ?? slimTriggerBytes();
  let originalBytes = 0;
  try {
    originalBytes = fs.statSync(inputPath).size;
  } catch {
    return { path: inputPath, originalBytes: 0, finalBytes: 0, slimmed: false };
  }
  const unchanged = (): SlimResult => ({ path: inputPath, originalBytes, finalBytes: originalBytes, slimmed: false });
  if (originalBytes <= trigger) return unchanged();

  // Durée inconnue → le débit source est incalculable : on ne tente pas.
  const probed = await probeVideoInfo(inputPath);
  const durationSec = probed.durationSec || 0;
  if (durationSec <= 0) {
    console.log("[SLIM] durée inconnue (ffprobe muet) — fichier livré tel quel");
    return unchanged();
  }

  // 9.18ccc — décision qualité : CRF 22 constant plafonné à 75 % du débit
  // source. Plus de cible de taille fixe : la sortie fait typiquement
  // 45-75 % de l'entrée, la résolution est intacte, zéro « sable ».
  // Hauteur inconnue (null) → 0 → plancher bas (650 kbps) : prudent mais permissif.
  const decision = slimQualityDecision(originalBytes, durationSec, probed.height || 0);
  if (!decision.encode) {
    console.log(`[SLIM] ${decision.reason} — fichier livré tel quel`);
    return unchanged();
  }

  // 9.18aaa — préflight : un encodage qui ne TIENT PAS sur la machine ne
  // part pas (RAM disponible, taille d'entrée). L'original est livré —
  // la livraison >100 Mo passe de toute façon par le lien /d/.
  // 9.18eeee : le disponible est mesuré DEPUIS LE CONTENEUR quand le cgroup
  // est lisible (limit − working set) — /proc/meminfo ment dans Docker.
  const preflight = slimPreflightDecision(
    originalBytes,
    opts.memAvailableBytes !== undefined ? opts.memAvailableBytes : slimEffectiveAvailableBytes()
  );
  if (!preflight.run) {
    console.log(`[SLIM] préflight : ${preflight.reason} — fichier original livré`);
    return unchanged();
  }

  const outPath = path.join(
    path.dirname(inputPath),
    `.${path.basename(inputPath)}.slim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`
  );

  // ── 9.18ddd — mode AGRESSIF (.slim, à la demande) : cible de taille
  // exacte en 2-pass tune animation. Contourne VOLONTAIREMENT le plancher
  // de résolution (l'utilisateur a choisi), mais refuse l'absurde : cible
  // impossible (bouillie) ou source déjà plus légère que la cible.
  if (opts.mode === "aggressive") {
    // 9.18fff : la cible s'adapte à la durée (un film de 90 min ne vise pas
    // 190 Mo — 193 kbps = bouillie — mais ~590 Mo à 800 kbps plancher).
    const targetMB = slimEffectiveTargetMB(originalBytes, durationSec, opts.targetMB ?? slimTargetMB());
    const videoKbps = slimAggressiveKbps(originalBytes, durationSec, targetMB);
    const sourceKbps = Math.round((originalBytes * 8) / 1000 / durationSec);
    if (videoKbps === null) {
      console.log(`[SLIM] cible ${targetMB} Mo impossible sans bouillie (durée ${Math.round(durationSec / 60)} min) — original conservé`);
      return unchanged();
    }
    if (videoKbps >= sourceKbps) {
      console.log(`[SLIM] source déjà plus légère que la cible ${targetMB} Mo (${sourceKbps} kbps) — original conservé`);
      return unchanged();
    }
    const passlogfile = `${outPath}.passlog`;
    const cleanupPassFiles = () => {
      const dirName = path.dirname(outPath);
      const base = path.basename(passlogfile);
      try {
        for (const f of fs.readdirSync(dirName)) {
          if (f.startsWith(base)) {
            try { fs.unlinkSync(path.join(dirName, f)); } catch {}
          }
        }
      } catch {}
    };
    console.log(`[SLIM] ${MB(originalBytes)} Mo → cible ~${targetMB} Mo en 2-pass tune animation (${videoKbps} kbps)...`);
    const r1 = await enqueue(() =>
      runFfmpegKit(slimAggressiveArgs(inputPath, videoKbps, 1, passlogfile, outPath), opts.timeoutMs ?? slimTimeoutMs())
    );
    if (!r1.ok) {
      cleanupPassFiles();
      console.log(`[SLIM] passe 1 échouée (${r1.signal ? `signal ${r1.signal}` : `code ${r1.code ?? "?"}`}) — original conservé`);
      return unchanged();
    }
    const r2 = await enqueue(() =>
      runFfmpegKit(slimAggressiveArgs(inputPath, videoKbps, 2, passlogfile, outPath), opts.timeoutMs ?? slimTimeoutMs())
    );
    cleanupPassFiles();
    let aggBytes = 0;
    try {
      aggBytes = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
    } catch {}
    if (!r2.ok || aggBytes === 0 || aggBytes >= originalBytes) {
      try { if (aggBytes > 0) fs.unlinkSync(outPath); } catch {}
      console.log(`[SLIM] passe 2 sans résultat utile — original conservé`);
      return unchanged();
    }
    if (opts.keepOriginal) {
      // .slim : l'original garde son lien /d/ — la version allégée vit à
      // côté (outPath), l'appelant l'enregistre sous son propre token.
      console.log(`[SLIM] ✔ ${MB(originalBytes)} → ${MB(aggBytes)} Mo (2-pass, cible ~${targetMB} Mo, original intact)`);
      return { path: outPath, originalBytes, finalBytes: aggBytes, slimmed: true, note: `2-pass ${videoKbps} kbps, cible ${targetMB} Mo` };
    }
    try {
      fs.renameSync(outPath, inputPath);
    } catch {
      try { fs.unlinkSync(outPath); } catch {}
      console.log("[SLIM] remplacement impossible — fichier original livré");
      return unchanged();
    }
    console.log(`[SLIM] ✔ ${MB(originalBytes)} → ${MB(aggBytes)} Mo (2-pass, cible ~${targetMB} Mo)`);
    return { path: inputPath, originalBytes, finalBytes: aggBytes, slimmed: true, note: `2-pass ${videoKbps} kbps, cible ${targetMB} Mo` };
  }

  console.log(`[SLIM] ${MB(originalBytes)} Mo → CRF ${decision.crf} plafonné à ${decision.maxrateKbps} kbps (75 % du source), même résolution, superfast 2 threads, x264 ≤267 Mo...`);

  // 9.18k : +genpts/make_zero — les DTS non monotones des TS consolidés
  // (Cat-Catch) faisaient ABORTER le muxer MP4. 9.18aaa/ccc : bornes
  // mémoire x264 + superfast 2 threads via slimEncodeArgs ; timeout 30 min
  // (NEBULA_SLIM_TIMEOUT_MS).
  const r = await enqueue(() =>
    runFfmpegKit(slimEncodeArgs(inputPath, decision, outPath), opts.timeoutMs ?? slimTimeoutMs())
  );

  let finalBytes = 0;
  try {
    finalBytes = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
  } catch {}
  const discard = () => {
    try { if (finalBytes > 0) fs.unlinkSync(outPath); } catch { /* déjà parti */ }
  };

  if (!r.ok || finalBytes === 0) {
    discard();
    // 9.18mm — la cause de la mort dans le log : signal (OOM killer = SIGKILL,
    // crash = SIGSEGV) ou code de sortie. Fin de l'incertitude « frame=3 ».
    const cause = r.signal
      ? `signal ${r.signal}${r.signal === "SIGKILL" ? " — très probablement l'OOM killer (RAM), vérifie « dmesg -T | grep -i oom »" : " (crash ffmpeg)"}`
      : `code ${r.code ?? "?"}`;
    console.log(`[SLIM] échec ffmpeg (${cause}) — fichier original livré (${(r.stderr || "").slice(-140)})`);
    return unchanged();
  }
  if (finalBytes >= originalBytes) {
    discard();
    console.log(`[SLIM] sortie plus lourde que l'original (${MB(finalBytes)} Mo) — original conservé`);
    return unchanged();
  }

  // Remplace l'original : appels en aval (liens, envois, purge) inchangés.
  try {
    fs.renameSync(outPath, inputPath);
  } catch {
    discard();
    console.log("[SLIM] remplacement impossible — fichier original livré");
    return unchanged();
  }
  console.log(`[SLIM] ✔ ${MB(originalBytes)} → ${MB(finalBytes)} Mo (même résolution, CRF ${decision.crf}, plafond ${decision.maxrateKbps} kbps)`);
  return { path: inputPath, originalBytes, finalBytes, slimmed: true, note: `CRF ${decision.crf}, plafond ${decision.maxrateKbps} kbps` };
}
