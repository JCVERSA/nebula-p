import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  __setYtDlpBinForTests,
  canonicalYoutubeUrl,
  runYtDlp,
  ytmViaYtDlp,
  ytvViaYtDlp
} from "../src/bot/services/ytDlp.js";

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
    "fs.appendFileSync(" + JSON.stringify(argsLog) + ", JSON.stringify(args) + '\\n');",
    "if (process.env.FAKE_MODE === 'fail') { console.error('boom'); process.exit(1); }",
    "if (process.env.FAKE_MODE === 'toobig') { console.error('File is larger than max-filesize'); process.exit(0); }",
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
});

afterEach(() => {
  __setYtDlpBinForTests(null);
  delete process.env.FAKE_MODE;
  delete process.env.FAKE_SIZE;
  delete process.env.FAKE_EXT;
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
    expect(r).toEqual({ ok: false, reason: "no_id" });
    expect(readLoggedArgs().length).toBe(callsBefore);
  });

  it("dépassement du plafond (post-contrôle) → too_large + purge", async () => {
    process.env.FAKE_SIZE = "5000";
    const before = nebulaTmpDirs();
    const r = await ytmViaYtDlp("https://youtu.be/dQw4w9WgXcQ", 4096);
    expect(r).toEqual({ ok: false, reason: "too_large" });
    expect(nebulaTmpDirs()).toEqual(before);
  });

  it("yt-dlp refuse lui-même la taille (stderr officiel) → too_large + purge", async () => {
    process.env.FAKE_MODE = "toobig";
    const before = nebulaTmpDirs();
    const r = await ytmViaYtDlp("https://youtu.be/dQw4w9WgXcQ", 60 * 1024 * 1024);
    expect(r).toEqual({ ok: false, reason: "too_large" });
    expect(nebulaTmpDirs()).toEqual(before);
  });

  it("échec du binaire → failed + purge (aucun fichier qui traîne)", async () => {
    process.env.FAKE_MODE = "fail";
    const before = nebulaTmpDirs();
    const r = await ytmViaYtDlp("https://youtu.be/dQw4w9WgXcQ", 60 * 1024 * 1024);
    expect(r).toEqual({ ok: false, reason: "failed" });
    expect(nebulaTmpDirs()).toEqual(before);
  });

  it("binaire absent → missing (dégradation propre vers la cascade API)", async () => {
    __setYtDlpBinForTests(null);
    const r = await ytmViaYtDlp("https://youtu.be/dQw4w9WgXcQ", 60 * 1024 * 1024);
    expect(r).toEqual({ ok: false, reason: "missing" });
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
    expect(args).toContain("bv*[height<=720]+ba/b[height<=720]");
    expect(args).toContain("--merge-output-format");
    expect(args[args.length - 1]).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("qualité invalide → repli 720p dans le sélecteur de formats", async () => {
    await ytvViaYtDlp("https://youtu.be/dQw4w9WgXcQ", "4320", 100 * 1024 * 1024);
    const args = readLoggedArgs().at(-1) as string[];
    expect(args).toContain("bv*[height<=720]+ba/b[height<=720]");
  });

  it("échec → failed et le fichier temporaire est purgé par le service", async () => {
    process.env.FAKE_MODE = "fail";
    const before = nebulaTmpDirs();
    const r = await ytvViaYtDlp("https://youtu.be/dQw4w9WgXcQ", "480", 100 * 1024 * 1024);
    expect(r).toEqual({ ok: false, reason: "failed" });
    expect(nebulaTmpDirs()).toEqual(before);
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

  it("ytvideo.ts : le fichier local est purgé en finally (envoi par chemin)", () => {
    const src = readSrc("ytvideo.ts");
    expect(src).toContain("let videoPath: string | null = null");
    expect(src).toContain("video: { url: mediaUrl }");
    expect(src).toMatch(/finally\s*\{[\s\S]*rmSync\(path\.dirname\(videoPath\)/);
  });
});
