import { GoogleGenAI } from "@google/genai";

// Delay helper for exponential backoff
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    throw new Error("Gemini API key is not configured. Please add it in Settings > Secrets.");
  }

  // List of models to try in sequence if a transient error (503/429) occurs
  const modelCandidates = [preferredModel, "gemini-3.5-flash", "gemini-3.1-flash-lite"];

  // Dedup models to keep preferred first
  const modelsToTry = Array.from(new Set(modelCandidates));

  let lastError: any = null;

  for (const model of modelsToTry) {
    let retries = 2;
    while (retries >= 0) {
      try {
        console.log(`🤖 [Gemini Engine] Attempting query with model [${model}]...`);
        const response = await ai.models.generateContent({
          model: model,
          contents: prompt,
          config: systemInstruction ? { systemInstruction } : undefined,
        });

        if (response && response.text) {
          return response.text.trim();
        }
      } catch (err: any) {
        lastError = err;
        const errMessage = err?.message || String(err);
        const isTransient = errMessage.includes("503") ||
                            errMessage.includes("UNAVAILABLE") ||
                            errMessage.includes("429") ||
                            errMessage.includes("quota") ||
                            errMessage.includes("RESOURCE_EXHAUSTED") ||
                            errMessage.includes("high demand");

        if (isTransient && retries > 0) {
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

  // All models failed — surface a truthful error instead of a canned message.
  const errMsg = lastError?.message || String(lastError);
  throw new Error(`Gemini API is currently unavailable: ${errMsg}`);
}

/**
 * Robust image generation with retries, model fallbacks, and a flawless Pollinations AI backup
 */
export async function generateImageWithFallback(
  prompt: string,
  inputImageBase64?: string
): Promise<{ imageUrl: string; mode: "generated" | "edited" | "fallback" }> {
  const ai = getAIClient();

  if (ai) {
    // Try Gemini image generation first
    const imageModels = ["gemini-3.1-flash-image", "imagen-3.0-generate-002"];

    for (const model of imageModels) {
      try {
        console.log(`🎨 Attempting Gemini Image Generation with [${model}]...`);
        let response;

        if (inputImageBase64) {
          // Image editing mode
          response = await ai.models.generateContent({
            model: model,
            contents: {
              parts: [
                {
                  inlineData: {
                    data: inputImageBase64,
                    mimeType: "image/png"
                  }
                },
                {
                  text: prompt
                }
              ]
            },
            config: {
              imageConfig: {
                aspectRatio: "1:1",
                imageSize: "1K"
              }
            }
          });
        } else {
          // Text-to-image mode
          response = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: {
              imageConfig: {
                aspectRatio: "1:1",
                imageSize: "1K"
              }
            }
          });
        }

        let base64Data: string | null = null;
        if (response.candidates?.[0]?.content?.parts) {
          for (const part of response.candidates[0].content.parts) {
            if (part.inlineData && part.inlineData.data) {
              base64Data = part.inlineData.data;
              break;
            }
          }
        }

        if (base64Data) {
          return {
            imageUrl: `data:image/png;base64,${base64Data}`,
            mode: inputImageBase64 ? "edited" : "generated"
          };
        }
      } catch (err: any) {
        console.log(`🤖 [Gemini Engine] Image model [${model}] is busy. Re-routing...`);
      }
    }
  }

  // Failsafe backup: Pollinations AI is highly reliable, free, and incredibly fast!
  console.log("🌟 Gemini Image Service rate-limited or unavailable. Activating Pollinations AI high-fidelity fallback...");
  const encodedPrompt = encodeURIComponent(prompt);
  const fallbackUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;

  return {
    imageUrl: fallbackUrl,
    mode: "fallback"
  };
}
