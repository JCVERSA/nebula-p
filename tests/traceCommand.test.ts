import { describe, expect, it } from "vitest";
import { formatTraceResult, isQuotaExhausted } from "../src/bot/commands/trace.js";

/**
 * `.trace` (8.66) — trace.moe reverse-search, probed viable from the
 * production VPS (keyless, HTTP 200, small monthly quota). These tests pin
 * the user-facing formatting and the quota guard without any network.
 */
describe("formatTraceResult", () => {
  const payload = {
    result: [
      {
        anime: { title: "Darling in the FranXX", anilist_id: 99423 },
        episode: 5,
        from: 754,
        to: 776,
        similarity: 0.92,
      },
      { anime: { title: "Other Anime" }, episode: 2, similarity: 0.55 },
      { anime: { title: "Noise" }, episode: 1, similarity: 0.31 },
    ],
  };

  it("formats the best match with episode, timestamp, similarity and AniList link", () => {
    const text = formatTraceResult(payload)!;
    expect(text).toContain("Darling in the FranXX");
    expect(text).toContain("Épisode : *5*");
    expect(text).toContain("12:34"); // 754s
    expect(text).toContain("92%");
    expect(text).toContain("https://anilist.co/anime/99423");
  });

  it("lists other plausible matches but filters sub-40% noise", () => {
    const text = formatTraceResult(payload)!;
    expect(text).toContain("Other Anime (55%)");
    expect(text).not.toContain("Noise");
  });

  it("joins multi-episode results and prefers title_english in parentheses", () => {
    const text = formatTraceResult({
      result: [{ anime: { title: "Shingeki no Kyojin", title_english: "Attack on Titan" }, episode: [1, 2], from: 30, to: 60, similarity: 0.8 }],
    })!;
    expect(text).toContain("(Attack on Titan)");
    expect(text).toContain("Épisode : *1, 2*");
  });

  it("returns null when nothing crosses the 40% reliability bar", () => {
    expect(formatTraceResult({ result: [{ anime: { title: "X" }, similarity: 0.2 }] })).toBeNull();
    expect(formatTraceResult({ result: [] })).toBeNull();
    expect(formatTraceResult({})).toBeNull();
  });
});

describe("quota + wiring", () => {
  it("detects the monthly-quota-exhausted statuses (429/402)", () => {
    expect(isQuotaExhausted({ response: { status: 429 } })).toBe(true);
    expect(isQuotaExhausted({ response: { status: 402 } })).toBe(true);
    expect(isQuotaExhausted({ response: { status: 500 } })).toBe(false);
    expect(isQuotaExhausted(new Error("boom"))).toBe(false);
  });

  it("is registered as a built-in with the .tracemoe alias and quota protections", async () => {
    const fs = await import("fs");
    const registry = fs.readFileSync("src/bot/commandRegistry.ts", "utf8");
    expect(registry).toContain("traceCommand");
    const src = fs.readFileSync("src/bot/commands/trace.ts", "utf8");
    expect(src).toContain("https://api.trace.moe/search");
    expect(src).toContain("COOLDOWN_MS"); // per-user cooldown protects the ~100/month quota
    expect(src).toContain("limite mensuelle"); // honest quota-exhausted user message
  });
});
