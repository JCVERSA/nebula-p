import { describe, expect, it } from "vitest";
import fs from "fs";
import { buildDownloadPage, DOWNLOAD_PAGE_PALETTE } from "../src/bot/services/downloadPage.js";

/**
 * Offline download page (audit 8.39): one HTML document instead of a wall of
 * WhatsApp links — per-episode direct buttons + sequential "download all",
 * project palette, self-contained (no external asset), everything escaped.
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

  it("offers per-episode buttons with the download attribute and a Tout télécharger action", () => {
    const html = build();
    expect((html.match(/class="btn small"/g) || []).length).toBe(3);
    expect((html.match(/ download /g) || []).length).toBe(3);
    expect(html).toContain("id=\"all\"");
    expect(html).toContain("Tout télécharger");
  });

  it("shows totals, the live countdown hook and the Chrome permission hint", () => {
    const html = build();
    expect(html).toContain("<b>3</b> épisode(s)");
    expect(html).toContain("300 MB"); // 148.4 + 152 + 0
    expect(html).toContain("id=\"countdown\"");
    expect(html).toContain("Autoriser");
  });

  it("embeds the expiry timestamp; past expiry equips the expired banner class", () => {
    const future = build(Date.now() + 3600_000);
    expect(future).not.toContain("body.expired .all".replace("body.expired .all", "x-never")); // sanity
    expect(future).toContain("body.expired .all"); // css rule present
    const past = build(Date.now() - 1000);
    expect(past).toMatch(/var expiresAt = \d+;/);
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

describe("downloadPage — wiring", () => {
  it("novabox multi-episode delivery uses buildDownloadPage with a legacy fallback", () => {
    const src = fs.readFileSync("src/bot/commands/novabox.ts", "utf-8");
    expect(src).toContain("buildDownloadPage({");
    expect(src).toContain("pageDelivered");
    expect(src).toContain("legacy links message");
  });
});
