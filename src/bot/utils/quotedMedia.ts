/**
 * Quoted-media extraction (audit 8.48).
 *
 * `context.downloadMedia()` only sees the INVOKING message's own media, but
 * the natural WhatsApp UX for a media toolkit is "reply to a video with
 * `.m gif`" — the media then lives in the QUOTED message. This pure helper
 * unwraps the quoted message (including ephemeral/viewOnce wrappers) and
 * returns its media-bearing content, or null.
 */

export type MediaContent = Record<string, any>;

const MEDIA_TYPES = ["imageMessage", "videoMessage", "documentMessage", "audioMessage", "stickerMessage"];

function unwrapLayers(content: MediaContent | undefined | null): MediaContent | null {
  let cur = content;
  for (let i = 0; i < 5 && cur; i++) {
    if (cur.ephemeralMessage?.message) cur = cur.ephemeralMessage.message;
    else if (cur.viewOnceMessage?.message) cur = cur.viewOnceMessage.message;
    else if (cur.viewOnceMessageV2?.message) cur = cur.viewOnceMessageV2.message;
    else if (cur.documentWithCaptionMessage?.message) cur = cur.documentWithCaptionMessage.message;
    else return cur;
  }
  return cur || null;
}

/**
 * Returns the quoted message's media-bearing content when the quoted message
 * carries media, else null. Accepts the UNWRAPPED invoking-message content
 * (the same object botEngine derives its text from).
 */
export function extractQuotedMediaContent(messageContent: MediaContent | undefined | null): MediaContent | null {
  // 9.6b : tolère aussi un message ENCORE ENVELOPPÉ (ephemeral/viewOnce) —
  // défense en profondeur ; botEngine passe déjà le contenu déroulé, mais
  // un futur appelant ne devrait jamais retomber sur le bug prod.
  const invoking = unwrapLayers(messageContent) || messageContent;
  const quoted = invoking?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return null;
  const unwrapped = unwrapLayers(quoted);
  if (!unwrapped) return null;
  const type = Object.keys(unwrapped).find(k => MEDIA_TYPES.includes(k));
  return type ? unwrapped : null;
}

const MEDIA_LABELS: Record<string, string> = {
  imageMessage: "une image",
  videoMessage: "une vidéo",
  audioMessage: "un audio",
  documentMessage: "un document",
  stickerMessage: "un sticker",
};

export type MediaDescription = { what: string; how: "joint" | "reply" };

/**
 * 9.6b — describes the media a message carries, for the agent's context:
 * attached media (caption case) or quoted media (reply case). Returns null
 * when there is none. PURE — never touches the media content itself (the
 * AI only learns "une vidéo", never the file). Tolerates wrapper layers
 * on the invoking message (ephemeral/viewOnce). Tested unitarily.
 */
export function describeMessageMedia(
  messageContent: MediaContent | undefined | null
): MediaDescription | null {
  if (!messageContent || typeof messageContent !== "object") return null;
  const unwrapped = unwrapLayers(messageContent);
  if (!unwrapped) return null;
  const directKind = Object.keys(unwrapped).find(k => MEDIA_TYPES.includes(k));
  if (directKind) return { what: MEDIA_LABELS[directKind] || "un fichier", how: "joint" };
  const quoted = extractQuotedMediaContent(unwrapped);
  if (quoted) {
    const qk = Object.keys(quoted).find(k => MEDIA_TYPES.includes(k));
    if (qk) return { what: MEDIA_LABELS[qk] || "un fichier", how: "reply" };
  }
  return null;
}
