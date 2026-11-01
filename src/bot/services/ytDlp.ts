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
import { parseYtDlpProgressLine } from "./progressMessenger.js";
import fs from "fs";
import os from "os";
import path from "path";
import axios from "axios";

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

/** Test hook — force le binaire résolu (fake en tests, null = introuvable).
 * 9.19b : tout forçage neutralise aussi ensureYtDlpBinary (les fakes des
 * tests ne doivent déclencher NI sonde NI téléchargement réseau). */
export function __setYtDlpBinForTests(bin: string | null): void {
  ytDlpBin = bin;
  binForcedForTests = true;
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

// ── 9.19b : binaire AUTONOME géré (terrain 01/11 : panne totale .ytv/.ytm) ──
//
// Le 01/11, le yt-dlp système (zipapp installée par install.sh 8.66) casse
// sur le VPS : « ImportError: You are using an unsupported version of
// Python. Only Python versions 3.11 and above are supported » — le Python
// système est trop ancien pour les releases 2026 de yt-dlp, et les API
// tierces de secours sont mortes (constat 8.86) : `.ytv`/`.ytm` deviennent
// un échec garanti pour tout le monde (5 tentatives utilisateur, 0 succès).
//
// Remède : le bot gère son PROPRE binaire — l'asset officiel « yt-dlp_linux »
// embarque un Python complet (PyInstaller) et ignore totalement le Python
// système. Ordre de résolution (ensureYtDlpBinary, appelé avant chaque run) :
//   1. NEBULA_YTDLP_PATH (override owner, sondé par --version) ;
//   2. yt-dlp du PATH (sondé : un binaire présent mais CASSÉ est ignoré
//      au lieu d'empoisonner chaque téléchargement d'une ImportError) ;
//   3. binaire géré <cwd>/.yt-dlp-cache/<asset> — téléchargé depuis les
//      releases GitHub officielles (arch/libc détectées), rafraîchi après
//      NEBULA_YTDLP_REFRESH_DAYS (défaut 7 : yt-dlp vieillit vite).
// Échec total → runYtDlp répond « introuvable » → message d'échec honnête.

let binForcedForTests = false;
let proberForTests: ((bin: string) => Promise<boolean>) | null = null;
let downloaderForTests: ((asset: string, dest: string) => Promise<void>) | null = null;
let managedDirForTests: string | null = null;
let ensureInflight: Promise<string | null> | null = null;
let ensureCheckedAt = 0;
const YTDLP_ENSURE_RECHECK_MS = 60 * 60 * 1000;

/** Répertoire du binaire géré (hors dépôt — voir .gitignore). */
function managedYtDlpDir(): string {
  return managedDirForTests || path.join(process.cwd(), ".yt-dlp-cache");
}

/** Asset officiel autonome selon arch/libc — null si non supporté. Pur. */
export function pickYtDlpAsset(arch: string, musl: boolean): string | null {
  if (musl) {
    if (arch === "x64") return "yt-dlp_musllinux";
    if (arch === "arm64") return "yt-dlp_musllinux_aarch64";
    return null;
  }
  if (arch === "x64") return "yt-dlp_linux";
  if (arch === "arm64") return "yt-dlp_linux_aarch64";
  return null;
}

/** Hôte Alpine/musl ? (le binaire glibc y refuserait de démarrer). */
export function looksLikeMuslHost(): boolean {
  try {
    return fs.existsSync("/lib/ld-musl-x86_64.so.1") || fs.existsSync("/lib/ld-musl-aarch64.so.1");
  } catch {
    return false;
  }
}

/** Fraîcheur du binaire géré (mtime) — pur, testable. */
export function isManagedBinaryFresh(mtimeMs: number, now = Date.now()): boolean {
  const raw = Number(process.env.NEBULA_YTDLP_REFRESH_DAYS || 7);
  const days = Number.isFinite(raw) && raw > 0 ? raw : 7;
  return now - mtimeMs < days * 86400000;
}

/** Test hooks — les overrides court-circuitent la sonde/le téléchargement. */
export function __setYtDlpProberForTests(fn: ((bin: string) => Promise<boolean>) | null): void {
  proberForTests = fn;
}
export function __setYtDlpDownloaderForTests(fn: ((asset: string, dest: string) => Promise<void>) | null): void {
  downloaderForTests = fn;
}
export function __setYtDlpManagedDirForTests(dir: string | null): void {
  managedDirForTests = dir;
}
export function __resetYtDlpManagerForTests(): void {
  ensureInflight = null;
  ensureCheckedAt = 0;
  ytDlpBin = undefined;
  binForcedForTests = false;
}

/** Le binaire démarre-t-il ? (`--version` = le contrat minimal, timeout dur.) */
function probeYtDlpBinary(bin: string, timeoutMs = 15000): Promise<boolean> {
  if (proberForTests) return proberForTests(bin);
  return new Promise(resolve => {
    try {
      const p = trackSpawn(spawn(bin, ["--version"], { stdio: ["ignore", "pipe", "pipe"] }));
      let out = "";
      let settled = false;
      const finish = (v: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      };
      const timer = setTimeout(() => {
        try { p.kill("SIGKILL"); } catch {}
        finish(false);
      }, timeoutMs);
      p.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
      p.on("error", () => finish(false));
      p.on("close", code => finish(code === 0 && out.trim().length > 0));
    } catch {
      resolve(false);
    }
  });
}

/** Télécharge l'asset autonome officiel (stream → tmp → rename atomique). */
async function downloadManagedYtDlp(asset: string, dest: string): Promise<boolean> {
  if (downloaderForTests) {
    await downloaderForTests(asset, dest);
    return true;
  }
  if (process.env.VITEST) return false; // jamais de réseau réel en tests
  const tmp = `${dest}.tmp`;
  try {
    fs.mkdirSync(managedYtDlpDir(), { recursive: true });
    const res = await axios.get(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, {
      responseType: "stream",
      timeout: 30000,
      maxRedirects: 5,
      headers: { "User-Agent": "NebulaBot" }
    });
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(tmp, { mode: 0o755 });
      const watchdog = setTimeout(() => {
        try { res.data.destroy(); } catch {}
        reject(new Error("timeout du téléchargement"));
      }, 240000);
      res.data.on("error", reject);
      ws.on("error", reject);
      ws.on("finish", () => {
        clearTimeout(watchdog);
        resolve();
      });
      res.data.pipe(ws);
    });
    // Garde anti-page d'erreur HTML : l'autonome fait ~41 Mo.
    if (fs.statSync(tmp).size < 5000000) return false;
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, dest);
    return true;
  } catch (err: any) {
    console.log(`[YTDLP] téléchargement du binaire autonome échoué : ${err?.message || err}`);
    try { fs.rmSync(tmp, { force: true }); } catch {}
    return false;
  }
}

/**
 * Résout un yt-dlp FONCTIONNEL et met à jour le cache du runner. Ne jette
 * jamais ; retourne null si rien ne marche (runYtDlp répondra « introuvable »
 * et l'appelant garde son message d'échec honnête). Single-flight : des
 * téléchargements simultanés partagent le même téléchargement.
 */
export async function ensureYtDlpBinary(force = false): Promise<string | null> {
  if (binForcedForTests) return ytDlpBin ?? null;
  if (ensureInflight) return ensureInflight;
  if (!force && ensureCheckedAt && Date.now() - ensureCheckedAt < YTDLP_ENSURE_RECHECK_MS) {
    return ytDlpBin ?? null;
  }
  ensureInflight = runYtDlpEnsure().finally(() => {
    ensureInflight = null;
  });
  return ensureInflight;
}

async function runYtDlpEnsure(): Promise<string | null> {
  ensureCheckedAt = Date.now();
  // 1. Override owner explicite.
  const envBin = (process.env.NEBULA_YTDLP_PATH || "").trim();
  if (envBin) {
    if (await probeYtDlpBinary(envBin)) {
      ytDlpBin = envBin;
      return envBin;
    }
    console.log(`[YTDLP] NEBULA_YTDLP_PATH (« ${envBin} ») inutilisable — ignoré`);
  }
  // 2. yt-dlp du PATH — sondé : présent mais cassé (Python système trop
  //    ancien, terrain 01/11) => ignoré, pas d'ImportError en boucle.
  const sys = resolveYtDlp();
  if (sys && await probeYtDlpBinary(sys)) {
    ytDlpBin = sys;
    return sys;
  }
  if (sys) {
    console.log("[YTDLP] yt-dlp système présent mais inutilisable (Python trop ancien ?) — bascule sur le binaire autonome géré");
  }
  // 3. Binaire autonome géré.
  const asset = pickYtDlpAsset(process.arch, looksLikeMuslHost());
  if (!asset) {
    ytDlpBin = null;
    console.log(`[YTDLP] architecture ${process.arch} sans binaire autonome disponible — yt-dlp indisponible`);
    return null;
  }
  const dest = path.join(managedYtDlpDir(), asset);
  if (fs.existsSync(dest) && isManagedBinaryFresh(fs.statSync(dest).mtimeMs) && await probeYtDlpBinary(dest)) {
    ytDlpBin = dest;
    return dest;
  }
  let downloaded = false;
  try {
    downloaded = await downloadManagedYtDlp(asset, dest);
  } catch {
    downloaded = false;
  }
  if (downloaded && await probeYtDlpBinary(dest)) {
    let sizeMB = "?";
    try { sizeMB = (fs.statSync(dest).size / 1e6).toFixed(0); } catch {}
    console.log(`[YTDLP] binaire autonome « ${asset} » installé (${sizeMB} Mo) — ${dest}`);
    ytDlpBin = dest;
    return dest;
  }
  // Le téléchargement a échoué mais un VIEUX binaire fonctionnel traîne
  // peut-être encore (mieux que rien — il sera rafraîchi au prochain tour).
  if (fs.existsSync(dest) && await probeYtDlpBinary(dest)) {
    console.log("[YTDLP] rafraîchissement impossible — ancien binaire autonome conservé");
    ytDlpBin = dest;
    return dest;
  }
  ytDlpBin = null;
  console.log("[YTDLP] AUCUN yt-dlp fonctionnel — owner : curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp");
  return null;
}


/**
 * Exécute yt-dlp avec timeout dur. Ne jette jamais (retourne ok/stdout/stderr),
 * calqué sur runFfmpegKit (mediaToolkit) : même style, mêmes garanties.
 */
export function runYtDlp(
  args: string[],
  timeoutMs = 120000,
  maxStdoutChars = 16000,
  onStderrLine?: (line: string) => void
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const bin = resolveYtDlp();
    if (!bin) {
      resolve({ ok: false, stdout: "", stderr: "yt-dlp introuvable sur ce système" });
      return;
    }
    let stdout = "";
    let stderr = "";
    let stderrTailBuf = ""; // 9.18hhhh : lignes complètes pour le callback
    try {
      const p = trackSpawn(spawn(bin, args)); // PAS de shell — args transmis tels quels
      p.stdout.on("data", (d: Buffer) => {
        if (stdout.length < maxStdoutChars) stdout += d.toString();
      });
      p.stderr.on("data", (d: Buffer) => {
        const chunk = d.toString();
        if (stderr.length < 16000) stderr += chunk;
        if (onStderrLine) {
          stderrTailBuf += chunk;
          const lines = stderrTailBuf.split("\n");
          stderrTailBuf = lines.pop() || "";
          for (const line of lines) {
            const t = line.trim();
            if (t) {
              try { onStderrLine(t); } catch {}
            }
          }
        }
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
  await ensureYtDlpBinary(); // 9.19b : la sonde elle aussi doit avoir un binaire sain
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
  await ensureYtDlpBinary(); // 9.19b : binaire garanti fonctionnel avant tout run
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
  opts: {
    audioLang?: string;
    subs?: { lang: string; auto: boolean } | null;
    /** 9.18hhhh — avancement réel yt-dlp (lignes [download] N% of X at Y ETA Z). */
    onProgress?: (sample: { percent: number; bytesTotal: number | null; speedBps: number | null; etaSeconds: number | null }) => void;
  } = {}
): Promise<YtDlpVideoOutcome> {
  const url = canonicalYoutubeUrl(rawInput);
  if (!url) return { ok: false, reason: "no_id" };
  await ensureYtDlpBinary(); // 9.19b : binaire garanti fonctionnel avant tout run
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
      "--no-playlist", "--no-warnings",
      // 9.18hhhh : avec un consommateur de progression on laisse yt-dlp
      // écrire ses lignes [download] (une par mise à jour grâce à --newline)
      // au lieu de les étouffer — elles alimentent le tableau de bord LIVE.
      opts.onProgress ? "--newline" : "--no-progress",
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
    // 9.18hhhh — les lignes [download] de yt-dlp alimentent le tableau de bord.
    const onLine = (line: string) => {
      const sample = parseYtDlpProgressLine(line);
      if (sample && opts.onProgress) {
        try { opts.onProgress(sample); } catch {}
      }
    };
    let r = await runYtDlp(buildArgs(false), 180000, 16000, opts.onProgress ? onLine : undefined);
    // 9.6 : mur d'authentification → UN seul retry avec les cookies,
    // dans la limite du budget global (50/h, tous utilisateurs).
    if (!r.ok && SIGNIN_RE.test(r.stderr) && cookies) {
      if (cookieDownloadsUsed() >= COOKIE_DOWNLOADS_PER_HOUR) {
        release();
        return { ok: false, reason: "session_quota" };
      }
      cookieDownloads.push(Date.now());
      r = await runYtDlp(buildArgs(true), 180000, 16000, opts.onProgress ? onLine : undefined);
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
