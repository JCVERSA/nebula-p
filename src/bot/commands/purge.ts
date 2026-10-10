import { BotCommand } from "../types.js";
import { executeDiskPurge } from "../services/diskPurge.js";

/**
 * `.purge` / `.p` (8.88) — bouton d'urgence owner : libère immédiatement
 * tout l'espace nettoyable (fichiers animés livrés + débris de fabrication),
 * en épargnant le batch en cours (claim disque vivant). Décision owner
 * 2026-09-27 : les liens livrés encore valides meurent (accepté) ; le bot
 * répond avec le bilan (fichiers supprimés, espace libéré, espace libre
 * avant/après). La logique et les règles de protection vivent dans
 * services/diskPurge.ts (planificateur pur + exécuteur).
 */

const purgeCommand: BotCommand = {
  name: "purge",
  aliases: ["p"],
  category: "Tools",
  description: "Owner : purge l'espace des anciens téléchargements animés.",
  usage: "purge",
  execute: async (sock, msg, context) => {
    if (!context.isOwner) {
      return void (await context.reply("⛔ *Commande réservée à l'owner.*"));
    }
    await context.react("🧹");
    try {
      const r = await executeDiskPurge();
      const fmt = (b: number | null): string => {
        if (b === null) return "?";
        if (b >= 1024 * 1024 * 1024) return `${(b / (1024 * 1024 * 1024)).toFixed(2)} Go`;
        return `${Math.max(0, Math.round(b / (1024 * 1024)))} Mo`;
      };
      const delta =
        r.freeBytesBefore !== null && r.freeBytesAfter !== null
          ? Math.max(0, r.freeBytesAfter - r.freeBytesBefore)
          : r.freedBytes;
      const lines = [
        "🧹 *Purge terminée*",
        "",
        `📁 Fichiers supprimés : *${r.deletedFiles}* (${fmt(r.freedBytes)})`,
        r.deletedDirs > 0 ? `🧱 Débris de fabrication nettoyés : *${r.deletedDirs}* dossier(s)` : null,
        r.activeBatches > 0
          ? `🛡️ Batch en cours épargné : *${r.activeBatches}* (${r.sparedDelivered} fichier(s) gardés)`
          : null,
        // 8.98c (retour terrain) : sans cette ligne, un purge pendant la
        // grâce de 5 min affiche « 0 fichiers, +0 Mo » sans explication —
        // on croit le purge cassé alors qu'il épargne les liens tout juste
        // livrés pour ne pas couper un téléchargement en cours côté user.
        r.sparedDelivered > 0
          ? `⏳ *${r.sparedDelivered}* fichier(s) récents épargnés (grâce 5 min${r.activeBatches > 0 ? " / batch actif" : ""}) — relance \`.purge\` dans quelques minutes pour les inclure.`
          : null,
        `💾 Espace libre : *${fmt(r.freeBytesBefore)}* → *${fmt(r.freeBytesAfter)}* (+${fmt(delta)})`
      ].filter(Boolean);
      await context.reply(lines.join("\n"));
    } catch (err: any) {
      console.error("[PURGE] Fatal:", err?.message || err);
      await context.reply("❌ La purge a échoué.\n🔄 Réessaie dans un instant.");
    }
  }
};

export default purgeCommand;
