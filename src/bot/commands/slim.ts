import path from "path";
import fs from "fs";
import { BotCommand } from "../types.js";
import { slimAggressiveKbps, slimEffectiveTargetMB, slimEtaMinutes, slimVideoIfNeeded, slimTargetMB } from "../services/videoSlim.js";
import { consumeSlimOffer } from "../services/slimOffer.js";
import { ghEncoderConfig, githubSlimEncode } from "../services/githubEncode.js";
import { probeVideoInfo } from "../services/mediaToolkit.js";
import { registerTempDownload, getLinkTtlMinutes } from "../tempDownloadManager.js";

/**
 * 9.18ddd/eee — .slim : accepte l'offre d'allègement d'une vidéo lourde.
 *
 * Décision owner 17/10 : ne JAMAIS imposer la conversion. La livraison
 * lourde part en original avec une offre ; cette commande est le « oui ».
 *
 * Moteur d'encodage (9.18eee, idée owner) : GitHub Actions D'ABORD — un
 * runner public gratuit (4 cœurs / 16 Go) télécharge l'original via le
 * lien /d/ et encode en 2-pass tune animation ; le VPS ne fait que
 * coordonner (bot vif pendant l'encodage, zéro risque OOM). Tout échec
 * GitHub (token absent/expiré, run raté, délai) → repli LOCAL silencieux
 * (2-pass 9.18ddd). L'original et son lien /d/ restent intacts — la
 * version allégée vit à côté, sous son propre token.
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

    // Budget cible (9.18fff) : la cible S'ADAPTE à la durée — un épisode de
    // 24 min vise ~190 Mo, un film de 90 min ~590 Mo (plancher 800 kbps :
    // 190 Mo sur 90 min = 193 kbps = bouillie, refusé à tort hier).
    const probed = await probeVideoInfo(offer.tempFilePath);
    const durationSec = probed.durationSec || 0;
    const targetMB = slimEffectiveTargetMB(offer.bytes, durationSec, offer.targetMB || slimTargetMB());
    const videoKbps = durationSec > 0 ? slimAggressiveKbps(offer.bytes, durationSec, targetMB) : null;
    if (videoKbps === null) {
      await context.reply(
        `⚠️ *Pas d'allègement utile trouvé* (durée ${Math.max(1, Math.round(durationSec / 60))} min, source déjà frugale) — le lien original reste valable.`
      );
      return;
    }

    await context.react("⚖️");
    await context.reply(
      `⏳ *Allègement en cours : ${Math.round(offer.bytes / (1024 * 1024))} Mo → ~${targetMB} Mo* ` +
        `(2-pass, même résolution, ~${slimEtaMinutes(offer.bytes, "aggressive")} min)…`
    );

    // ── Moteur 1 (9.18eee) : GitHub Actions — le VPS ne code plus rien.
    let resultPath = "";
    let resultBytes = 0;
    const ghReady = ghEncoderConfig() !== null && !!offer.sourceUrl;
    if (ghReady) {
      const gh = await githubSlimEncode({
        sourceUrl: offer.sourceUrl,
        filename: offer.filename,
        videoKbps,
        originalBytes: offer.bytes,
        log: (m) => console.log(m)
      });
      if (gh) {
        resultPath = gh.path;
        resultBytes = gh.bytes;
      }
    }

    // ── Moteur 2 (repli) : local, borné mémoire 9.18aaa.
    if (!resultPath) {
      const r = await slimVideoIfNeeded(offer.tempFilePath, {
        mode: "aggressive",
        targetMB,
        keepOriginal: true
      });
      if (!r.slimmed || !r.path || !fs.existsSync(r.path)) {
        await context.reply(`⚠️ *L'allègement n'a pas abouti* — le lien original reste valable.`);
        return;
      }
      resultPath = r.path;
      resultBytes = r.finalBytes;
    }
    if (!fs.existsSync(resultPath)) {
      await context.reply(`⚠️ *L'allègement n'a pas abouti* — le lien original reste valable.`);
      return;
    }

    // Nom propre, à côté de l'original dans le magasin temporaire.
    const base = offer.filename.replace(/\.mp4$/i, "");
    let cleanName = `${base}-leger.mp4`;
    let cleanPath = path.join(path.dirname(offer.tempFilePath), cleanName);
    if (fs.existsSync(cleanPath)) {
      cleanName = `${base}-leger-${Date.now() % 10000}.mp4`;
      cleanPath = path.join(path.dirname(offer.tempFilePath), cleanName);
    }
    try {
      fs.renameSync(resultPath, cleanPath);
    } catch {
      await context.reply(`⚠️ *L'allègement n'a pas abouti* — le lien original reste valable.`);
      return;
    }

    const rec = registerTempDownload(cleanPath, cleanName, { noCopy: true });
    const mb = (b: number) => (b / (1024 * 1024)).toFixed(1);
    const m = offer.meta;
    await context.reply(
      `⚖️ *✔ Version allégée prête : ${mb(offer.bytes)} → ${mb(resultBytes)} Mo*\n\n` +
        (m?.title ? `🎬 *Anime:* ${m.title}\n` : "") +
        (m?.season || m?.episode ? `📅 ${m.season || ""} ${m?.episode || ""}\n`.trimEnd() + "\n" : "") +
        (m?.resolution ? `⚙️ *Résolution:* ${m.resolution} (inchangée)\n` : "") +
        `📄 *Fichier:* \`${cleanName}\`\n\n` +
        `🔗 *Lien de téléchargement :*\n${rec.downloadUrl}\n\n` +
        `⏳ _Valable ${getLinkTtlMinutes()} min après chaque téléchargement (max 2 h)_\n` +
        `_Optimisé 2-pass pour la cible — le lien original reste actif si tu préfères la qualité maximale._`
    );
  }
};

export default slimCommand;
