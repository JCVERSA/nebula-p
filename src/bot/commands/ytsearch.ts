import { BotCommand } from "../types.js";

/**
 * `.yts` — YouTube search (audit 8.57, owner request).
 *
 * Returns the top results (title + duration + link) so users can pick one,
 * then download with `.ytv <lien>` (video) or `.ytm <lien>` (audio).
 * Uses the ALREADY-PRESENT `yt-search` dependency (previously unused since
 * the legacy corpus removal) — zero new dependency. Dynamic import because
 * the package ships no TypeScript types; the shape below is the subset we
 * consume.
 */

interface YtVideo {
  title?: string;
  url?: string;
  timestamp?: string;
  duration?: { timestamp?: string };
  author?: { name?: string };
}

/** Pure formatter (exported for tests). */
export function formatYtResults(videos: YtVideo[], query: string, limit = 5): string {
  const top = videos.filter(v => v && v.title && v.url).slice(0, limit);
  if (top.length === 0) {
    return `❌ Aucun résultat YouTube pour « ${query} ». Vérifie l'orthographe ou essaie en anglais.`;
  }
  const lines = top.map((v, i) => {
    const url = v.url!.startsWith("http") ? v.url! : `https://www.youtube.com${v.url}`;
    const dur = v.timestamp || v.duration?.timestamp || "—";
    const chan = v.author?.name ? ` · ${v.author.name}` : "";
    return `*${i + 1}.* ${v.title}\n   ⏱️ ${dur}${chan}\n   🔗 ${url}`;
  });
  return (
    `🔎 *Résultats YouTube* pour « ${query} » :\n\n` +
    lines.join("\n\n") +
    `\n\n📥 Vidéo : \`.ytv <lien>\` · Audio : \`.ytm <lien>\``
  );
}

const ytSearchCommand: BotCommand = {
  name: "ytsearch",
  aliases: ["yts", "yt", "youtubelink", "recherche"],
  category: "Media",
  description: "Recherche YouTube : .yts <titre> → top résultats avec liens (.ytv/.ytm pour télécharger).",
  usage: "yts <recherche>",
  execute: async (_sock, _msg, context) => {
    const query = (context.args || []).join(" ").trim();
    if (!query) {
      return void (await context.reply(
        "🔎 *Recherche YouTube*\n\n*Usage:* `.yts <titre ou mots-clés>`\n*Exemple:* `.yts kaari sessa gasolina`\n\n_Ensuite:_ `.ytv <lien>` (vidéo) · `.ytm <lien>` (audio)"
      ));
    }
    await context.react("🔎");
    try {
      const mod = await import("yt-search");
      const yts = (mod as { default: (q: string) => Promise<{ videos?: YtVideo[] }> }).default;
      // Hard 20 s ceiling: yt-search has no built-in timeout and must never
      // hang a WhatsApp reply forever.
      const res = await Promise.race([
        yts(query),
        new Promise<{ videos?: YtVideo[] }>((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000))
      ]);
      await context.reply(formatYtResults(res.videos || [], query));
    } catch (err: any) {
      console.warn("[YTSEARCH] failed:", err?.message || err);
      await context.reply("❌ La recherche YouTube a échoué (blocage temporaire).\n🔄 Réessaie dans un instant.");
    }
  }
};

export default ytSearchCommand;
