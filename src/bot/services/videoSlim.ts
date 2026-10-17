/**
 * videoSlim (9.7) — amincissement vidéo « même résolution ».
 *
 * Décision owner 2026-10-11 : les épisodes 1080p/720p et les vidéos .ytv
 * sortent souvent trop lourds (ex. 400 Mo l'épisode). Ré-encodage x264
 * qualités-d'abord avec PLAFOND DE DÉBIT déterministe (le pattern éprouvé
 * whatsappFitVideoOptions, SANS le downscale 480p) dès qu'un fichier
 * dépasse NEBULA_SLIM_MAX_MB (défaut 200 Mo, bornes 50-2000).
 *
 * Recherches GitHub (décisions) : les bots de compression existants
 * (TG-videoCompress & co) obtiennent de gros ratios en sacrifiant la
 * résolution (downscale 480p forcé) et en H.265 — deux choses qu'on refuse
 * (résolution intouchée, H.264 lisible partout). Le per-title encoding pro
 * (VMAF, cf. video-quality-metrics/viser) coûte plus de CPU que l'encodage
 * — hors de question sur un VPS à 1 Go. On réutilise les briques locales
 * déjà testées (runFfmpegKit, probeVideoInfo, whatsappFitVideoOptions).
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
import path from "path";
import { probeVideoInfo, runFfmpegKit, whatsappFitVideoOptions } from "./mediaToolkit.js";

export interface SlimResult {
  /** Chemin VALIDE dans tous les cas (fichier original si l'amincissement échoue). */
  path: string;
  originalBytes: number;
  finalBytes: number;
  slimmed: boolean;
  /** Note honnête pour le log (taille estimée par le calcul de débit). */
  note?: string;
}

/** Seuil de déclenchement — NEBULA_SLIM_MAX_MB (défaut 200, bornes 50-2000). */
export function slimTriggerBytes(): number {
  const mb = Number(process.env.NEBULA_SLIM_MAX_MB || 200);
  const clamped = Number.isFinite(mb) ? Math.min(2000, Math.max(50, Math.round(mb))) : 200;
  return clamped * 1024 * 1024;
}

/** RAM minimale disponible pour tenter un encodage — NEBULA_SLIM_MIN_FREE_MB (défaut 350, 0 = garde off). */
export function slimMinFreeBytes(): number {
  const mb = Number(process.env.NEBULA_SLIM_MIN_FREE_MB);
  if (!Number.isFinite(mb)) return 350 * 1024 * 1024;
  return Math.max(0, Math.floor(mb)) * 1024 * 1024;
}

/** Taille d'entrée au-delà de laquelle l'encodage est sans espoir sur un petit VPS — NEBULA_SLIM_INPUT_CAP_MB (défaut 800, 0 = cap off). */
export function slimInputCapBytes(): number {
  const mb = Number(process.env.NEBULA_SLIM_INPUT_CAP_MB);
  if (!Number.isFinite(mb)) return 800 * 1024 * 1024;
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

/**
 * Pur : arguments ffmpeg de l'encodage SLIM. Bornes mémoire x264 mesurées
 * (9.18aaa) — rc-lookahead/ref/bframes sont LES trois moteurs d'allocation
 * de x264 (frames décodées pour le rate control, frames de référence, tampon
 * de réordonnancement) : 622 Mo → 350 Mo, et -threads 1 (défaut x264 :
 * 1,5×cœurs en frame-threads, un tampon par fil) amène à 244 Mo.
 */
export function slimEncodeArgs(inputPath: string, fitOptions: string[], outPath: string): string[] {
  return [
    "-y", "-fflags", "+genpts", "-threads", "1", "-i", inputPath,
    ...fitOptions,
    "-x264-params", "rc-lookahead=10:ref=1:bframes=0",
    "-threads", "1",
    "-af", "aresample=async=1:first_pts=0",
    "-avoid_negative_ts", "make_zero",
    "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
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
 * - durée connue (garantie de taille = calcul de débit, pas un espoir) ;
 * - débit source > débit cible (sinon le ré-encodage ne peut rien gagner).
 * opts.targetMB : cible de taille (défaut ~93 % du déclencheur).
 */
export async function slimVideoIfNeeded(
  inputPath: string,
  opts: { triggerBytes?: number; targetMB?: number; timeoutMs?: number; memAvailableBytes?: number | null } = {}
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

  // Durée inconnue → pas de garantie déterministe de taille : on ne tente pas.
  const probed = await probeVideoInfo(inputPath);
  if (!probed.durationSec || probed.durationSec <= 0) {
    console.log("[SLIM] durée inconnue (ffprobe muet) — fichier livré tel quel");
    return unchanged();
  }

  const targetMB = opts.targetMB ?? Math.max(50, Math.round((trigger / (1024 * 1024)) * 0.93));
  const fit = whatsappFitVideoOptions(probed.durationSec, targetMB, 0); // 0 = même résolution
  if (!fit) return unchanged();

  // Gain impossible : la source est déjà plus frugale que la cible.
  const sourceKbps = Math.round((originalBytes * 8) / 1000 / probed.durationSec);
  if (fit.videoKbps >= sourceKbps * 0.95) {
    console.log(`[SLIM] source déjà frugale (${sourceKbps} kbps ≤ cible ${fit.videoKbps} kbps) — pas de gain possible`);
    return unchanged();
  }

  // 9.18aaa — préflight : un encodage qui ne TIENT PAS sur la machine ne
  // part pas (RAM disponible, taille d'entrée). L'original est livré —
  // la livraison >100 Mo passe de toute façon par le lien /d/.
  const preflight = slimPreflightDecision(
    originalBytes,
    opts.memAvailableBytes !== undefined ? opts.memAvailableBytes : readMemAvailableBytes()
  );
  if (!preflight.run) {
    console.log(`[SLIM] préflight : ${preflight.reason} — fichier original livré`);
    return unchanged();
  }

  const outPath = path.join(
    path.dirname(inputPath),
    `.${path.basename(inputPath)}.slim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`
  );
  console.log(`[SLIM] ${MB(originalBytes)} Mo → cible ~${targetMB} Mo, même résolution (${fit.videoKbps} kbps plafonnés, x264 ≤244 Mo, 1 thread, ${fit.note})...`);

  // 9.18k — durcissement pour les entrées issues de TS consolidés (sortie
  // Cat-Catch) : leurs timestamps non monotones font ABORTER le muxer MP4
  // en ré-encodage (« non monotonically increasing dts »), un échec
  // classique et déterministe. genpts régénère les PTS à la lecture,
  // aresample=async resynchronise l'audio, make_zero décale les timestamps
  // négatifs. Sans effet sur les fichiers sains.
  // 9.18aaa — bornes mémoire x264 mesurées (622 → 244 Mo en 1080p) via
  // slimEncodeArgs ; timeout 30 min par défaut (NEBULA_SLIM_TIMEOUT_MS) :
  // un 1080p en veryfast sur 1 cœur dépasse l'ancien quota de 15 min.
  const r = await enqueue(() =>
    runFfmpegKit(slimEncodeArgs(inputPath, fit.options, outPath), opts.timeoutMs ?? slimTimeoutMs())
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
  console.log(`[SLIM] ✔ ${MB(originalBytes)} → ${MB(finalBytes)} Mo (même résolution)`);
  return { path: inputPath, originalBytes, finalBytes, slimmed: true, note: fit.note };
}
