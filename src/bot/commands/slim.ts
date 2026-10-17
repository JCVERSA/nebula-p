import path from "path";
import fs from "fs";
import { BotCommand } from "../types.js";
import { slimEtaMinutes, slimVideoIfNeeded } from "../services/videoSlim.js";
import { consumeSlimOffer } from "../services/slimOffer.js";
import { registerTempDownload, getLinkTtlMinutes } from "../tempDownloadManager.js";

/**
 * 9.18ddd — .slim : accepte l'offre d'allègement d'une vidéo lourde.
 *
 * Décision owner 17/10 : ne JAMAIS imposer la conversion. La livraison
 * lourde part en original avec une offre ; cette commande est le « oui ».
 * Encodage 2-pass tune animation vers ~NEBULA_SLIM_TARGET_MB (défaut
 * 190 Mo), même résolution, bornes mémoire 9.18aaa. L'original et son
 * lien /d/ restent intacts — la version allégée vit à côté, sous son
 * propre token.
 */
const slimCommand: BotCommand = {
  name: "slim",
  category: "Media",
  description: "Allège la dernière vidéo lourde livrée (2-pass, ~190 Mo, même résolution).",
  usage: "slim",
  execute: async (sock, msg, context) => {
    const chatJid = String(msg.key.remoteJid || context.sender || "");
    const offer = consumeSlimOffer(chatJid);
    if (!offer) {
      await context.reply(
        `⚖️ *Rien à alléger pour l'instant.*\n\n` +
          `_L'offre accompagne les vidéos de plus de 250 Mo et dure 10 min après la livraison._`
      );
      return;
    }
    if (!fs.existsSync(offer.tempFilePath)) {
      await context.reply(`⚠️ *Le fichier d'origine a expiré du stockage temporaire* — redemande l'épisode, puis réponds \`.slim\` juste après la livraison.`);
      return;
    }

    await context.react("⚖️");
    await context.reply(
      `⏳ *Allègement en cours : ${Math.round(offer.bytes / (1024 * 1024))} Mo → ~${offer.targetMB} Mo* ` +
        `(2-pass, même résolution, ~${slimEtaMinutes(offer.bytes, "aggressive")} min)…`
    );

    const r = await slimVideoIfNeeded(offer.tempFilePath, {
      mode: "aggressive",
      targetMB: offer.targetMB,
      keepOriginal: true
    });
    if (!r.slimmed || !r.path || !fs.existsSync(r.path)) {
      await context.reply(`⚠️ *L'allègement n'a pas abouti* — le lien original reste valable.`);
      return;
    }

    // Nom propre, à côté de l'original dans le magasin temporaire.
    const base = offer.filename.replace(/\.mp4$/i, "");
    let cleanName = `${base}-leger.mp4`;
    let cleanPath = path.join(path.dirname(r.path), cleanName);
    if (fs.existsSync(cleanPath)) {
      cleanName = `${base}-leger-${Date.now() % 10000}.mp4`;
      cleanPath = path.join(path.dirname(r.path), cleanName);
    }
    try {
      fs.renameSync(r.path, cleanPath);
    } catch {
      await context.reply(`⚠️ *L'allègement n'a pas abouti* — le lien original reste valable.`);
      return;
    }

    const rec = registerTempDownload(cleanPath, cleanName, { noCopy: true });
    const mb = (b: number) => (b / (1024 * 1024)).toFixed(1);
    const m = offer.meta;
    await context.reply(
      `⚖️ *✔ Version allégée prête : ${mb(offer.bytes)} → ${mb(r.finalBytes)} Mo*\n\n` +
        (m?.title ? `🎬 *Anime:* ${m.title}\n` : "") +
        (m?.season || m?.episode ? `📅 ${m.season || ""} ${m.episode || ""}\n`.trimEnd() + "\n" : "") +
        (m?.resolution ? `⚙️ *Résolution:* ${m.resolution} (inchangée)\n` : "") +
        `📄 *Fichier:* \`${cleanName}\`\n\n` +
        `🔗 *Lien de téléchargement :*\n${rec.downloadUrl}\n\n` +
        `⏳ _Valable ${getLinkTtlMinutes()} min après chaque téléchargement (max 2 h)_\n` +
        `_Optimisé 2-pass pour la cible — le lien original reste actif si tu préfères la qualité maximale._`
    );
  }
};

export default slimCommand;
