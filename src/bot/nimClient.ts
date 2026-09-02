import axios from "axios";

/**
 * NVIDIA NIM client (audit 8.35, 2026-09-01) — AI FALLBACK engine.
 *
 * Role (owner decision): Gemini stays the primary engine; NIM answers when
 * the Gemini key is absent, its quota is exhausted, or the API is down, so
 * `.ai` and the private-chat assistant keep working through provider outages.
 *
 * Protocol: plain OpenAI-compatible chat completions on
 * https://integrate.api.nvidia.com/v1 (same endpoint the free-claude-code
 * project uses). Free key: https://build.nvidia.com/settings/api-keys
 * (NVIDIA_NIM_API_KEY, "nvapi-…"). No new dependency: axios, already used
 * across the project.
 */

const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const NIM_DEFAULT_MODEL = "meta/llama-3.3-70b-instruct";

const NIM_PLACEHOLDERS = new Set(["", "MY_NVIDIA_API_KEY", "YOUR_API_KEY_HERE", "nvapi-xxx"]);

export function getNimApiKey(): string {
  return (process.env.NVIDIA_NIM_API_KEY || "").trim();
}

export function isNimConfigured(): boolean {
  const key = getNimApiKey();
  return key.length > 0 && !NIM_PLACEHOLDERS.has(key);
}

export function getNimModel(): string {
  return (process.env.NEBULA_NIM_MODEL || "").trim() || NIM_DEFAULT_MODEL;
}

export interface NimChatOptions {
  /** Dependency injection for tests: an axios-like post. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  post?: (url: string, body: unknown, config: any) => Promise<{ data: any }>;
  maxTokens?: number;
}

export interface NimChatRequestBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  top_p: number;
  max_tokens: number;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** True for transient failures worth one retry ( mirrors geminiClient policy). */
function isTransientNimError(err: any): boolean {
  const msg = String(err?.message || err || "");
  const status = Number(err?.response?.status) || 0;
  return status === 429 || status === 502 || status === 503 || status === 504 ||
    msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT") || msg.includes("timeout");
}

/**
 * Single-shot chat completion against NVIDIA NIM.
 * Throws a truthful error (status + message) when the API fails — callers
 * decide what to surface.
 */
export async function nimChat(
  prompt: string,
  systemInstruction?: string,
  options: NimChatOptions = {}
): Promise<string> {
  const apiKey = getNimApiKey();
  if (!apiKey || NIM_PLACEHOLDERS.has(apiKey)) {
    throw new Error("NVIDIA NIM API key is not configured (NVIDIA_NIM_API_KEY).");
  }

  const body: NimChatRequestBody = {
    model: getNimModel(),
    messages: [
      ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
      { role: "user", content: String(prompt) }
    ],
    // Sampling profile mirrors the fixed settings used by the NIM reference
    // integrations (nucleus sampling, moderate temperature).
    temperature: 0.6,
    top_p: 0.95,
    max_tokens: options.maxTokens ?? 2048
  };

  const post = options.post || ((url: string, b: unknown, cfg: any) => axios.post(url, b, cfg));
  const config = {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    timeout: 60_000
  };

  let lastError: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await post(`${NIM_BASE_URL}/chat/completions`, body, config);
      const content = response?.data?.choices?.[0]?.message?.content;
      if (typeof content === "string" && content.trim()) {
        return content.trim();
      }
      throw new Error("NIM returned an empty completion.");
    } catch (err: any) {
      lastError = err;
      if (attempt === 0 && isTransientNimError(err)) {
        console.log("🤖 [NVIDIA NIM] Transient failure — retrying in 1s…");
        await delay(1000);
        continue;
      }
      break;
    }
  }

  const status = lastError?.response?.status;
  const detail = lastError?.response?.data?.error?.message || lastError?.message || String(lastError);
  throw new Error(status ? `NVIDIA NIM error (HTTP ${status}): ${detail}` : `NVIDIA NIM error: ${detail}`);
}
