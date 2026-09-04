import { describe, expect, it } from "vitest";
import fs from "fs";
import { getCommand, getCommands, initRegistry } from "../src/bot/commandRegistry.js";
import { formatYtResults } from "../src/bot/commands/ytsearch.js";

/**
 * 8.57 — owner-activated commands: `.tiktok`, `.instagram`, `.yts` must be
 * REGISTERED (the 8.49b lesson: a command file alone is invisible in the
 * production bundle) and the legacy muscle-memory aliases `.ytv` / `.ytm`
 * must resolve to the native video/download commands.
 */
describe("activated commands registration (8.57)", () => {
  it("registers tiktok, instagram and ytsearch with their aliases", async () => {
    await initRegistry();
    const names = getCommands().map(c => c.name.toLowerCase());
    expect(names).toContain("tiktok");
    expect(names).toContain("instagram");
    expect(names).toContain("ytsearch");
    expect(getCommand("tt")?.name).toBe("tiktok");
    expect(getCommand("ig")?.name).toBe("instagram");
    expect(getCommand("yts")?.name).toBe("ytsearch");
    expect(getCommand("yt")?.name).toBe("ytsearch");
  });

  it(".ytv resolves to the native video command, .ytm to download", async () => {
    await initRegistry();
    expect(getCommand("ytv")?.name).toBe("video");
    expect(getCommand("ytvid")?.name).toBe("video");
    expect(getCommand("ytm")?.name).toBe("download");
    expect(getCommand("yta")?.name).toBe("download");
  });

  it("tiktok/instagram delegate through the socialPlatforms module (restored, wired)", () => {
    const source = fs.readFileSync("src/bot/commands/tiktok.ts", "utf8");
    expect(source).toContain("executeSocialDownload");
    expect(fs.readFileSync("src/bot/commands/instagram.ts", "utf8")).toContain("executeSocialDownload");
    // and they are in the STATIC list (production bundle), not just on disk
    const registry = fs.readFileSync("src/bot/commandRegistry.ts", "utf8");
    expect(registry).toMatch(/tiktokCommand,/);
    expect(registry).toMatch(/instagramCommand,/);
    expect(registry).toMatch(/ytSearchCommand,/);
  });
});

describe("formatYtResults", () => {
  it("formats top results with absolute URLs, duration and channel", () => {
    const out = formatYtResults(
      [
        { title: "Gasolina", url: "/watch?v=abc", timestamp: "3:12", author: { name: "Kaaris" } },
        { title: "Sessa", url: "https://www.youtube.com/watch?v=def", duration: { timestamp: "2:45" } }
      ],
      "gasolina"
    );
    expect(out).toContain("🔎 *Résultats YouTube* pour « gasolina »");
    expect(out).toContain("https://www.youtube.com/watch?v=abc");
    expect(out).toContain("3:12");
    expect(out).toContain("Kaaris");
    expect(out).toContain("2:45");
    expect(out).toContain(".ytv <lien>");
  });

  it("limits to 5 results and says so honestly when empty", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, url: `/watch?v=v${i}` }));
    expect((formatYtResults(many, "x").match(/\*\d+\.\*/g) || []).length).toBe(5);
    expect(formatYtResults([], "x")).toContain("Aucun résultat YouTube");
    expect(formatYtResults([{ title: undefined, url: "/w" } as any], "x")).toContain("Aucun résultat YouTube");
  });
});
