import { describe, expect, it } from "vitest";
import fs from "fs";
import { buildDownloadPage, DOWNLOAD_PAGE_PALETTE } from "../src/bot/services/downloadPage.js";

/**
 * Offline download page (audit 8.39, hardened by audit 8.41): one HTML
 * document instead of a wall of WhatsApp links — per-episode direct buttons
 * + sequential "download all", project palette, self-contained, everything
 * escaped, expired links detected via HEAD probe instead of navigating the
 * page to the server's 410 card.
 */

const ENTRIES = [
  { label: "Épisode 1", url: "https://bot.example.com/api/dl/token-aaa", sizeMB: 148.4 },
  { label: "Épisode 2", url: "https://bot.example.com/api/dl/token-bbb", sizeMB: 152 },
  { label: "Épisode 3 <script>alert(1)</script>", url: 'https://bot.example.com/api/dl/tok"en&x=1', sizeMB: 0 }
];

function build(expiresAt = Date.now() + 2 * 3600_000) {
  return buildDownloadPage({
    title: "Solo Leveling — Saison 2 & <fin>",
    subtitle: "VF · 720p · 3 épisodes prêts",
    entries: ENTRIES,
    expiresAt
  });
}

describe("downloadPage — content", () => {
  it("embeds every download URL and the sequential engine's URL list", () => {
    const html = build();
    for (const e of ENTRIES) {
      // attribute-escaped form must appear in the href list
      expect(html).toContain(e.url.replace(/&/g, "&amp;").replace(/"/g, "&quot;"));
    }
    expect(html).toMatch(/var urls = \["https:\/\/bot\.example\.com\/api\/dl\/token-aaa/);
  });

  it("escapes user-derived text (XSS-safe labels and title)", () => {
    const html = build();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Épisode 3 &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Solo Leveling — Saison 2 &amp; &lt;fin&gt;");
  });

  it("uses the project palette (zinc darks + amber primary)", () => {
    const html = build();
    expect(html).toContain(`--bg:${DOWNLOAD_PAGE_PALETTE.bg}`);
    expect(html).toContain(`--primary:${DOWNLOAD_PAGE_PALETTE.primary}`);
    expect(DOWNLOAD_PAGE_PALETTE.bg).toBe("#09090b");
    expect(DOWNLOAD_PAGE_PALETTE.primary).toBe("#f59e0b");
  });

  it("offers per-episode buttons with download + blank fallback and a Tout télécharger action", () => {
    const html = build();
    expect((html.match(/class="btn small"/g) || []).length).toBe(3);
    expect((html.match(/ download rel="noopener"/g) || []).length).toBe(3);
    expect((html.match(/target="_blank"/g) || []).length).toBe(3);
    expect(html).toContain('id="all"');
    expect(html).toContain("Tout télécharger");
  });

  it("shows totals, the live countdown hook and the Chrome permission hint", () => {
    const html = build();
    expect(html).toContain("<b>3</b> épisode(s)");
    expect(html).toContain("300 MB"); // 148.4 + 152 + 0
    expect(html).toContain('id="countdown"');
    expect(html).toContain("Autoriser");
  });

  it("omits the countdown entirely when no expiry is known (no 'expire dans —')", () => {
    const html = build(0);
    expect(html).not.toContain('id="countdown"');
    expect(html).not.toContain("expire dans");
    expect(html).toMatch(/var expiresAt = 0;/);
  });

  it("embeds the expiry timestamp for the countdown engine", () => {
    expect(build(Date.now() - 1000)).toMatch(/var expiresAt = \d+;/);
  });

  it("is self-contained: no external stylesheet, script or font", () => {
    const html = build();
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).not.toMatch(/src="https?:\/\/(?!bot\.example\.com)/);
    expect(html).not.toMatch(/@import|fonts\./);
  });

  it("stays a lightweight single file (< 16 KB)", () => {
    expect(build().length).toBeLessThan(16_384);
  });
});

describe("downloadPage — 8.41 hardening", () => {
  const HOSTILE = [
    { label: "Épisode 1", url: "https://bot.example.com/api/dl/ok1", sizeMB: 10 },
    {
      label: "Hostile",
      url: 'https://bot.example.com/api/dl/x?a=</script><script>alert("pwn")</script>&b=1',
      sizeMB: 10
    }
  ];

  function buildHostile() {
    return buildDownloadPage({ title: "Test", entries: HOSTILE, expiresAt: Date.now() + 3600_000 });
  }

  it("neutralizes a </script> breakout inside the embedded URL list", () => {
    const html = buildHostile();
    // exactly ONE closing script tag: the page's own
    expect((html.match(/<\/script>/g) || []).length).toBe(1);
    // the hostile payload is unicode-escaped inside the JSON literal
    expect(html).toContain("\\u003c/script\\u003e\\u003cscript\\u003e");
    expect(html).not.toContain('<script>alert("pwn")</script>');
  });

  it("probes links with HEAD (410/404 => honest expired state, page preserved)", () => {
    const html = buildHostile();
    expect(html).toContain('method: "HEAD"');
    expect(html).toContain("ev.preventDefault()"); // clicks never navigate the page away
    expect(html).toContain("expired"); // expired accounting for the download-all button
    expect(html).toContain("classList.add(failed");
    expect(html).toContain(".item.failed");
  });
});

describe("downloadPage — wiring", () => {
  it("novabox multi-episode delivery uses buildDownloadPage with a legacy fallback", () => {
    const src = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");
    expect(src).toContain("buildDownloadPage({");
    expect(src).toContain("pageDelivered");
    expect(src).toContain("legacy links message");
  });

  it("skips the HTML page when a season ZIP will be delivered (no double delivery)", () => {
    const src = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");
    expect(src).toContain("generatedLinks.length > 1 && !zipDownloadUrl");
  });

  it("tells the user when EVERY episode failed (no silent player-links-only message)", () => {
    const src = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");
    expect(src).toContain("failedEpisodeCount");
    expect(src).toContain("Download failed for all");
  });
});
