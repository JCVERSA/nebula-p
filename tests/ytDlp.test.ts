import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  __setCookieDownloadsForTests,
  __setYtDlpBinForTests,
  canonicalPlaylistUrl,
  canonicalYoutubeUrl,
  cookieDownloadsUsed,
  isPlaylistLink,
  probeYoutubeEntry,
  runYtDlp,
  ytmViaYtDlp,
  ytvFormatSpec,
  ytvFormatSpecWithAudio,
  ytvViaYtDlp
} from "../src/bot/services/ytDlp.js";
import {
  __resetYtvPendingForTests,
  defaultAudioLanguage,
  parseYtvArgs,
  pickSubtitles
} from "../src/bot/commands/ytvideo.js";

/**
 * 8.86 — yt-dlp local, premier recours de `.ytm` / `.ytv`.
 *
 * Contexte : les 5 API tierces de la cascade sont mortes en prod
 * (2026-09-27). yt-dlp (installé sur le VPS) devient le recours principal.
 *
 * Ces tests n'exigent NI yt-dlp NI réseau : le binaire est un fake node
 * exécutable qui rejoue le contrat de yt-dlp (args journalisés, fichier
 * écrit à l'emplacement -o, titre sur stdout, code de sortie pilotable).
 * Le vrai comportement a été validé sur le VPS par l'owner (test terrain).
 */

// ── Faux binaire yt-dlp ────────────────────────────────────────────────────
let fakeDir = "";
let fakeBin = "";
let argsLog = "";

function installFakeBin(): void {
  fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-fake-"));
  fakeBin = path.join(fakeDir, "yt-dlp");
  argsLog = path.join(fakeDir, "args.jsonl");
  const script = [
    "#!/usr/bin/env node",
    "const fs = require('fs');",
    "const args = process.argv.slice(2);",
    "fs.appendFileSync(process.env.ARGS_LOG_PATH, JSON.stringify(args) + '\\n');",
    "if (process.env.FAKE_MODE === 'fail') { console.error('boom'); process.exit(1); }",
    "if (process.env.FAKE_MODE === 'toobig') { console.error('File is larger than max-filesize'); process.exit(0); }",
    "if (process.env.FAKE_MODE === 'json-video') { console.log(JSON.stringify({title: 'Film VF', formats: [{acodec: 'mp4a', language: 'fr-FR'}, {acodec: 'mp4a', language: 'ja'}, {acodec: 'none', vcodec: 'avc1'}], subtitles: {fr: [{}]}, automatic_captions: {en: [{}]}})); process.exit(0); }",
    "if (process.env.FAKE_MODE === 'json-playlist') { console.log(JSON.stringify({title: 'Ma Playlist', playlist_count: 3, entries: [{id: 'aaaaaaaaaaa'}, {id: 'bbbbbbbbbbb'}, {id: 'ccccccccccc'}]})); process.exit(0); }",
    "if (process.env.FAKE_MODE === 'signin') {",
    "  // 9.6 : le 1er appel (anonyme) se heurte au mur ; le retry avec",
    "  // cookies passe (compteur = lignes déjà journalisées).",
    "  const seen = fs.readFileSync(process.env.ARGS_LOG_PATH, 'utf8').split('\\n').filter(Boolean).length;",
    "  if (seen < 2) { console.error('ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you are not a bot. Use --cookies for the authentication.'); process.exit(1); }",
    "}",
    "const oi = args.indexOf('-o');",
    "if (oi !== -1) {",
    "  const out = args[oi + 1].replace('%(ext)s', process.env.FAKE_EXT || 'webm');",
    "  fs.writeFileSync(out, Buffer.alloc(Number(process.env.FAKE_SIZE || '4096')));",
    "}",
    "console.log('Fake Title');",
    "process.exit(0);"
  ].join("\n");
  fs.writeFileSync(fakeBin, script);
  fs.chmodSync(fakeBin, 0o755);
  process.env.ARGS_LOG_PATH = argsLog;
  process.env.FAKE_MODE = "";
  process.env.FAKE_SIZE = "4096";
  __setYtDlpBinForTests(fakeBin);
}

function readLoggedArgs(): string[][] {
  if (!fs.existsSync(argsLog)) return [];
  return fs.readFileSync(argsLog, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as string[]);
}

function nebulaTmpDirs(): string[] {
  try {
    return fs.readdirSync(os.tmpdir()).filter(d => d.startsWith("nebula_ytdlp_")).sort();
  } catch {
    return [];
  }
}

const CANNONICAL_RE = /^https:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}$/;

beforeEach(() => {
  installFakeBin();
  __setCookieDownloadsForTests([]);
  __resetYtvPendingForTests();
});

afterEach(() => {
  __setYtDlpBinForTests(null);
  __setCookieDownloadsForTests([]);
  delete process.env.ARGS_LOG_PATH;
  delete process.env.FAKE_MODE;
  delete process.env.FAKE_SIZE;
  delete process.env.FAKE_EXT;
  delete process.env.NEBULA_YTDLP_COOKIES;
  try { fs.rmSync(fakeDir, { recursive: true, force: true }); } catch {}
});

// ── canonicalYoutubeUrl (pure — le garde anti-injection) ──────────────────
describe("8.86 — canonicalYoutubeUrl : canonisation et garde anti-injection", () => {
  it("reconstruit l'URL canonique depuis les 3 formes courantes", () => {
    expect(canonicalYoutubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(canonicalYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(canonicalYoutubeUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("retourne null pour un texte de recherche pur (pas d'ID)", () => {
    expect(canonicalYoutubeUrl("burna boy last last")).toBeNull();
    expect(canonicalYoutubeUrl("")).toBeNull();
  });

  it("retourne null pour un ID mal formé (≠ 11 caractères)", () => {
    expect(canonicalYoutubeUrl("https://youtu.be/short")).toBeNull();
    expect(canonicalYoutubeUrl("https://www.youtube.com/watch?v=toolongidvalue")).toBeNull();
  });

  it("neutralise les tentatives d'injection d'options : seule l'URL canonique ressort", () => {
    // Le texte utilisateur ne doit JAMAIS arriver tel quel dans les args de
    // yt-dlp : un token commençant par "-" serait lu comme une option.
    const out = canonicalYoutubeUrl("https://youtu.be/dQw4w9WgXcQ --write-pages -o /tmp/evil");
    expect(out).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(out).toMatch(CANNONICAL_RE);
  });

  it("force toujours l'hôte youtube.com (aucune URL tierce ne passe)", () => {
    // Même un lien d'un autre domaine contenant un ID : on ne garde que
    // l'ID, rejoué sur l'hôte officiel — zéro surface SSRF.
    expect(canonicalYoutubeUrl("https://evil.example/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
});

// ── runYtDlp ───────────────────────────────────────────────────────────────
describe("8.86 — runYtDlp : runner sans shell", () => {
  it("binaire introuvable → ok:false explicite (pas de crash)", async () => {
    __setYtDlpBinForTests(null);
    const r = await runYtDlp(["--version"]);
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain("introuvable");
  });

  it("transmet les args tels quels et capture stdout (fake exécutable)", async () => {
    const r = await runYtDlp(["--print", "%(title)s", "-o", "/tmp/x.%(ext)s", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"]);
    expect(r.ok).toBe(true);
    expect(r.stdout).toContain("Fake Title");
  });

  it("code de sortie non nul → ok:false avec stderr", async () => {
    process.env.FAKE_MODE = "fail";
    const r = await runYtDlp(["-f", "ba"]);
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain("boom");
  });
});

// ── ytmViaYtDlp (audio) ────────────────────────────────────────────────────
describe("8.86 — ytmViaYtDlp : audio avec plafond et purge", () => {
  it("chemin heureux : buffer + titre + args sûrs + répertoire purgé", async () => {
    const before = nebulaTmpDirs();
    const r = await ytmViaYtDlp("https://youtu.be/dQw4w9WgXcQ", 60 * 1024 * 1024);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.buffer.length).toBe(4096);
      expect(r.title).toBe("Fake Title");
    }
    // Args : l'URL passée est EXACTEMENT la canonique — rien d'autre.
    const args = readLoggedArgs().at(-1) as string[];
    expect(args[args.length - 1]).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(args).toContain("--no-playlist");
    expect(args.join(" ")).toContain("--max-filesize");
    // Répertoire temporaire toujours purgé (le buffer est déjà en mémoire).
    expect(nebulaTmpDirs()).toEqual(before);
  });

  it("texte sans ID → no_id SANS exécuter le binaire", async () => {
    const callsBefore = readLoggedArgs().length;
    const r = await ytmViaYtDlp("recherche sans lien", 60 * 1024 * 1024);
    expect(r).toMatchObject({ ok: false, reason: "no_id" });
    expect(readLoggedArgs().length).toBe(callsBefore);
  });

  it("dépassement du plafond (post-contrôle) → too_large + purge", async () => {
    process.env.FAKE_SIZE = "5000";
    const before = nebulaTmpDirs();
    const r = await ytmViaYtDlp("https://youtu.be/dQw4w9WgXcQ", 4096);
    expect(r).toMatchObject({ ok: false, reason: "too_large" });
    expect((r as { detail?: string }).detail).toContain("post-contr");
    expect(nebulaTmpDirs()).toEqual(before);
  });

  it("yt-dlp refuse lui-même la taille (stderr officiel) → too_large + purge", async () => {
    process.env.FAKE_MODE = "toobig";
    const before = nebulaTmpDirs();
    const r = await ytmViaYtDlp("https://youtu.be/dQw4w9WgXcQ", 60 * 1024 * 1024);
    expect(r).toMatchObject({ ok: false, reason: "too_large" });
    expect(nebulaTmpDirs()).toEqual(before);
  });

  it("échec du binaire → failed avec DETAIL stderr (8.86b : plus d'échec muet) + purge", async () => {
    process.env.FAKE_MODE = "fail";
    const before = nebulaTmpDirs();
    const r = await ytmViaYtDlp("https://youtu.be/dQw4w9WgXcQ", 60 * 1024 * 1024);
    expect(r).toMatchObject({ ok: false, reason: "failed" });
    expect((r as { detail?: string }).detail).toContain("boom");
    expect(nebulaTmpDirs()).toEqual(before);
  });

  it("binaire absent → missing (dégradation propre vers la cascade API)", async () => {
    __setYtDlpBinForTests(null);
    const r = await ytmViaYtDlp("https://youtu.be/dQw4w9WgXcQ", 60 * 1024 * 1024);
    expect(r).toMatchObject({ ok: false, reason: "missing" });
  });
});

// ── ytvViaYtDlp (vidéo) ────────────────────────────────────────────────────
describe("8.86 — ytvViaYtDlp : vidéo plafonnée à la qualité demandée", () => {
  it("chemin heureux : fichier local + format height<= + merge mp4", async () => {
    process.env.FAKE_EXT = "mp4";
    const r = await ytvViaYtDlp("https://youtu.be/dQw4w9WgXcQ", "720", 100 * 1024 * 1024);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(fs.existsSync(r.filePath)).toBe(true);
      expect(path.basename(r.filePath)).toMatch(/^out\.mp4$/);
      expect(r.title).toBe("Fake Title");
      // Contrat appelant : il purge le répertoire après l'envoi.
      fs.rmSync(path.dirname(r.filePath), { recursive: true, force: true });
      expect(fs.existsSync(r.filePath)).toBe(false);
    }
    const args = readLoggedArgs().at(-1) as string[];
    expect(args).toContain(ytvFormatSpec("720"));
    expect(args).toContain("--merge-output-format");
    expect(args[args.length - 1]).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("qualité invalide → repli 720p dans le sélecteur de formats", async () => {
    await ytvViaYtDlp("https://youtu.be/dQw4w9WgXcQ", "4320", 100 * 1024 * 1024);
    const args = readLoggedArgs().at(-1) as string[];
    expect(args).toContain(ytvFormatSpec("720"));
  });

  it("NON-RÉGRESSION 8.86b : les args contiennent --no-simulate (sinon --print bascule yt-dlp en simulation et ne télécharge RIEN)", async () => {
    await ytmViaYtDlp("https://youtu.be/dQw4w9WgXcQ", 60 * 1024 * 1024);
    expect((readLoggedArgs().at(-1) as string[])).toContain("--no-simulate");
  });

  it("NON-RÉGRESSION 8.86b (vidéo) : args avec --no-simulate également", async () => {
    process.env.FAKE_EXT = "mp4";
    const r = await ytvViaYtDlp("https://youtu.be/dQw4w9WgXcQ", "720", 100 * 1024 * 1024);
    expect((readLoggedArgs().at(-1) as string[])).toContain("--no-simulate");
    if (r.ok) fs.rmSync(path.dirname(r.filePath), { recursive: true, force: true });
  });

  it("yt-dlp refuse la taille avec code 0 (skip) → too_large aussi en vidéo", async () => {
    process.env.FAKE_MODE = "toobig";
    const before = nebulaTmpDirs();
    const r = await ytvViaYtDlp("https://youtu.be/dQw4w9WgXcQ", "720", 100 * 1024 * 1024);
    expect(r).toMatchObject({ ok: false, reason: "too_large" });
    expect(nebulaTmpDirs()).toEqual(before);
  });

  it("échec → failed et le fichier temporaire est purgé par le service", async () => {
    process.env.FAKE_MODE = "fail";
    const before = nebulaTmpDirs();
    const r = await ytvViaYtDlp("https://youtu.be/dQw4w9WgXcQ", "480", 100 * 1024 * 1024);
    expect(r).toMatchObject({ ok: false, reason: "failed" });
    expect((r as { detail?: string }).detail).toContain("boom");
    expect(nebulaTmpDirs()).toEqual(before);
  });
});

// ── 8.87 : runtime JS node + cookies de session optionnels ─────────────────
describe("8.87 — runtime JS node + cookies de session optionnels", () => {
  it("--js-runtimes node toujours présent (audio)", async () => {
    await ytmViaYtDlp("https://youtu.be/dQw4w9WgXcQ", 60 * 1024 * 1024);
    const args = readLoggedArgs().at(-1) as string[];
    const i = args.indexOf("--js-runtimes");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("node");
  });

  it("--js-runtimes node toujours présent (vidéo)", async () => {
    process.env.FAKE_EXT = "mp4";
    const r = await ytvViaYtDlp("https://youtu.be/dQw4w9WgXcQ", "720", 100 * 1024 * 1024);
    const args = readLoggedArgs().at(-1) as string[];
    const i = args.indexOf("--js-runtimes");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("node");
    if (r.ok) fs.rmSync(path.dirname(r.filePath), { recursive: true, force: true });
  });

  it("cookies configurés mais vidéo accessible → appel UNIQUEMENT anonyme (pas de --cookies)", async () => {
    const ck = path.join(fakeDir, "cookies.txt");
    fs.writeFileSync(ck, "# Netscape HTTP Cookie File\n");
    process.env.NEBULA_YTDLP_COOKIES = ck;
    await ytmViaYtDlp("https://youtu.be/dQw4w9WgXcQ", 60 * 1024 * 1024);
    const calls = readLoggedArgs();
    expect(calls.length).toBe(1); // pas de retry : l'anonyme a suffi
    expect(calls[0]).not.toContain("--cookies");
  });

  it("env défini mais fichier ABSENT → pas de --cookies (mode anonyme)", async () => {
    process.env.NEBULA_YTDLP_COOKIES = path.join(fakeDir, "introuvable.txt");
    await ytmViaYtDlp("https://youtu.be/dQw4w9WgXcQ", 60 * 1024 * 1024);
    expect((readLoggedArgs().at(-1) as string[])).not.toContain("--cookies");
  });

  it("env non défini → pas de --cookies", async () => {
    await ytmViaYtDlp("https://youtu.be/dQw4w9WgXcQ", 60 * 1024 * 1024);
    expect((readLoggedArgs().at(-1) as string[])).not.toContain("--cookies");
  });

  it("mur d'authentification YouTube → reason signin avec détail (pas d'échec muet)", async () => {
    process.env.FAKE_MODE = "signin";
    const r = await ytmViaYtDlp("https://youtu.be/dQw4w9WgXcQ", 60 * 1024 * 1024);
    expect(r).toMatchObject({ ok: false, reason: "signin" });
    expect((r as { detail?: string }).detail).toContain("Sign in");
  });
});

// ── 9.6 : H.264 d'abord, anonyme d'abord, budget session 50/h ──────────────
describe("9.6 — H.264/AAC, anonyme d'abord, budget de session", () => {
  it("ytvFormatSpec : avc1+mp4a en tête, repli 8.87 ensuite", () => {
    expect(ytvFormatSpec("720"))
      .toBe("bv*[vcodec^=avc1][height<=720]+ba[acodec^=mp4a]/bv*[height<=720]+ba/b[height<=720]");
    expect(ytvFormatSpec("480")).toContain("[vcodec^=avc1][height<=480]");
  });

  it("ytv : le -f passé au binaire est le format H.264/AAC", async () => {
    process.env.FAKE_EXT = "mp4";
    const r = await ytvViaYtDlp("https://youtu.be/dQw4w9WgXcQ", "720", 100 * 1024 * 1024);
    const args = readLoggedArgs().at(-1) as string[];
    const i = args.indexOf("-f");
    expect(args[i + 1]).toBe(ytvFormatSpec("720"));
    if (r.ok) fs.rmSync(path.dirname(r.filePath), { recursive: true, force: true });
  });

  it("mur d'authentification + cookies → retry UNIQUE : 1er sans, 2e avec --cookies", async () => {
    const ck = path.join(fakeDir, "cookies.txt");
    fs.writeFileSync(ck, "# Netscape HTTP Cookie File\n");
    process.env.NEBULA_YTDLP_COOKIES = ck;
    process.env.FAKE_MODE = "signin";
    const r = await ytmViaYtDlp("https://youtu.be/dQw4w9WgXcQ", 60 * 1024 * 1024);
    expect(r.ok).toBe(true); // le retry avec cookies a passé le mur
    const calls = readLoggedArgs();
    expect(calls.length).toBe(2);
    expect(calls[0]).not.toContain("--cookies");
    const i = calls[1].indexOf("--cookies");
    expect(i).toBeGreaterThan(-1);
    expect(calls[1][i + 1]).toBe(ck);
  });

  it("budget session épuisé (50/h) → session_quota, AUCUN appel avec cookies", async () => {
    const ck = path.join(fakeDir, "cookies.txt");
    fs.writeFileSync(ck, "# Netscape HTTP Cookie File\n");
    process.env.NEBULA_YTDLP_COOKIES = ck;
    process.env.FAKE_MODE = "signin";
    __setCookieDownloadsForTests(Array.from({ length: 50 }, (_, i) => Date.now() - i * 1000));
    expect(cookieDownloadsUsed()).toBe(50);
    const r = await ytmViaYtDlp("https://youtu.be/dQw4w9WgXcQ", 60 * 1024 * 1024);
    expect(r).toMatchObject({ ok: false, reason: "session_quota" });
    const calls = readLoggedArgs();
    expect(calls.length).toBe(1); // l'anonyme seul — pas de retry authentifié
    expect(calls[0]).not.toContain("--cookies");
  });

  it("cookieDownloadsUsed : fenêtre glissante d'une heure", () => {
    const now = 10_000_000;
    __setCookieDownloadsForTests([now - 3_600_001, now - 3_599_999, now - 60_000]);
    expect(cookieDownloadsUsed(now)).toBe(2); // le plus vieux est tombé
    expect(cookieDownloadsUsed(now + 3_600_000)).toBe(0); // tous tombés
  });

  it("ytvideo.ts et song.ts : refus honnête sur session_quota", () => {
    const ytv = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/ytvideo.ts"), "utf-8");
    const song = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/song.ts"), "utf-8");
    expect(ytv).toContain('local.reason === "session_quota"');
    expect(song).toContain('local.reason === "session_quota"');
  });

  it("manage.sh : nebula update met yt-dlp à jour (self-update non fatal)", () => {
    const sh = fs.readFileSync(path.resolve(process.cwd(), "manage.sh"), "utf-8");
    expect(sh).toContain("yt-dlp -U");
  });
});

// ── 9.10 : pistes audio, sous-titres, playlists ─────────────────────────────
describe("9.10 — sonde YouTube (pistes audio, sous-titres, playlists)", () => {
  it("canonicalPlaylistUrl / isPlaylistLink : canonisation et détection (anti-injection)", () => {
    expect(isPlaylistLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc1234567890xyz")).toBe(true);
    expect(isPlaylistLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(canonicalPlaylistUrl("https://youtu.be/dQw4w9WgXcQ?list=PLabc1234567890xyz"))
      .toBe("https://www.youtube.com/playlist?list=PLabc1234567890xyz");
    expect(canonicalPlaylistUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("sonde vidéo : langues audio (doublages) + sous-titres manuels puis auto", async () => {
    process.env.FAKE_MODE = "json-video";
    const p = await probeYoutubeEntry("https://youtu.be/dQw4w9WgXcQ");
    expect(p.ok).toBe(true);
    expect(p.isPlaylist).toBe(false);
    expect(p.title).toBe("Film VF");
    expect(p.audioLanguages).toEqual(["fr-fr", "ja"]);
    expect(p.subtitleLanguages).toEqual(["fr", "auto:en"]);
  });

  it("sonde playlist (flat) : titre, nombre, IDs dans l'ordre", async () => {
    process.env.FAKE_MODE = "json-playlist";
    const p = await probeYoutubeEntry("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc1234567890xyz");
    expect(p.ok).toBe(true);
    expect(p.isPlaylist).toBe(true);
    expect(p.playlistTitle).toBe("Ma Playlist");
    expect(p.playlistCount).toBe(3);
    expect(p.entryIds).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]);
  });

  it("sonde en échec → ok:false (dégradation honnête, jamais d'exception)", async () => {
    process.env.FAKE_MODE = "fail";
    const p = await probeYoutubeEntry("https://youtu.be/dQw4w9WgXcQ");
    expect(p.ok).toBe(false);
  });

  it("ytvFormatSpecWithAudio : la langue demandée en tête, sélecteur 9.6 en repli", () => {
    expect(ytvFormatSpecWithAudio("720", "fr"))
      .toBe(`bv*[vcodec^=avc1][height<=720]+ba[language^=fr][acodec^=mp4a]/${ytvFormatSpec("720")}`);
    expect(ytvFormatSpecWithAudio("480")).toBe(ytvFormatSpec("480"));
  });

  it("ytv avec piste audio + sous-titres : les args portent langue, --sub-langs et --embed-subs", async () => {
    process.env.FAKE_EXT = "mp4";
    const r = await ytvViaYtDlp("https://youtu.be/dQw4w9WgXcQ", "720", 100 * 1024 * 1024, {
      audioLang: "fr", subs: { lang: "fr", auto: false }
    });
    const args = readLoggedArgs().at(-1) as string[];
    const i = args.indexOf("-f");
    expect(args[i + 1]).toBe(ytvFormatSpecWithAudio("720", "fr"));
    expect(args).toContain("--write-subs");
    expect(args).toContain("--embed-subs");
    expect(args[args.indexOf("--sub-langs") + 1]).toBe("fr");
    if (r.ok) fs.rmSync(path.dirname(r.filePath), { recursive: true, force: true });
  });

  it("sous-titres AUTOMATIQUES → --write-auto-subs (pas --write-subs)", async () => {
    process.env.FAKE_EXT = "mp4";
    const r = await ytvViaYtDlp("https://youtu.be/dQw4w9WgXcQ", "720", 100 * 1024 * 1024, {
      subs: { lang: "en", auto: true }
    });
    const args = readLoggedArgs().at(-1) as string[];
    expect(args).toContain("--write-auto-subs");
    expect(args).not.toContain("--write-subs");
    if (r.ok) fs.rmSync(path.dirname(r.filePath), { recursive: true, force: true });
  });
});

describe("9.10 — helpers .ytv (purs)", () => {
  it("parseYtvArgs : qualité, vo, langue connue, playlist/video — les mots inconnus restent", () => {
    expect(parseYtvArgs(["un", "test", "720"])).toEqual({ quality: "720", searchQuery: "un test", audioToken: undefined, forceMode: undefined });
    expect(parseYtvArgs(["<lien>", "vo", "1080p"])).toMatchObject({ quality: "1080", audioToken: "vo" });
    expect(parseYtvArgs(["<lien>", "ja"])).toMatchObject({ audioToken: "ja" });
    expect(parseYtvArgs(["<lien>", "playlist"])).toMatchObject({ forceMode: "playlist" });
    expect(parseYtvArgs(["<lien>", "video", "480"])).toMatchObject({ forceMode: "video", quality: "480" });
    // un mot de 2 lettres inconnu n'est PAS mangé comme langue
    expect(parseYtvArgs(["ok", "go"])).toMatchObject({ searchQuery: "ok go", audioToken: undefined });
  });

  it("pickSubtitles : FR manuel > FR auto > EN manuel > EN auto > aucun", () => {
    expect(pickSubtitles(["en", "fr"])).toEqual({ lang: "fr", auto: false });
    expect(pickSubtitles(["auto:fr", "en"])).toEqual({ lang: "fr", auto: true });
    expect(pickSubtitles(["en", "de"])).toEqual({ lang: "en", auto: false });
    expect(pickSubtitles(["auto:en"])).toEqual({ lang: "en", auto: true });
    expect(pickSubtitles(["de", "auto:es"])).toBeNull();
    expect(pickSubtitles([])).toBeNull();
  });

  it("defaultAudioLanguage : FR si doublage FR, sinon piste principale (undefined)", () => {
    expect(defaultAudioLanguage(["fr-fr", "ja"])).toBe("fr");
    expect(defaultAudioLanguage(["ja", "en"])).toBeUndefined();
    expect(defaultAudioLanguage(["fr"])).toBeUndefined(); // une seule piste : rien à choisir
    expect(defaultAudioLanguage([])).toBeUndefined();
  });
});

describe("wiring 9.10 (ytvideo)", () => {
  const readSrc = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf-8");

  it("playlist : max 25, garde 2 Go, page HTML, ZIP optionnel, choix vidéo/playlist", () => {
    const src = readSrc("src/bot/commands/ytvideo.ts");
    expect(src).toContain("MAX_PLAYLIST_VIDEOS = 25");
    expect(src).toContain("MAX_PLAYLIST_TOTAL_MB = 2000");
    expect(src).toContain("buildDownloadPage");
    expect(src).toContain("BatchZipManager.packageEpisodes");
    expect(src).toContain("NEBULA_BATCH_ZIP");
    expect(src).toContain("Cette vidéo seule");
  });

  it("choix en attente : écrans 1/2 (mode) et n° de piste (audio), TTL 3 min", () => {
    const src = readSrc("src/bot/commands/ytvideo.ts");
    expect(src).toContain('kind: "mode"');
    expect(src).toContain('kind: "audio"');
    expect(src).toContain("PENDING_TTL_MS = 3 * 60 * 1000");
  });

  it("fiche agent : la ligne .ytv documente playlists + piste audio + sous-titres (8.42)", () => {
    const src = readSrc("src/bot/commandKnowledge.ts");
    expect(src).toContain("playlist → \\`<lien> playlist\\`");
    expect(src).toContain("piste audio → \\`vo\\`");
    expect(src).toContain("sous-titres FR auto");
    expect(src).toContain("la vidéo ou la playlist YouTube Z"); // intention naturelle
  });
});

// ── Intégration structurelle dans les commandes (style audit 8.84) ────────
describe("8.86 — branchement : yt-dlp en PREMIER, API tierces en secours", () => {
  const readSrc = (f: string): string =>
    fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands", f), "utf8");

  it("song.ts : ytmViaYtDlp est tenté AVANT la cascade AUDIO_APIS", () => {
    const src = readSrc("song.ts");
    const ytDlpPos = src.indexOf("await ytmViaYtDlp(videoUrl");
    const cascadePos = src.indexOf("for (const api of AUDIO_APIS)");
    expect(ytDlpPos).toBeGreaterThan(0);
    expect(cascadePos).toBeGreaterThan(0);
    expect(ytDlpPos).toBeLessThan(cascadePos);
  });

  it("ytvideo.ts : ytvViaYtDlp est tenté AVANT la cascade VIDEO_APIS", () => {
    const src = readSrc("ytvideo.ts");
    const ytDlpPos = src.indexOf("await ytvViaYtDlp(videoUrl");
    const cascadePos = src.indexOf("for (const api of VIDEO_APIS)");
    expect(ytDlpPos).toBeGreaterThan(0);
    expect(cascadePos).toBeGreaterThan(0);
    expect(ytDlpPos).toBeLessThan(cascadePos);
  });

  it("song.ts et ytvideo.ts : importent activeCookiesFile et gèrent signin (message cookies)", () => {
    const song = readSrc("song.ts");
    const ytv = readSrc("ytvideo.ts");
    expect(song).toContain("activeCookiesFile");
    expect(song).toContain('local.reason === "signin"');
    expect(ytv).toContain("activeCookiesFile");
    expect(ytv).toContain('local.reason === "signin"');
  });

  it("ytvideo.ts : le fichier local est purgé en finally (envoi par chemin)", () => {
    const src = readSrc("ytvideo.ts");
    expect(src).toContain("let videoPath: string | null = null");
    expect(src).toContain("video: { url: mediaUrl }");
    expect(src).toMatch(/finally\s*\{[\s\S]*rmSync\(path\.dirname\(videoPath\)/);
  });
});
