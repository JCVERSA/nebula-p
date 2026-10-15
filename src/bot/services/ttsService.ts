import { spawn } from "child_process";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { resolvedFfmpegPath } from "../ffmpeg.js";
import { getAIClient } from "../geminiClient.js";
import { checkAIQuota, consumeAIQuota } from "../aiQuota.js";

/**
 * 9.18dd (P6, décision owner 15/10) — synthèse vocale (TTS) pour notes
 * vocales WhatsApp : « lis-moi ça » / `.tts <texte>`.
 *
 * Moteur : voix neuronales Microsoft Edge (msedge-tts, npm) — SANS clé API,
 * sans compte (le service « Lire à voix haute » d'Edge), flux WebSocket.
 * Voix fr-FF Denise (fr-FR-DeniseNeural). Risque assumé et ENCAPSULÉ :
 * si Microsoft change le service, cette seule pièce est touchée et la
 * commande répond honnêtement « voix indisponible » (jamais de crash,
 * même leçon que tikwm/igdl : dépendance tierce isolée derrière un module).
 *
 * Chaîne (9.18kk, retour owner 15/10 : « la voix Edge est trop TTS, pas
 * naturelle comme Gemini/ChatGPT ») :
 *   1. GEMINI TTS en PRIMAIRE — les voix naturelles type Gemini Live,
 *      via la clé GEMINI_API_KEY EXISTANTE (recherche 2026 : Gemini 3.1
 *      Flash TTS classé au-dessus d'ElevenLabs, Elo 1206 vs 1178 ; free
 *      tier). Sortie PCM 24 kHz → WAV en mémoire → ffmpeg ogg. Un appel
 *      TTS consomme 1 unité du quota IA (owner illimité depuis 9.18gg).
 *   2. EDGE HENRI en REPLI gratuit — si pas de clé, quota épuisé ou erreur
 *      (même pattern que generateTextWithFallback NIM→Gemini).
 *
 * Zéro fichier temporaire : tout en mémoire, borné par le cap de texte
 * (≈ 1 min d'audio max). Env (manage.sh ENV_KEYS) :
 *   NEBULA_TTS_MODEL (défaut gemini-3.1-flash-tts-preview — celle avec
 *   free tier ; repli possible : gemini-2.5-flash-preview-tts) et
 *   NEBULA_TTS_VOICE (défaut Charon, voix masculine informative ; ex
 *   Kore, Puck, Sulafat, Fenrir — 30 préconstruites, 90+ langues).
 */

// 9.18ii : Henri (masculine) — choix owner 15/10 (Denise avant).
const TTS_VOICE = "fr-FR-HenriNeural";
/** Cap du texte lu aloud — ~1 minute d'audio, cohérent avec .trad/.resume. */
export const TTS_MAX_TEXT_CHARS = 1000;
/** Minimum pour qu'il y ait quelque chose à lire. */
const TTS_MIN_TEXT_CHARS = 2;
/** Transcodage ffmpeg borné — un texte capé ne peut pas dériver. */
const FFMPEG_TIMEOUT_MS = 60_000;

/**
 * Nettoie un texte pour la lecture à voix haute : retire le formatage
 * WhatsApp (* _ ~ `), les emojis parasites de markdown et normalise les
 * espaces. Pur — le reste du pipeline (et les tests) s'appuie dessus.
 */
export function sanitizeTtsText(raw: string): string {
  let t = String(raw || "");
  // Formatage WhatsApp : *gras*, _italique_, ~barré~, `monospace`.
  t = t.replace(/(\*+|_+|~+|`+)/g, " ");
  // Liens bruts : la voix lirait « h t t p s deux points slash slash » —
  // on garde le domaine lisible seulement si le lien est seul ? Non : on
  // retire les URLs (le texte du message cité reste visible à l'écran).
  t = t.replace(/https?:\/\/\S+/gi, " ");
  // Espaces multiples / lignes → un seul espace (les pauses viennent de la
  // ponctuation, gardée intacte).
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

/** Validation pure : assez de matière, pas trop, après nettoyage. */
export function validateTtsText(raw: string): { ok: true; text: string } | { ok: false; reason: "empty" | "too_long" } {
  const t = sanitizeTtsText(raw);
  if (t.length < TTS_MIN_TEXT_CHARS) return { ok: false, reason: "empty" };
  if (t.length > TTS_MAX_TEXT_CHARS) return { ok: false, reason: "too_long" };
  return { ok: true, text: t };
}

/** Collecte un Readable en Buffer avec taille plafonnée (défense). */
async function collectCapped(stream: import("stream").Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > maxBytes) throw new Error("tts audio exceeds size cap");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** Voix Gemini TTS (env NEBULA_TTS_VOICE, défaut Charon — masculine informative). */
export function geminiTtsVoice(): string {
  const v = String(process.env.NEBULA_TTS_VOICE || "").trim();
  return /^[A-Za-z]+$/.test(v) ? v : "Charon";
}

/** Modèle Gemini TTS (env NEBULA_TTS_MODEL, défaut : celle avec free tier). */
export function geminiTtsModel(): string {
  const m = String(process.env.NEBULA_TTS_MODEL || "").trim();
  return /^gemini-[\w.-]+$/.test(m) ? m : "gemini-3.1-flash-tts-preview";
}

/**
 * PCM brut (16 bits, mono) → WAV : simple ajout de l'en-tête RIFF de 44
 * octets en mémoire. Pur — ffmpeg accepte le WAV nativement. sampleRate
 * lu du mimeType Gemini (audio/L16;codec=pcm;rate=24000) sinon 24 kHz.
 */
export function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.floor(sampleRate) : 24000;
  const bitsPerSample = 16;
  const channels = 1;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = rate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // taille du bloc fmt
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Synthèse Gemini TTS → WAV en mémoire (PCM extrait d'inlineData).
 * Aucune confiance : formes validées champ par champ, tout écart → throw
 * (le repli Edge prend le relais).
 */
async function geminiTtsToWav(text: string): Promise<Buffer> {
  const ai = getAIClient();
  if (!ai) throw new Error("Gemini non configuré");
  const response = await ai.models.generateContent({
    model: geminiTtsModel(),
    contents: text,
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiTtsVoice() } } },
      httpOptions: { timeout: 30_000 }
    }
  });
  const parts = (response as any)?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) throw new Error("réponse TTS sans candidat");
  for (const part of parts) {
    const data = part?.inlineData?.data;
    if (typeof data === "string" && data.length > 0) {
      const mime = String(part.inlineData.mimeType || "");
      const rate = /rate=(\d+)/.exec(mime)?.[1];
      const pcm = Buffer.from(data, "base64");
      if (pcm.length < 100) throw new Error("audio TTS vide");
      return pcmToWav(pcm, rate ? Number(rate) : 24000);
    }
  }
  throw new Error("réponse TTS sans audio");
}

/** Synthèse Edge → mp3 en mémoire. Aucun fichier disque. */
async function synthesizeMp3(text: string): Promise<Buffer> {
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 15_000, synthesisTimeoutMs: 60_000 });
  try {
    await tts.setMetadata(TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);
    // 24 kHz mono 48 kbit/s : 60 s ≈ 360 Ko — cap généreux à 8 Mo.
    return await collectCapped(audioStream, 8 * 1024 * 1024);
  } finally {
    try { tts.close(); } catch {}
  }
}

/** mp3 → ogg/opus 48 kHz mono (note vocale WhatsApp), tout en mémoire. */
async function transcodeToVoiceOgg(mp3: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(
      resolvedFfmpegPath,
      ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-c:a", "libopus", "-b:a", "48k", "-ar", "48000", "-ac", "1", "-f", "ogg", "pipe:1"],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    const chunks: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new Error("ffmpeg timeout"));
    }, FFMPEG_TIMEOUT_MS);
    proc.stdout.on("data", (d: Buffer) => chunks.push(d));
    proc.stderr.on("data", (d: Buffer) => { stderr = (stderr + d.toString()).slice(-2000); });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-300)}`));
    });
    proc.stdin.on("error", () => {}); // EPIPE si ffmpeg meurt tôt — géré par close
    proc.stdin.end(mp3);
  });
}

/**
 * Texte → note vocale ogg/opus prête à l'envoi (ptt). Chaîne Gemini TTS
 * (naturel, via la clé existante) → Edge Henri (gratuit). opts.sender :
 * clé de quota IA pour l'appel Gemini (owner illimité) — quota épuisé ou
 * absent → Edge directement, jamais de blocage. Échecs honnêtes : toute
 * erreur remonte à la commande qui explique, jamais de crash moteur.
 */
export async function synthesizeVoiceNote(rawText: string, opts: { sender?: string } = {}): Promise<Buffer> {
  const v = validateTtsText(rawText);
  if (!v.ok) throw new Error(v.reason === "empty" ? "rien à lire" : "texte trop long");

  // 1. Gemini TTS — voix naturelle (recherche 2026 : Gemini TTS > ElevenLabs
  //    en Elo ; free tier ; l'owner a déjà la clé).
  const geminiQuotaOk = !opts.sender || checkAIQuota(opts.sender).allowed;
  if (getAIClient() && geminiQuotaOk) {
    try {
      const wav = await geminiTtsToWav(v.text);
      const ogg = await transcodeToVoiceOgg(wav);
      if (opts.sender) consumeAIQuota(opts.sender); // après succès seulement
      console.log(`[TTS] 🎙️ voix Gemini (${geminiTtsVoice()}) — ${v.text.length} caractères`);
      return ogg;
    } catch (e: any) {
      console.warn(`[TTS] Gemini échoué (${String(e?.message || e).slice(0, 120)}) → repli Edge Henri`);
    }
  }

  // 2. Repli gratuit : Edge Henri.
  const mp3 = await synthesizeMp3(v.text);
  if (mp3.length === 0) throw new Error("réponse vocale vide");
  return transcodeToVoiceOgg(mp3);
}
