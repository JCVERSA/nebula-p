import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * 8.73 — configurable engine order (NEBULA_AI_PRIMARY=gemini|nim, default
 * gemini). NIM primary serves text prompts first; vision prompts (image
 * parts) ALWAYS go to Gemini first because NIM is text-only. A NIM-primary
 * failure falls back to the Gemini chain.
 */

vi.mock("@google/genai", () => {
  let calls = 0;
  return {
    GoogleGenAI: class {
      static get calls() { return calls; }
      static reset() { calls = 0; }
      models: { generateContent: (req: any) => Promise<any> };
      constructor() {
        this.models = {
          generateContent: () => {
            calls++;
            if ((globalThis as any).__geminiMode === "fail") {
              return Promise.reject(new Error("503 UNAVAILABLE — high demand"));
            }
            return Promise.resolve({ text: "Réponse Gemini" });
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
import { generateTextWithFallback, getPrimaryAIEngine } from "../src/bot/geminiClient.js";

const nimChatMock = vi.mocked(nimChat);

beforeEach(() => {
  vi.clearAllMocks();
  (GoogleGenAI as any).reset();
  (globalThis as any).__geminiMode = "ok";
  process.env.GEMINI_API_KEY = "test-key";
  process.env.NVIDIA_NIM_API_KEY = "nvapi-test-key";
  delete process.env.NEBULA_AI_PRIMARY;
  delete process.env.NEBULA_AI_GEMINI_BUDGET_MS;
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.NVIDIA_NIM_API_KEY;
  delete process.env.NEBULA_AI_PRIMARY;
  delete (globalThis as any).__geminiMode;
});

describe("getPrimaryAIEngine (8.73)", () => {
  it("defaults to gemini and only accepts 'nim'", () => {
    expect(getPrimaryAIEngine()).toBe("gemini");
    process.env.NEBULA_AI_PRIMARY = "nim";
    expect(getPrimaryAIEngine()).toBe("nim");
    process.env.NEBULA_AI_PRIMARY = "NIM";
    expect(getPrimaryAIEngine()).toBe("nim");
    process.env.NEBULA_AI_PRIMARY = "garbage";
    expect(getPrimaryAIEngine()).toBe("gemini");
  });
});

describe("generateTextWithFallback — engine order (8.73)", () => {
  it("default: Gemini answers, NIM untouched", async () => {
    const out = await generateTextWithFallback("question");
    expect(out).toBe("Réponse Gemini");
    expect((GoogleGenAI as any).calls).toBe(1);
    expect(nimChatMock).not.toHaveBeenCalled();
  });

  it("NEBULA_AI_PRIMARY=nim: NIM answers first, Gemini untouched", async () => {
    process.env.NEBULA_AI_PRIMARY = "nim";
    nimChatMock.mockResolvedValue("Réponse NIM");
    const out = await generateTextWithFallback("question");
    expect(out).toBe("Réponse NIM");
    expect(nimChatMock).toHaveBeenCalledTimes(1);
    expect((GoogleGenAI as any).calls).toBe(0);
  });

  it("NIM primary failure falls back to the Gemini chain", async () => {
    process.env.NEBULA_AI_PRIMARY = "nim";
    nimChatMock.mockRejectedValue(new Error("NVIDIA NIM error (HTTP 410): model retired"));
    const out = await generateTextWithFallback("question");
    expect(out).toBe("Réponse Gemini");
    expect((GoogleGenAI as any).calls).toBeGreaterThanOrEqual(1);
  });

  it("vision prompts always start at Gemini, even with NIM primary", async () => {
    process.env.NEBULA_AI_PRIMARY = "nim";
    nimChatMock.mockResolvedValue("Réponse NIM");
    const imagePrompt = [
      { inlineData: { data: "base64...", mimeType: "image/jpeg" } },
      { text: "Que vois-tu ?" }
    ];
    const out = await generateTextWithFallback(imagePrompt);
    expect(out).toBe("Réponse Gemini");
    expect((GoogleGenAI as any).calls).toBe(1);
    expect(nimChatMock).not.toHaveBeenCalled();
  });

  it("a busy Gemini day with NIM primary exhausted ends on the honest error", async () => {
    process.env.NEBULA_AI_PRIMARY = "nim";
    (globalThis as any).__geminiMode = "fail";
    process.env.NEBULA_AI_GEMINI_BUDGET_MS = "1000";
    nimChatMock.mockRejectedValue(new Error("NVIDIA NIM error (HTTP 410): model retired"));
    await expect(generateTextWithFallback("question")).rejects.toThrow();
    expect(nimChatMock).toHaveBeenCalled(); // primary tried
    expect((GoogleGenAI as any).calls).toBeGreaterThanOrEqual(1); // fallback tried
  });
});
