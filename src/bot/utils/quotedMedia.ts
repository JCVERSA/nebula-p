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
  const quoted = messageContent?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return null;
  const unwrapped = unwrapLayers(quoted);
  if (!unwrapped) return null;
  const type = Object.keys(unwrapped).find(k => MEDIA_TYPES.includes(k));
  return type ? unwrapped : null;
}
