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
  opts: { triggerBytes?: number; targetMB?: number; timeoutMs?: number } = {}
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

  const outPath = path.join(
    path.dirname(inputPath),
    `.${path.basename(inputPath)}.slim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`
  );
  console.log(`[SLIM] ${MB(originalBytes)} Mo → cible ~${targetMB} Mo, même résolution (${fit.videoKbps} kbps plafonnés, ${fit.note})...`);

  const r = await enqueue(() =>
    runFfmpegKit(
      ["-y", "-threads", "0", "-i", inputPath, ...fit.options, "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", outPath],
      opts.timeoutMs ?? 15 * 60_000
    )
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
    console.log(`[SLIM] échec ffmpeg — fichier original livré (${(r.stderr || "").slice(-140)})`);
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
