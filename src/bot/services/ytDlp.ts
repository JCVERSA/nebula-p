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
import { trackSpawn } from "./spawnRegistry.js";
import fs from "fs";
import os from "os";
import path from "path";

export type YtDlpOutcome =
  | { ok: true; buffer: Buffer; title: string | null }
  | { ok: false; reason: "no_id" | "missing" | "too_large" | "signin" | "session_quota" | "failed"; detail?: string };

export type YtDlpVideoOutcome =
  | { ok: true; filePath: string; title: string | null }
  | { ok: false; reason: "no_id" | "missing" | "too_large" | "signin" | "session_quota" | "failed"; detail?: string };

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
export function runYtDlp(
  args: string[],
  timeoutMs = 120000,
  maxStdoutChars = 16000
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const bin = resolveYtDlp();
    if (!bin) {
      resolve({ ok: false, stdout: "", stderr: "yt-dlp introuvable sur ce système" });
      return;
    }
    let stdout = "";
    let stderr = "";
    try {
      const p = trackSpawn(spawn(bin, args)); // PAS de shell — args transmis tels quels
      p.stdout.on("data", (d: Buffer) => {
        if (stdout.length < maxStdoutChars) stdout += d.toString();
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

// ── 9.6 : protection du compte YouTube de session ──────────────────────────
// Décisions owner 2026-10-11 : (1) ANONYME D'ABORD — les cookies ne sont
// joints qu'en SECOURS, uniquement quand une vidéo exige une session (les
// requêtes authentifiées depuis une IP datacenter sont ce que Google
// surveille : on réduit ce volume au strict minimum) ; (2) budget global
// 50 téléchargements AVEC session / heure, tous utilisateurs confondus
// (au-delà : refus honnête session_quota — l'anonyme reste illimité).

/** Téléchargements authentifiés autorisés par fenêtre d'une heure. */
const COOKIE_DOWNLOADS_PER_HOUR = 50;
const cookieDownloads: number[] = [];

/** Combien de téléchargements authentifiés dans la dernière heure (fenêtre glissante). */
export function cookieDownloadsUsed(now = Date.now()): number {
  while (cookieDownloads.length > 0 && now - cookieDownloads[0] >= 3_600_000) cookieDownloads.shift();
  return cookieDownloads.length;
}

/** Tests uniquement : remplace l'historique des téléchargements authentifiés. */
export function __setCookieDownloadsForTests(list: number[]): void {
  cookieDownloads.length = 0;
  cookieDownloads.push(...list);
}

/**
 * 9.6 : préférence H.264 (avc1) + AAC (mp4a). « bv* » choisit presque
 * toujours du VP9/AV1 remballé en .mp4 par --merge-output-format —
 * techniquement lisible par VLC, mais refusé par WhatsApp et la plupart
 * des lecteurs natifs (« Cette vidéo n'est pas disponible car il y a eu
 * un souci avec le fichier vidéo », constat prod 2026-10-11). YouTube
 * sert de l'avc1 jusqu'à 1080p : toutes nos qualités passent en H.264/AAC
 * VRAIMENT compatible, avec le comportement 8.87 en repli si la vidéo
 * n'en propose pas. Fonction pure — testée unitairement.
 */
export function ytvFormatSpec(q: string): string {
  return `bv*[vcodec^=avc1][height<=${q}]+ba[acodec^=mp4a]/bv*[height<=${q}]+ba/b[height<=${q}]`;
}

// ── 9.10 : probe (pistes audio, sous-titres, playlists) ─────────────────────

export interface YoutubeProbe {
  ok: boolean;
  isPlaylist: boolean;
  playlistCount: number;
  entryIds: string[];
  playlistTitle: string | null;
  title: string | null;
  /** Langues des pistes audio (multi-doublage) — codes bas de casse. */
  audioLanguages: string[];
  /** Sous-titres dispo ; préfixe « auto: » = générés automatiquement. */
  subtitleLanguages: string[];
  detail?: string;
}

const PLAYLIST_ID_RE = /[?&]list=([a-zA-Z0-9_-]{12,})/;

/** Lien de playlist (list= présent) ? Pur. */
export function isPlaylistLink(input: string): boolean {
  return PLAYLIST_ID_RE.test(input);
}

/** URL canonique playlist — SEULE forme passée à yt-dlp (anti-injection). Pur. */
export function canonicalPlaylistUrl(input: string): string | null {
  const m = input.match(PLAYLIST_ID_RE);
  return m ? `https://www.youtube.com/playlist?list=${m[1]}` : null;
}

const PROBE_STDOUT_CAP = 2 * 1024 * 1024; // le -J dépasse largement 16 Ko

/**
 * 9.10 — sonde une URL YouTube SANS télécharger : pistes audio (doublages),
 * sous-titres, ou contenu d'une playlist (flat = rapide, pas de fetch par
 * vidéo). Échec → ok:false : l'appelant dégrade honnêtement (comportement
 * d'avant 9.10), jamais d'exception.
 */
export async function probeYoutubeEntry(rawInput: string): Promise<YoutubeProbe> {
  const empty: YoutubeProbe = {
    ok: false, isPlaylist: false, playlistCount: 0, entryIds: [],
    playlistTitle: null, title: null, audioLanguages: [], subtitleLanguages: []
  };
  const plUrl = canonicalPlaylistUrl(rawInput);
  if (plUrl) {
    const r = await runYtDlp(["--flat-playlist", "--skip-download", "-J", plUrl], 45000, PROBE_STDOUT_CAP);
    if (!r.ok) return { ...empty, detail: stderrTail(r.stderr) };
    try {
      const j = JSON.parse(r.stdout);
      const entries = Array.isArray(j.entries) ? j.entries.filter((e: any) => e && e.id) : [];
      return {
        ...empty, ok: true, isPlaylist: true,
        playlistCount: typeof j.playlist_count === "number" ? j.playlist_count : entries.length,
        entryIds: entries.map((e: any) => String(e.id)),
        playlistTitle: j.title || null, title: j.title || null
      };
    } catch {
      return { ...empty, detail: "json playlist illisible" };
    }
  }
  const url = canonicalYoutubeUrl(rawInput);
  if (!url) return { ...empty, detail: "no_id" };
  const r = await runYtDlp(["--skip-download", "-J", url], 45000, PROBE_STDOUT_CAP);
  if (!r.ok) return { ...empty, detail: stderrTail(r.stderr) };
  try {
    const j = JSON.parse(r.stdout);
    const langs = new Set<string>();
    for (const f of j.formats || []) {
      if (f && f.acodec && f.acodec !== "none" && f.language) langs.add(String(f.language).toLowerCase());
    }
    const manual = Object.keys(j.subtitles || {});
    const autos = Object.keys(j.automatic_captions || {}).map((k: string) => `auto:${k}`);
    return {
      ...empty, ok: true, isPlaylist: false,
      title: j.title || null,
      audioLanguages: [...langs],
      subtitleLanguages: [...manual, ...autos]
    };
  } catch {
    return { ...empty, detail: "json vidéo illisible" };
  }
}

/**
 * 9.10 — sélecteur de formats avec PRIORITÉ de piste audio : la langue
 * demandée d'abord (avc1 + audio de la langue), puis tout le sélecteur 9.6
 * en repli. Sans audioLang : comportement 9.6 inchangé. Pur.
 */
export function ytvFormatSpecWithAudio(q: string, audioLang?: string): string {
  if (!audioLang) return ytvFormatSpec(q);
  return `bv*[vcodec^=avc1][height<=${q}]+ba[language^=${audioLang}][acodec^=mp4a]/${ytvFormatSpec(q)}`;
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
    const buildArgs = (withCookies: boolean): string[] => [
      "-f", "ba/bestaudio/best",
      "--no-playlist", "--no-warnings", "--no-progress",
      // 8.86b : --print IMPLIQUE --simulate (aide officielle yt-dlp) — sans
      // ce drapeau, yt-dlp ne télécharge RIEN (exit 0, aucun fichier). Prouvé
      // sur la version exacte du VPS (2026.08.19) via serveur local : avec
      // --print seul → 0 fichier ; avec --no-simulate → fichier + titre.
      "--no-simulate",
      // 8.87 : runtime JS pour le défi du player (node déjà présent sur le
      // VPS ; flag ADDITIF — deno resterait prioritaire s'il existait).
      "--js-runtimes", "node",
      // 9.6 : anonyme d'abord — les cookies ne partent qu'en secours.
      ...(withCookies && cookies ? ["--cookies", cookies] : []),
      "--max-filesize", String(maxBytes),
      "--print", "%(title)s",
      "-o", `${outBase}.%(ext)s`,
      url
    ];
    let r = await runYtDlp(buildArgs(false), 120000);
    // 9.6 : mur d'authentification → UN seul retry avec les cookies,
    // dans la limite du budget global (50/h, tous utilisateurs).
    if (!r.ok && SIGNIN_RE.test(r.stderr) && cookies) {
      if (cookieDownloadsUsed() >= COOKIE_DOWNLOADS_PER_HOUR) {
        return { ok: false, reason: "session_quota" };
      }
      cookieDownloads.push(Date.now());
      r = await runYtDlp(buildArgs(true), 120000);
    }
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
export async function ytvViaYtDlp(
  rawInput: string,
  quality: string,
  maxBytes: number,
  opts: { audioLang?: string; subs?: { lang: string; auto: boolean } | null } = {}
): Promise<YtDlpVideoOutcome> {
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
    const buildArgs = (withCookies: boolean): string[] => [
      // 9.6 : H.264+AAC d'abord ; 9.10 : piste audio de la langue demandée
      // en tête de préférence quand elle existe.
      "-f", ytvFormatSpecWithAudio(q, opts.audioLang),
      "--merge-output-format", "mp4",
      "--no-playlist", "--no-warnings", "--no-progress",
      // 8.86b : --print implique --simulate — voir ytmViaYtDlp ci-dessus.
      "--no-simulate",
      // 8.87 : runtime JS — voir ytmViaYtDlp ci-dessus.
      "--js-runtimes", "node",
      // 9.6 : anonyme d'abord — les cookies ne partent qu'en secours.
      ...(withCookies && cookies ? ["--cookies", cookies] : []),
      // 9.10 : sous-titres intégrés au mp4 (mov_text) quand demandés.
      ...(opts.subs
        ? [opts.subs.auto ? "--write-auto-subs" : "--write-subs", "--sub-langs", opts.subs.lang, "--embed-subs"]
        : []),
      "--max-filesize", String(maxBytes),
      "--print", "%(title)s",
      "-o", `${outBase}.%(ext)s`,
      url
    ];
    let r = await runYtDlp(buildArgs(false), 180000);
    // 9.6 : mur d'authentification → UN seul retry avec les cookies,
    // dans la limite du budget global (50/h, tous utilisateurs).
    if (!r.ok && SIGNIN_RE.test(r.stderr) && cookies) {
      if (cookieDownloadsUsed() >= COOKIE_DOWNLOADS_PER_HOUR) {
        release();
        return { ok: false, reason: "session_quota" };
      }
      cookieDownloads.push(Date.now());
      r = await runYtDlp(buildArgs(true), 180000);
    }
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
