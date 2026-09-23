import { GoogleGenAI } from "@google/genai";
import { isNimConfigured, nimChat } from "./nimClient.js";

// Delay helper for exponential backoff
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * True when at least one AI engine is usable (Gemini primary, NVIDIA NIM
 * fallback — audit 8.35). Callers gating AI features should use this instead
 * of reading GEMINI_API_KEY directly.
 */
export function isAIConfigured(): boolean {
  return getAIClient() !== null || isNimConfigured();
}

/**
 * NIM is text-only (audit 8.35 scope): collapse a multimodal Gemini prompt
 * (string or parts array) into plain text. Image parts are dropped — the
 * fallback serves text questions, not vision.
 */
function toTextPrompt(prompt: string | any[]): string {
  if (typeof prompt === "string") return prompt;
  return (Array.isArray(prompt) ? prompt : [prompt])
    .map((part: any) => (typeof part === "string" ? part : part?.text || ""))
    .filter(Boolean)
    .join("\n");
}

/** NIM fallback wrapper: skips cleanly when the prompt has no text at all. */
async function nimFallback(prompt: string | any[], systemInstruction?: string): Promise<string> {
  const text = toTextPrompt(prompt);
  if (!text.trim()) {
    throw new Error("Textless (image-only) prompt — the NVIDIA fallback is text-only.");
  }
  return nimChat(text, systemInstruction);
}

/**
 * Creates an instance of GoogleGenAI using the server's GEMINI_API_KEY
 */
export function getAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.trim() === "") {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

/**
 * 8.73: configurable engine order for text prompts (NEBULA_AI_PRIMARY).
 * "gemini" (default) or "nim". Vision prompts (image parts) always go to
 * Gemini first — NIM is text-only.
 */
export function getPrimaryAIEngine(): "gemini" | "nim" {
  return String(process.env.NEBULA_AI_PRIMARY || "")
    .trim()
    .toLowerCase() === "nim" ? "nim" : "gemini";
}

/** True when the prompt carries image parts (NIM cannot see images). */
function promptHasImageParts(prompt: string | any[]): boolean {
  if (typeof prompt === "string") return false;
  const parts = Array.isArray(prompt) ? prompt : [prompt];
  return parts.some(
    (part: any) => typeof part !== "string" && (part?.inlineData || part?.fileData)
  );
}

/**
 * Robust wrapper for text generation with retry mechanism and model fallbacks.
 * Throws when every model failed, so callers can render a truthful error.
 */
export async function generateTextWithFallback(
  prompt: string | any[],
  systemInstruction?: string,
  preferredModel = "gemini-3.7-flash"
): Promise<string> {
  const ai = getAIClient();
  if (!ai) {
    // Primary engine unconfigured — the NVIDIA fallback can carry the request.
    if (isNimConfigured()) {
      console.log("🤖 [AI Engine] Gemini not configured — answering via NVIDIA NIM.");
      return await nimFallback(prompt, systemInstruction);
    }
    throw new Error("No AI engine configured. Please add GEMINI_API_KEY or NVIDIA_NIM_API_KEY in Settings > Secrets.");
  }

  // 8.73: engine order. NIM primary (text only) is tried first when
  // configured; on failure the Gemini chain below takes over (and the final
  // NIM rescue may retry it once). Vision prompts always start at Gemini.
  const primaryEngine = getPrimaryAIEngine();
  const hasImageParts = promptHasImageParts(prompt);
  if (primaryEngine === "nim" && !hasImageParts) {
    if (isNimConfigured()) {
      console.log("🤖 [AI Engine] NVIDIA NIM primary (NEBULA_AI_PRIMARY=nim).");
      try {
        return await nimFallback(prompt, systemInstruction);
      } catch (nimErr: any) {
        console.log(`🤖 [AI Engine] NIM primary failed (${nimErr?.message || nimErr}) — falling back to Gemini.`);
      }
    } else {
      console.log("🤖 [AI Engine] NEBULA_AI_PRIMARY=nim but NIM is not configured — using Gemini.");
    }
  } else if (primaryEngine === "nim" && hasImageParts) {
    console.log("🤖 [AI Engine] Vision prompt — routed to Gemini first (NIM is text-only).");
  }

  // List of models to try in sequence if a transient error (503/429) occurs
  const modelCandidates = [preferredModel, "gemini-3.5-flash", "gemini-3.1-flash-lite"];

  // Dedup models to keep preferred first
  const modelsToTry = Array.from(new Set(modelCandidates));

  // 8.72: PHASE BUDGET. Production log 2026-09-23: a busy Gemini day made
  // every attempt take ~7s; 3 models x 3 attempts ate the whole outer 60s
  // race (withAIConcurrency) and the request died BEFORE the NVIDIA NIM
  // fallback was ever reached ("AI request timed out", zero NIM calls).
  // The Gemini phase now gets a bounded budget (default 25s, env-tunable)
  // and every SDK call a per-request timeout, so one hanging model cannot
  // starve the fallback engine. NIM then gets the rest of the outer race.
  const phaseBudgetMs = Math.max(
    1_000,
    Number(process.env.NEBULA_AI_GEMINI_BUDGET_MS) || 25_000
  );
  const phaseDeadline = Date.now() + phaseBudgetMs;
  const CALL_TIMEOUT_MS = 10_000;

  let lastError: any = null;
  let budgetSpent = false;

  for (const model of modelsToTry) {
    if (budgetSpent) break;
    let retries = 2;
    while (retries >= 0) {
      if (Date.now() >= phaseDeadline) {
        console.log(`🤖 [Gemini Engine] Phase budget spent (${phaseBudgetMs}ms) — moving on to the fallback engine.`);
        budgetSpent = true;
        break;
      }
      try {
        console.log(`🤖 [Gemini Engine] Attempting query with model [${model}]...`);
        const response = await ai.models.generateContent({
          model: model,
          contents: prompt,
          config: {
            ...(systemInstruction ? { systemInstruction } : {}),
            httpOptions: { timeout: CALL_TIMEOUT_MS }
          }
        });

        if (response && response.text) {
          return response.text.trim();
        }
        // 8.72: an empty-but-successful response used to re-loop the SAME
        // model forever (retries never decremented) until the outer race
        // killed it. Move to the next model instead.
        console.log(`🤖 [Gemini Engine] Model [${model}] returned an empty response — trying the next model...`);
        break;
      } catch (err: any) {
        lastError = err;
        const errMessage = err?.message || String(err);
        const isTransient = errMessage.includes("503") ||
                            errMessage.includes("UNAVAILABLE") ||
                            errMessage.includes("429") ||
                            errMessage.includes("quota") ||
                            errMessage.includes("RESOURCE_EXHAUSTED") ||
                            errMessage.includes("high demand");

        if (isTransient && retries > 0 && Date.now() < phaseDeadline) {
          console.log(`🤖 [Gemini Engine] Model [${model}] temporarily busy. Retrying in 1s...`);
          await delay(1000);
          retries--;
        } else {
          // Break to try next fallback model
          console.log(`🤖 [Gemini Engine] Model [${model}] is busy. Re-routing request to fallback model...`);
          break;
        }
      }
    }
  }

  // All Gemini models failed — NVIDIA NIM rescue before surfacing an error.
  if (isNimConfigured()) {
    console.log("🤖 [AI Engine] Gemini exhausted — falling back to NVIDIA NIM.");
    try {
      return await nimFallback(prompt, systemInstruction);
    } catch (nimErr: any) {
      const combined = new Error(
        `Gemini unavailable: ${lastError?.message || String(lastError)} — NVIDIA fallback also failed: ${nimErr?.message || nimErr}`
      );
      (combined as any).cause = nimErr;
      throw combined;
    }
  }

  // All models failed — surface a truthful error instead of a canned message.
  const errMsg = lastError?.message || String(lastError);
  throw new Error(`Gemini API is currently unavailable: ${errMsg}`);
}
