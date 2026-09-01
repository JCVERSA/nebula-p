/**
 * Trace Moe client — identify an anime from a screenshot
 * (https://soruly.github.io/trace.moe-api/, no API key).
 *
 * Powers the `.trace` command (audit 8.22): the user sends or quotes an image
 * (or gives a direct image URL), we ask trace.moe for the closest scene and
 * reply with the anime, episode and timecode.
 *
 * Design constraints:
 * - Anonymous usage is rate limited (~1 req/s): one request per user action,
 *   `X-Trace-TTL: 3600` header to let trace.moe cache, 15 s timeout.
 * - Best-effort contract: every failure resolves to null — the command says
 *   "not found" instead of crashing.
 * - Image bytes go straight in the POST body (trace.moe accepts raw image/*);
 *   `anilistInfo=1` expands titles so we can show English/romaji names.
 */

export interface TraceMoeResult {
  anilistId?: number;
  malId?: number;
  titleEnglish?: string;
  titleRomaji?: string;
  titleNative?: string;
  episode?: number | number[] | null;
  fromSeconds?: number;
  similarity?: number; // 0..1
  sceneImageUrl?: string;
  videoUrl?: string;
  isAdult?: boolean;
}

export interface TraceMoeSearchOutcome {
  ok: boolean;
  results: TraceMoeResult[];
  error?: string;
}

const TRACE_BASE = "https://api.trace.moe/search";
const FETCH_TIMEOUT_MS = 15000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // trace.moe hard limit

function mapResult(r: any): TraceMoeResult {
  const anilist = r?.anilist && typeof r.anilist === "object" ? r.anilist : {};
  return {
    anilistId: typeof anilist.id === "number" ? anilist.id : undefined,
    malId: typeof anilist.idMal === "number" ? anilist.idMal : undefined,
    titleEnglish: anilist.title?.english || undefined,
    titleRomaji: anilist.title?.romaji || undefined,
    titleNative: anilist.title?.native || undefined,
    episode: Array.isArray(r?.episode)
      ? r.episode.filter((e: any) => typeof e === "number")
      : typeof r?.episode === "number"
        ? r.episode
        : null,
    fromSeconds: typeof r?.from === "number" ? r.from : undefined,
    similarity: typeof r?.similarity === "number" ? r.similarity : undefined,
    sceneImageUrl: r?.image || undefined,
    videoUrl: r?.video || undefined,
    isAdult: !!anilist.isAdult
  };
}

async function runSearch(url: string, init?: RequestInit): Promise<TraceMoeSearchOutcome> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "X-Trace-TTL": "3600", ...(init?.headers || {}) }
    });
    if (res.status === 429) {
      return { ok: false, results: [], error: "Trop de recherches d'affilée — réessaie dans quelques secondes." };
    }
    if (!res.ok) {
      console.warn(`[TRACE_MOE] HTTP ${res.status}`);
      return { ok: false, results: [], error: `Service indisponible (HTTP ${res.status}).` };
    }
    const payload: any = await res.json();
    if (payload?.error) {
      return { ok: false, results: [], error: String(payload.error) };
    }
    const results: TraceMoeResult[] = Array.isArray(payload?.result) ? payload.result.map(mapResult) : [];
    return { ok: true, results };
  } catch (err: any) {
    console.warn(`[TRACE_MOE] search failed: ${err?.message || err}`);
    return { ok: false, results: [], error: "Impossible de contacter trace.moe." };
  }
}

/** Identify from raw image bytes (JPEG/PNG/WebP). */
export async function searchByImageBuffer(buffer: Buffer): Promise<TraceMoeSearchOutcome> {
  if (!buffer || buffer.length === 0) {
    return { ok: false, results: [], error: "Image vide." };
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { ok: false, results: [], error: "Image trop lourde (max ~10 Mo)." };
  }
  return runSearch(`${TRACE_BASE}?anilistInfo=1`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array(buffer)
  });
}

/** Identify from a public image URL (fetched by trace.moe, not by us). */
export async function searchByImageUrl(imageUrl: string): Promise<TraceMoeSearchOutcome> {
  const url = (imageUrl || "").trim();
  if (!/^https?:\/\/\S+$/i.test(url)) {
    return { ok: false, results: [], error: "URL d'image invalide." };
  }
  return runSearch(`${TRACE_BASE}?anilistInfo=1&url=${encodeURIComponent(url)}`);
}

/** Highest-similarity match (trace.moe already sorts, but stay explicit). */
export function pickBestTrace(results: TraceMoeResult[]): TraceMoeResult | null {
  if (!results || results.length === 0) return null;
  return results.reduce((best, r) => ((r.similarity ?? 0) > (best.similarity ?? 0) ? r : best), results[0]!);
}

/** 95.3 → "1:35", 3675 → "1:01:15" */
export function formatTimestamp(totalSeconds?: number): string {
  if (typeof totalSeconds !== "number" || !isFinite(totalSeconds) || totalSeconds < 0) return "--:--";
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "Ép. 3" / "Ép. 3-4" / "Film" */
export function formatEpisode(episode?: number | number[] | null): string {
  if (Array.isArray(episode)) {
    if (episode.length === 0) return "Film";
    if (episode.length === 1) return `Ép. ${episode[0]}`;
    return `Ép. ${Math.min(...episode)}-${Math.max(...episode)}`;
  }
  if (typeof episode === "number" && episode > 0) return `Ép. ${episode}`;
  return "Film";
}

/** WhatsApp card (French labels). */
export function formatTraceCard(r: TraceMoeResult): string {
  const main = r.titleEnglish || r.titleRomaji || r.titleNative || "Anime inconnu";
  const alt = [r.titleRomaji, r.titleNative].filter((t) => t && t !== main).slice(0, 1);

  const lines: string[] = [];
  lines.push(`🎬 *${main}*`);
  if (alt.length > 0) lines.push(`🈶 _${alt[0]}_`);
  const meta: string[] = [`📺 ${formatEpisode(r.episode)}`];
  if (typeof r.fromSeconds === "number") meta.push(`⏱️ ${formatTimestamp(r.fromSeconds)}`);
  if (typeof r.similarity === "number") meta.push(`🎯 ${(r.similarity * 100).toFixed(1)} %`);
  lines.push(meta.join(" | "));
  if (r.isAdult) lines.push(`⚠️ _Contenu adulte_`);
  lines.push("");
  lines.push(`📥 Pour télécharger: \`.a ${main}\` (VF par défaut)`);
  if (r.anilistId) lines.push(`🔗 https://anilist.co/anime/${r.anilistId}`);
  lines.push(`🌌 _Nebula Bot · scène identifiée par trace.moe_`);

  return lines.join("\n").trim();
}
