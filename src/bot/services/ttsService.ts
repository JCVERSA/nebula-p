import { spawn } from "child_process";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { resolvedFfmpegPath } from "../ffmpeg.js";

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
 * Chaîne : texte nettoyé → mp3 (Edge) → ffmpeg (libopus 48 kHz mono, ogg)
 * → note vocale WhatsApp (ptt). Zéro fichier temporaire : tout en mémoire,
 * borné par le cap de texte (≈ 1 min d'audio max). Aucun nouvel env.
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
 * Texte → note vocale ogg/opus prête à l'envoi (ptt). Échecs honnêtes :
 * toute erreur remonte à la commande qui explique (service voix ou
 * conversion), jamais de crash moteur.
 */
export async function synthesizeVoiceNote(rawText: string): Promise<Buffer> {
  const v = validateTtsText(rawText);
  if (!v.ok) throw new Error(v.reason === "empty" ? "rien à lire" : "texte trop long");
  const mp3 = await synthesizeMp3(v.text);
  if (mp3.length === 0) throw new Error("réponse vocale vide");
  return transcodeToVoiceOgg(mp3);
}
