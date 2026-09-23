import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * 8.72 — AI chain deadline. Production log 2026-09-23: a busy Gemini day
 * (every model 503) made the 3-models x 3-attempts loop eat the whole outer
 * 60s race (withAIConcurrency) — the request died with "AI request timed
 * out" and the NVIDIA NIM fallback was NEVER reached. The Gemini phase is
 * now budget-bound (NEBULA_AI_GEMINI_BUDGET_MS, default 25s) with a
 * per-request SDK timeout, guaranteeing the fallback engine gets its turn.
 */

// Simulated Gemini: no network — a client whose calls reject slowly (busy
// day) or resolve empty, switchable via globalThis.__genaiMode.
vi.mock("@google/genai", () => {
  const calls: any[] = [];
  return {
    GoogleGenAI: class {
      static calls = calls;
      models: { generateContent: (req: any) => Promise<any> };
      constructor() {
        this.models = {
          generateContent: (req: any) => {
            calls.push(req);
            const mode = (globalThis as any).__genaiMode || "busy";
            if (mode === "empty") {
              return Promise.resolve({ text: "" });
            }
            return new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("503 UNAVAILABLE — high demand")),
                25
              )
            );
          }
        };
      }
    }
  };
});

vi.mock("../src/bot/nimClient.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, nimChat: vi.fn() };
});

import { GoogleGenAI } from "@google/genai";
import { nimChat } from "../src/bot/nimClient.js";
import { generateTextWithFallback } from "../src/bot/geminiClient.js";

const nimChatMock = vi.mocked(nimChat);

beforeEach(() => {
  vi.clearAllMocks();
  (GoogleGenAI as any).calls.length = 0;
  (globalThis as any).__genaiMode = "busy";
  process.env.GEMINI_API_KEY = "test-key";
  process.env.NVIDIA_NIM_API_KEY = "nvapi-test-key";
  process.env.NEBULA_AI_GEMINI_BUDGET_MS = "1000"; // fast budget for tests
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.NVIDIA_NIM_API_KEY;
  delete process.env.NEBULA_AI_GEMINI_BUDGET_MS;
  delete (globalThis as any).__genaiMode;
});

describe("generateTextWithFallback — phase budget (8.72)", () => {
  it("a busy Gemini day reaches the NIM fallback within the budget, not the outer 60s race", async () => {
    nimChatMock.mockResolvedValue("Réponse NIM");
    const t0 = Date.now();

    const out = await generateTextWithFallback("question", "Tu es Nebula.");

    const elapsed = Date.now() - t0;
    expect(out).toBe("Réponse NIM");
    expect(nimChatMock).toHaveBeenCalledTimes(1);
    expect(nimChatMock).toHaveBeenCalledWith("question", "Tu es Nebula.");
    expect(elapsed).toBeLessThan(4_000); // bounded by the 1s budget, not the 60s race
  });

  it("every Gemini attempt carries a per-request timeout (httpOptions)", async () => {
    nimChatMock.mockResolvedValue("Réponse NIM");
    await generateTextWithFallback("q");
    const calls = (GoogleGenAI as any).calls as any[];
    expect(calls.length).toBeGreaterThan(0);
    for (const req of calls) {
      expect(req.config.httpOptions.timeout).toBeLessThanOrEqual(10_000);
    }
  });

  it("empty Gemini responses move to the next model instead of looping forever (8.72)", async () => {
    (globalThis as any).__genaiMode = "empty";
    nimChatMock.mockResolvedValue("Réponse NIM");
    const t0 = Date.now();

    const out = await generateTextWithFallback("q");

    expect(out).toBe("Réponse NIM");
    const calls = (GoogleGenAI as any).calls as any[];
    expect(calls.length).toBeLessThanOrEqual(3); // one per model, no infinite loop
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("the phase budget is documented and clamped (min 1s)", async () => {
    const fs = await import("fs");
    expect(fs.readFileSync(".env.example", "utf-8")).toContain("NEBULA_AI_GEMINI_BUDGET_MS");
    process.env.NEBULA_AI_GEMINI_BUDGET_MS = "1"; // below the 1s floor
    nimChatMock.mockResolvedValue("Réponse NIM");
    const t0 = Date.now();
    const out = await generateTextWithFallback("q");
    expect(out).toBe("Réponse NIM");
    // clamped to the 1s floor — the loop still terminates via budget/moves on
    expect(Date.now() - t0).toBeLessThan(8_000);
  });
});
