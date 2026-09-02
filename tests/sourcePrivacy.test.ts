import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Source-privacy guard (audit 8.42, owner requirement 2026-09-01).
 *
 * The anime source catalog (nakanime / voiranime / franime / anime-sama) is
 * PRIVATE: the bot must NEVER mention those names in anything it sends to
 * users — WhatsApp messages, panel UI, served HTML, filenames, captions.
 *
 * This test scans every string literal of every runtime surface
 * (all .ts/.tsx under src, plus app.ts and server.ts) and fails if one of the names shows
 * up outside the explicitly allowed internal contexts:
 *  - console.* log lines (VPS-side diagnostics, never sent)
 *  - URL/regex builders ("${ORIGIN}/...", "^${...}", https://...)
 *  - a short exact allowlist of internal constants (SSRF host allowlists,
 *    cache file names, internal error texts that are logged, never replied)
 */

const PRIVATE_NAME_RE = /nakanime|voiranime|franime|anime[- ]?sama/i;

const INTERNAL_EXACT_ALLOWLIST = new Set([
  "nakanime.tv", // origin constant (nakanimeClient)
  "franime:", // session url prefix (internal key, never displayed)
  "franime-catalog.json", // cache file name on disk
  "franime catalog came back empty" // internal Error text, logged only
]);

const FILE_ALLOWLIST = new Set([
  // SSRF host allowlists — security config, not user output
  "src/bot/urlSafety.ts"
]);

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[\s,{;[(])\/\/[^\n]*/g, "$1");
}

interface Hit {
  file: string;
  line: number;
  literal: string;
}

/** All string literals containing a private source name, outside allowed internal contexts. */
export function findPrivateSourceMentions(roots: string[]): Hit[] {
  const hits: Hit[] = [];
  const files = roots
    .flatMap(root => (fs.existsSync(root) && fs.statSync(root).isDirectory() ? listSourceFiles(root) : [root]))
    .filter(f => fs.existsSync(f));
  const seen = new Set<string>();

  for (const file of files) {
    const rel = path.normalize(file);
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (FILE_ALLOWLIST.has(rel.split(path.sep).join("/"))) continue;

    const raw = fs.readFileSync(file, "utf-8");
    const code = stripComments(raw);
    const lines = code.split("\n");
    const lineOf = (idx: number) => code.slice(0, idx).split("\n").length;

    const patterns = [/"((?:[^"\\\n]|\\.)*)"/g, /'((?:[^'\\\n]|\\.)*)'/g, /`((?:[^`\\]|\\.)*)`/gs];
    for (const re of patterns) {
      for (const m of code.matchAll(re)) {
        const lit = m[1];
        if (!PRIVATE_NAME_RE.test(lit)) continue;

        // whole-line URL/origin templates and regex builders are internal
        if (lit.includes("https://") || lit.startsWith("${") || lit.startsWith("^${")) continue;
        if (INTERNAL_EXACT_ALLOWLIST.has(lit)) continue;
        // ES module specifiers are internal wiring, not output
        if (/\.js$/.test(lit)) continue;
        // internal session-url keys ("franime:<id>") — opaque ids, never displayed
        if (/^franime:\$/.test(lit)) continue;

        // console.* diagnostics: the statement the literal starts on is a log
        const line = lines[lineOf(m.index!) - 1] ?? "";
        if (/console\.(log|warn|error|info|debug|trace)\(/.test(line)) continue;

        hits.push({ file: rel, line: lineOf(m.index!), literal: lit.trim().slice(0, 120) });
      }
    }
  }
  return hits;
}

describe("source privacy — the bot never mentions private anime sources (8.42)", () => {
  it("runtime surfaces contain zero user-facing private source mentions", () => {
    const hits = findPrivateSourceMentions([
      "src/bot/commands",
      "src/bot/services",
      "src/bot/components",
      "src/components",
      "src/bot",
      "src",
      "app.ts",
      "server.ts"
    ]);
    expect(
      hits,
      `Private source names leaked into user-facing strings:\n${hits.map(h => `${h.file}:${h.line} → "${h.literal}"`).join("\n")}`
    ).toEqual([]);
  });

  it("scanner self-check: flags a reply string, allows logs and URL builders", () => {
    const tmp = path.join(__dirname, ".privacy-selfcheck");
    fs.mkdirSync(tmp, { recursive: true });
    const f = path.join(tmp, "selfcheck.ts");
    fs.writeFileSync(
      f,
      [
        `console.log("[X] voiranime path ok");`,
        `const url = \`${"${ORIGIN}"}/api/\`;`,
        `const bad = "Bienvenue sur nakanime !";`,
        `const reply = ctx.reply("VF indisponible: franime.fr bloque tout");`
      ].join("\n")
    );
    const hits = findPrivateSourceMentions([f]);
    expect(hits.length).toBe(2);
    expect(hits[0].literal).toContain("Bienvenue sur nakanime");
    expect(hits[1].literal).toContain("franime.fr");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
