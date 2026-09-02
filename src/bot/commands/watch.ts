import { BotCommand } from "../types.js";
import { voiranimeSearch, voiranimeEpisodes, type VoiranimeSearchResult } from "../services/voiranimeClient.js";
import {
  addSubscription,
  removeSubscriptions,
  listSubscriptions,
  WATCH_MAX_PER_CHAT
} from "../services/episodeWatchService.js";

/**
 * `.w` - dedicated episode-watch command (audit 8.31, 2026-09-01).
 *
 * Replaces the `.a watch` hook, which was only intercepted at the episode
 * step of an interactive `.a` flow - a bare `.a watch` fell through to a
 * literal search for the word "watch" (user report). Flow:
 *   `.w <titre>`  -> voiranime VF search -> numbered list -> `.w <n>` picks
 *                    -> immediate subscription (notified on new episodes)
 *   `.w` / `.w list` -> this chat's watches
 *   `.w rm <titre>`  -> stop watching
 * Multiple anime per chat are supported (cap WATCH_MAX_PER_CHAT).
 */

interface PendingPick {
  entries: VoiranimeSearchResult[];
  query: string;
  ts: number;
}

const pendingPicks = new Map<string, PendingPick>();
const PENDING_TTL_MS = 10 * 60 * 1000; // a stale pick list expires
const MAX_SHOWN = 8;
const MAX_PENDING = 200; // audit 8.32: bound the map (one entry per chat)

/**
 * Expire stale entries eagerly and cap the map size (oldest first) so a busy
 * or hostile multi-chat usage cannot grow it indefinitely.
 */
function sweepPending(): void {
  const now = Date.now();
  for (const [jid, p] of pendingPicks) {
    if (now - p.ts > PENDING_TTL_MS) pendingPicks.delete(jid);
  }
  while (pendingPicks.size > MAX_PENDING) {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [jid, p] of pendingPicks) {
      if (p.ts < oldestTs) {
        oldestTs = p.ts;
        oldestKey = jid;
      }
    }
    if (!oldestKey) break;
    pendingPicks.delete(oldestKey);
  }
}

function freshPending(chatJid: string): PendingPick | null {
  const p = pendingPicks.get(chatJid);
  if (!p) return null;
  if (Date.now() - p.ts > PENDING_TTL_MS) {
    pendingPicks.delete(chatJid);
    return null;
  }
  return p;
}

async function subscribeAndConfirm(
  context: any,
  chatJid: string,
  entry: VoiranimeSearchResult
): Promise<any> {
  // Count the currently available episodes so the watch only announces
  // genuinely NEW ones (subscribing with lastSeenEp=0 would replay the whole
  // backlog on the first cycle).
  let lastSeenEp = 0;
  try {
    const eps = await voiranimeEpisodes(entry.url);
    lastSeenEp = Math.max(0, ...((eps || []).map((e) => e.n).filter((n) => n > 0)));
  } catch {
    return context.reply(
      "❌ Impossible de lire la liste des épisodes pour le moment.\n\n" +
        "_Réessaie dans quelques minutes :_ `.w " + entry.title + "`"
    );
  }

  const result = addSubscription({ chatJid, title: entry.title, seasonUrl: entry.url, lang: "VF", lastSeenEp });
  if (!result.ok) return context.reply("❌ " + result.error);

  const cadence = process.env.NEBULA_WATCH_CRON ? "selon la configuration du serveur" : "toutes les ~6 heures";
  return context.reply(
    (result.updated ? "🔄 *Veille mise à jour !*\n" : "🔔 *Veille activée !*\n") +
      "🎬 *" + entry.title + "* (VF)\n" +
      "📦 Dernier épisode connu : " + lastSeenEp + "\n" +
      "⏰ Vérification " + cadence + " (nuit silencieuse 23h–7h)\n\n" +
      "_Tu seras prévenu ici dès qu'un nouvel épisode sort, avec la commande de téléchargement prête._\n" +
      "_Plusieurs veilles possibles (max " + WATCH_MAX_PER_CHAT + ") · Arrêter : `.w rm " + entry.title + "` · Liste : `.w`_"
  );
}

const watchCommand: BotCommand = {
  name: "w",
  aliases: ["watch", "veille", "watchlist"],
  category: "Anime",
  description: "Veille épisodes : .w <titre> puis .w <numéro> → notifié dès qu'un nouvel épisode sort.",
  usage: ".w <titre> | .w list | .w rm <titre>",
  execute: async (_sock, msg, context) => {
    const args = (context.args || []).map((a: string) => a.trim()).filter(Boolean);
    const firstArg = (args[0] || "").toLowerCase();
    const chatJid = msg.key.remoteJid!;
    sweepPending();

    // ----- list -----
    if (args.length === 0 || firstArg === "list" || firstArg === "watchlist") {
      const subs = listSubscriptions(chatJid);
      await context.react("🔔");
      if (subs.length === 0) {
        return context.reply(
          "ℹ️ Aucune veille active dans cette discussion.\n" +
            "_Pour en créer une :_ `.w <titre>` _(_`.w solo leveling`)._"
        );
      }
      return context.reply(
        "🔔 *Veilles actives (" + subs.length + "/" + WATCH_MAX_PER_CHAT + ") :*\n\n" +
          subs
            .map(
              (s) =>
                "• *" + s.title + "* (" + s.lang + ") — dernier ép. connu : " + s.lastSeenEp + "\n" +
                "  _Arrêter :_ `.w rm " + s.title + "`"
            )
            .join("\n") +
          "\n\n_Vérification toutes les ~6 h · Nouvelle veille :_ `.w <titre>`"
      );
    }

    // ----- remove -----
    if (firstArg === "rm" || firstArg === "unwatch" || firstArg === "stop") {
      const query = args.slice(1).join(" ").trim();
      if (!query) {
        return context.reply("Usage : `.w rm <titre>` _(ou_ `.w` _pour voir tes veilles)._");
      }
      const n = removeSubscriptions(chatJid, query);
      return n > 0
        ? context.reply("✅ " + n + " veille(s) arrêtée(s) pour *" + query + "*.")
        : context.reply("❌ Aucune veille ne correspond à *" + query + "*.\n_Voici tes veilles :_ `.w`");
    }

    // ----- numeric selection on a pending pick list -----
    if (/^\d$/.test(firstArg)) {
      const pending = freshPending(chatJid);
      const n = parseInt(firstArg, 10);
      if (!pending) {
        return context.reply("❌ Plus de sélection en attente — _relance ta recherche :_ `.w <titre>`");
      }
      if (n < 1 || n > pending.entries.length) {
        return context.reply("❌ Choix invalide (1–" + pending.entries.length + ") : `.w <numéro>`");
      }
      const entry = pending.entries[n - 1]!;
      pendingPicks.delete(chatJid);
      await context.react("🔔");
      return subscribeAndConfirm(context, chatJid, entry);
    }

    // ----- new search -----
    if (process.env.NEBULA_VOIRANIME_DISABLED === "1") {
      return context.reply("❌ La veille d'épisodes est désactivée sur ce serveur.");
    }
    const query = args.join(" ");
    await context.react("🔍");
    let results: VoiranimeSearchResult[];
    try {
      results = await voiranimeSearch(query);
    } catch (err: any) {
      return context.reply("❌ Recherche échouée. _Réessaie dans un instant._");
    }
    const vfEntries = results.filter((r) => r.isVf).slice(0, MAX_SHOWN);
    if (vfEntries.length === 0) {
      return context.reply(
        "❌ Aucune entrée *VF* trouvée pour cette recherche.\n" +
          "_La veille ne supporte que les saisons VF pour l'instant (les VOSTFR ne sont pas encore surveillables)._"
      );
    }
    if (vfEntries.length === 1) {
      return subscribeAndConfirm(context, chatJid, vfEntries[0]!);
    }
    pendingPicks.set(chatJid, { entries: vfEntries, query, ts: Date.now() });
    return context.reply(
      "🔍 *Résultats VF (" + vfEntries.length + ") :*\n\n" +
        vfEntries.map((e, i) => (i + 1) + ". *" + e.title + "*").join("\n") +
        "\n\n_Réponds avec_ `.w <numéro>` _pour activer la veille (notification dès qu'un nouvel épisode sort)._"
    );
  }
};

export default watchCommand;
