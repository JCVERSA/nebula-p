/**
 * yt-dlp runner (8.86) — recours LOCAL premier pour `.ytm` / `.ytv`.
 *
 * Contexte terrain (2026-09-27) : les 5 API tierces de la cascade sont
 * mortes en production (cobalt 400 — instance publique verrouillée,
 * y2mate/yupra DNS disparus, EliteProTech 404, Okatsu 402 payant).
 * yt-dlp est installé sur le VPS par install.sh (8.67) et l'IP datacenter
 * est acceptée par YouTube (test terrain owner 2026-09-27 : téléchargement
 * OK). Les API tierces restent en secours.
 *
 * 8.87 : --js-runtimes node (défi JS du player — testé terrain : nécessaire
 * mais insuffisant seul) + cookies de session OPTIONNELS via
 * NEBULA_YTDLP_COOKIES : certaines vidéos exigent une session authentifiée
 * (« Sign in to confirm you're not a bot », gating PAR VIDÉO sur IP
 * datacenter, constaté 2026-09-27 : la vidéo populaire passe, l'autre non).
 *
 * Sécurité (leçons audit commandes 8.84) :
 * - spawn SANS shell, args en tableau — aucune interpolation ;
 * - l'URL est TOUJOURS reconstruite depuis l'ID vidéo (canonicalYoutubeUrl) :
 *   jamais de texte utilisateur brut dans les args (un arg commençant par
 *   "-" serait interprété comme une OPTION yt-dlp) ;
 * - --no-playlist, --max-filesize, timeout dur (SIGKILL), plafond mémoire
 *   vérifié APRÈS téléchargement (la ceinture après les bretelles) ;
 * - fichier dans un répertoire temporaire dédié, toujours purgé (finally).
 */

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export type YtDlpOutcome =
  | { ok: true; buffer: Buffer; title: string | null }
  | { ok: false; reason: "no_id" | "missing" | "too_large" | "signin" | "failed"; detail?: string };

export type YtDlpVideoOutcome =
  | { ok: true; filePath: string; title: string | null }
  | { ok: false; reason: "no_id" | "missing" | "too_large" | "signin" | "failed"; detail?: string };

const YT_ID_RE = /(?:youtu\.be\/|v=|shorts\/)([a-zA-Z0-9_-]{11})(?![a-zA-Z0-9_-])/;

/**
 * Reconstruit l'URL canonique `https://www.youtube.com/watch?v=<id>` — la
 * SEULE forme d'URL jamais passée à yt-dlp. Retourne null si aucun ID
 * exploitable (texte de recherche pur, lien exotique, tentative d'injection
 * d'options : tout ce qui ne contient pas un ID valide est rejeté).
 * Fonction pure — testée unitairement sans binaire.
 */
export function canonicalYoutubeUrl(input: string): string | null {
  const id = (input.match(YT_ID_RE) || [])[1];
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

// Cache de la résolution du binaire (le PATH ne change pas en cours de run).
let ytDlpBin: string | null | undefined;

/** Test hook — force le binaire résolu (fake en tests, null = introuvable). */
export function __setYtDlpBinForTests(bin: string | null): void {
  ytDlpBin = bin;
}

function resolveYtDlp(): string | null {
  if (ytDlpBin !== undefined) return ytDlpBin;
  const dirs = (process.env.PATH || "").split(path.delimiter).concat(["/usr/local/bin", "/usr/bin"]);
  for (const d of dirs) {
    if (!d) continue;
    const p = path.join(d, "yt-dlp");
    try {
      fs.accessSync(p, fs.constants.X_OK);
      ytDlpBin = p;
      return p;
    } catch {}
  }
  ytDlpBin = null;
  return null;
}

/**
 * Exécute yt-dlp avec timeout dur. Ne jette jamais (retourne ok/stdout/stderr),
 * calqué sur runFfmpegKit (mediaToolkit) : même style, mêmes garanties.
 */
export function runYtDlp(args: string[], timeoutMs = 120000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const bin = resolveYtDlp();
    if (!bin) {
      resolve({ ok: false, stdout: "", stderr: "yt-dlp introuvable sur ce système" });
      return;
    }
    let stdout = "";
    let stderr = "";
    try {
      const p = spawn(bin, args); // PAS de shell — args transmis tels quels
      p.stdout.on("data", (d: Buffer) => {
        if (stdout.length < 16000) stdout += d.toString();
      });
      p.stderr.on("data", (d: Buffer) => {
        if (stderr.length < 16000) stderr += d.toString();
      });
      p.on("error", err => resolve({ ok: false, stdout, stderr: String(err) }));
      const timer = setTimeout(() => {
        try { p.kill("SIGKILL"); } catch {}
        resolve({ ok: false, stdout, stderr: "timeout" });
      }, timeoutMs);
      p.on("close", code => {
        clearTimeout(timer);
        resolve({ ok: code === 0, stdout, stderr: stderr.slice(-1500) });
      });
    } catch (err: any) {
      resolve({ ok: false, stdout, stderr: String(err?.message || err) });
    }
  });
}

function firstStdoutLine(stdout: string): string | null {
  const line = stdout.split("\n").map(l => l.trim()).filter(Boolean)[0];
  return line || null;
}

function findOutputFile(dir: string): string | null {
  try {
    const files = fs.readdirSync(dir).map(f => path.join(dir, f));
    for (const f of files) {
      try {
        const st = fs.statSync(f);
        if (st.isFile() && st.size > 1000) return f;
      } catch {}
    }
  } catch {}
  return null;
}

/** Dernières lignes de stderr, compactées pour le log (8.86b : plus d'échec muet). */
function stderrTail(stderr: string): string {
  return stderr.split("\n").map(l => l.trim()).filter(Boolean).slice(-3).join(" | ").slice(0, 300);
}

/** Mur d'authentification YouTube (gating par vidéo sur IP datacenter). */
const SIGNIN_RE = /sign in to confirm/i;

/**
 * 8.87 : fichier de cookies YouTube actif (NEBULA_YTDLP_COOKIES pointant un
 * fichier lisible) — null en mode anonyme. Vérifié À CHAQUE appel : le
 * fichier peut apparaître ou expirer entre deux commandes.
 */
export function activeCookiesFile(): string | null {
  const p = process.env.NEBULA_YTDLP_COOKIES;
  if (!p) return null;
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return p;
  } catch {
    return null;
  }
}

/** True si yt-dlp a refusé pour cause de taille (message officiel du binaire). */
function refusedForSize(stderr: string): boolean {
  return /larger than max-filesize|File is larger than/i.test(stderr);
}

/**
 * `.ytm` : audio via yt-dlp → buffer en mémoire (plafond maxBytes, la
 * conversion AAC existante gère webm/m4a/mp3 en entrée). Le répertoire
 * temporaire est TOUJOURS purgé (finally), même en cas d'échec.
 */
export async function ytmViaYtDlp(rawInput: string, maxBytes: number): Promise<YtDlpOutcome> {
  const url = canonicalYoutubeUrl(rawInput);
  if (!url) return { ok: false, reason: "no_id" };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nebula_ytdlp_"));
  try {
    const outBase = path.join(dir, "out");
    const cookies = activeCookiesFile();
    const r = await runYtDlp([
      "-f", "ba/bestaudio/best",
      "--no-playlist", "--no-warnings", "--no-progress",
      // 8.86b : --print IMPLIQUE --simulate (aide officielle yt-dlp) — sans
      // ce drapeau, yt-dlp ne télécharge RIEN (exit 0, aucun fichier). Prouvé
      // sur la version exacte du VPS (2026.08.19) via serveur local : avec
      // --print seul → 0 fichier ; avec --no-simulate → fichier + titre.
      "--no-simulate",
      // 8.87 : runtime JS pour le défi du player (node déjà présent sur le
      // VPS ; flag ADDITIF — deno resterait prioritaire s'il existait), et
      // cookies de session si NEBULA_YTDLP_COOKIES pointe un fichier lisible.
      "--js-runtimes", "node",
      ...(cookies ? ["--cookies", cookies] : []),
      "--max-filesize", String(maxBytes),
      "--print", "%(title)s",
      "-o", `${outBase}.%(ext)s`,
      url
    ], 120000);
    // Refus de taille : yt-dlp peut sortir en erreur OU en code 0 (skip) —
    // on examine le message AVANT le code de sortie.
    if (refusedForSize(r.stderr)) return { ok: false, reason: "too_large", detail: stderrTail(r.stderr) };
    if (!r.ok) {
      if (SIGNIN_RE.test(r.stderr)) return { ok: false, reason: "signin", detail: stderrTail(r.stderr) };
      if (/introuvable/.test(r.stderr)) return { ok: false, reason: "missing", detail: stderrTail(r.stderr) };
      return { ok: false, reason: "failed", detail: stderrTail(r.stderr) };
    }
    const file = findOutputFile(dir);
    if (!file) return { ok: false, reason: "failed", detail: "aucun fichier produit (mode simulate ?)" };
    if (fs.statSync(file).size > maxBytes) {
      return { ok: false, reason: "too_large", detail: `post-contrôle : ${fs.statSync(file).size} > ${maxBytes} octets` };
    }
    return { ok: true, buffer: fs.readFileSync(file), title: firstStdoutLine(r.stdout) };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * `.ytv` : vidéo via yt-dlp (hauteur plafonnée à la qualité demandée, merge
 * mp4) → chemin de fichier local (PAS de buffer : la vidéo peut peser, on
 * laisse Baileys streamer depuis le chemin). L'APPELANT doit purger le
 * répertoire (path.dirname(filePath)) après l'envoi.
 */
export async function ytvViaYtDlp(rawInput: string, quality: string, maxBytes: number): Promise<YtDlpVideoOutcome> {
  const url = canonicalYoutubeUrl(rawInput);
  if (!url) return { ok: false, reason: "no_id" };
  const q = ["360", "480", "720", "1080"].includes(quality) ? quality : "720";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nebula_ytdlp_"));
  // En cas d'échec, le répertoire est purgé ICI ; en cas de succès sa
  // propriété est transférée à l'APPELANT (qui purge après l'envoi WhatsApp).
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  };
  try {
    const outBase = path.join(dir, "out");
    const cookies = activeCookiesFile();
    const r = await runYtDlp([
      "-f", `bv*[height<=${q}]+ba/b[height<=${q}]`,
      "--merge-output-format", "mp4",
      "--no-playlist", "--no-warnings", "--no-progress",
      // 8.86b : --print implique --simulate — voir ytmViaYtDlp ci-dessus.
      "--no-simulate",
      // 8.87 : runtime JS + cookies — voir ytmViaYtDlp ci-dessus.
      "--js-runtimes", "node",
      ...(cookies ? ["--cookies", cookies] : []),
      "--max-filesize", String(maxBytes),
      "--print", "%(title)s",
      "-o", `${outBase}.%(ext)s`,
      url
    ], 180000);
    // Refus de taille : yt-dlp peut sortir en erreur OU en code 0 (skip) —
    // on examine le message AVANT le code de sortie.
    if (refusedForSize(r.stderr)) {
      release();
      return { ok: false, reason: "too_large", detail: stderrTail(r.stderr) };
    }
    if (!r.ok) {
      release();
      if (SIGNIN_RE.test(r.stderr)) return { ok: false, reason: "signin", detail: stderrTail(r.stderr) };
      if (/introuvable/.test(r.stderr)) return { ok: false, reason: "missing", detail: stderrTail(r.stderr) };
      return { ok: false, reason: "failed", detail: stderrTail(r.stderr) };
    }
    const file = findOutputFile(dir);
    if (!file) {
      release();
      return { ok: false, reason: "failed", detail: "aucun fichier produit (mode simulate ?)" };
    }
    if (fs.statSync(file).size > maxBytes) {
      release();
      return { ok: false, reason: "too_large", detail: `post-contrôle : ${fs.statSync(file).size} > ${maxBytes} octets` };
    }
    return { ok: true, filePath: file, title: firstStdoutLine(r.stdout) };
  } catch {
    release();
    return { ok: false, reason: "failed" };
  }
}
