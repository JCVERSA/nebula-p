import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * NVIDIA NIM fallback client (audit 8.35): OpenAI-compatible chat completions
 * on integrate.api.nvidia.com — no new dependency (axios), dependency-injected
 * post for tests. Gemini stays primary; NIM answers when Gemini is
 * unconfigured or exhausted.
 */

vi.mock("../src/bot/nimClient.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, nimChat: vi.fn() };
});

import {
  isNimConfigured,
  getNimModel,
  nimChat,
  NIM_DEFAULT_MODEL
} from "../src/bot/nimClient.js";
import { generateTextWithFallback, isAIConfigured } from "../src/bot/geminiClient.js";
import { isAllowedSecretName } from "../src/bot/secrets.js";

const nimChatMock = vi.mocked(nimChat);

function capturingPost(capture: any[], respondWith: (body: any) => any, failFirstTimes = 0) {
  let calls = 0;
  return async (url: string, body: unknown, config: any) => {
    capture.push({ url, body, config });
    if (calls++ < failFirstTimes) {
      const err: any = new Error("Request failed with status code 429");
      err.response = { status: 429 };
      throw err;
    }
    return respondWith(body);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NVIDIA_NIM_API_KEY = "nvapi-test-key-123456789";
  delete process.env.NEBULA_NIM_MODEL;
  delete process.env.GEMINI_API_KEY; // force the fallback path in integration tests
});

describe("nimClient — configuration", () => {
  it("detects a real key and rejects placeholders/absence", () => {
    expect(isNimConfigured()).toBe(true);
    for (const bad of ["", "MY_NVIDIA_API_KEY", "nvapi-xxx"]) {
      process.env.NVIDIA_NIM_API_KEY = bad;
      expect(isNimConfigured()).toBe(false);
    }
    delete process.env.NVIDIA_NIM_API_KEY;
    expect(isNimConfigured()).toBe(false);
  });

  it("default model is llama-3.3-70b, overridable via NEBULA_NIM_MODEL", () => {
    expect(NIM_DEFAULT_MODEL).toBe("meta/llama-3.3-70b-instruct");
    expect(getNimModel()).toBe(NIM_DEFAULT_MODEL);
    process.env.NEBULA_NIM_MODEL = "qwen/qwen3-235b-a22b";
    expect(getNimModel()).toBe("qwen/qwen3-235b-a22b");
  });

  it("NVIDIA_NIM_API_KEY is an allowed panel secret", () => {
    expect(isAllowedSecretName("NVIDIA_NIM_API_KEY")).toBe(true);
  });
});

describe("nimClient — chat completions", () => {
  // This file mocks the nimClient module for the geminiClient integration
  // tests below; re-bind the REAL implementation for these unit tests.
  beforeEach(async () => {
    const actual = await vi.importActual<any>("../src/bot/nimClient.js");
    nimChatMock.mockImplementation(actual.nimChat);
  });

  it("sends an OpenAI-compatible body (model, system+user, sampling) with the Bearer key", async () => {
    const capture: any[] = [];
    const post = capturingPost(capture, () => ({
      data: { choices: [{ message: { content: "  Bonjour !  " } }] }
    }));
    const out = await nimChat("Salut", "Tu es Nebula.", { post });
    expect(out).toBe("Bonjour !");
    expect(capture).toHaveLength(1);
    expect(capture[0].url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(capture[0].config.headers.Authorization).toBe("Bearer nvapi-test-key-123456789");
    expect(capture[0].body.model).toBe("meta/llama-3.3-70b-instruct");
    expect(capture[0].body.messages).toEqual([
      { role: "system", content: "Tu es Nebula." },
      { role: "user", content: "Salut" }
    ]);
    expect(capture[0].body.temperature).toBe(0.6);
    expect(capture[0].body.top_p).toBe(0.95);
  });

  it("retries once on transient 429 and succeeds", async () => {
    const capture: any[] = [];
    const post = capturingPost(capture, () => ({
      data: { choices: [{ message: { content: "OK après retry" } }] }
    }), 1);
    const out = await nimChat("q", undefined, { post });
    expect(out).toBe("OK après retry");
    expect(capture).toHaveLength(2);
  });

  it("surfaces a truthful error (HTTP status) on non-transient failures", async () => {
    const err: any = new Error("400");
    err.response = { status: 400, data: { error: { message: "invalid model" } } };
    const post = async () => { throw err; };
    await expect(nimChat("q", undefined, { post })).rejects.toThrow("HTTP 400");
  });

  it("rejects empty completions honestly", async () => {
    const post = async () => ({ data: { choices: [{ message: { content: "   " } }] } });
    await expect(nimChat("q", undefined, { post })).rejects.toThrow("empty completion");
  });

  it("throws when the key is missing", async () => {
    delete process.env.NVIDIA_NIM_API_KEY;
    await expect(nimChat("q", undefined, { post: async () => ({ data: {} }) }))
      .rejects.toThrow("not configured");
  });
});

describe("geminiClient — NVIDIA fallback integration", () => {
  it("routes to NIM when Gemini is not configured", async () => {
    nimChatMock.mockResolvedValue("Réponse via NIM");
    const out = await generateTextWithFallback("Question test");
    expect(out).toBe("Réponse via NIM");
    expect(nimChatMock).toHaveBeenCalledWith("Question test", undefined);
  });

  it("isAIConfigured reflects either engine", () => {
    expect(isAIConfigured()).toBe(true); // NIM key set in beforeEach
    delete process.env.NVIDIA_NIM_API_KEY;
    expect(isAIConfigured()).toBe(false);
    process.env.GEMINI_API_KEY = "test-key";
    expect(isAIConfigured()).toBe(true); // Gemini alone suffices
  });

  it("propagates a clear error when NIM (text-only) gets an image-only prompt", async () => {
    nimChatMock.mockImplementation(async () => {
      throw new Error("should not be called with no text");
    });
    await expect(
        generateTextWithFallback([{ inlineData: { data: "xxxx", mimeType: "image/png" } }])
    ).rejects.toThrow(/[Tt]extless/);
    expect(nimChatMock).not.toHaveBeenCalled();
  });
});
