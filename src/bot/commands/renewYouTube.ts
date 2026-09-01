import path from "path";
import { createRequire } from "module";
import { BotCommand } from "../types.js";

/**
 * `.rnyt` (renew YouTube) — credits the LEGACY economy ledger (+3000 coins).
 *
 * The coins that `.ytvideo` (150) and `.song` (50) charge live in the vendored
 * `src/bot/imported/utils/economy.js` singleton. We require the SAME absolute
 * path the legacy bridge resolves, so Node's module cache hands us the SAME
 * in-memory instance — crediting here is instantly visible to the legacy
 * commands and persisted to economy_db.json by the module itself.
 */

// Works in both ESM (vitest/dev) and the CJS production bundle — same pattern
// as importedBridge.ts.
const require = createRequire(
  typeof __filename !== "undefined" ? __filename : import.meta.url
);

const RENEW_AMOUNT = 3000;

interface EconomyModule {
  getUser(sender: string): { coins: number; xp: number; level: number };
  addCoins(sender: string, amount: number): { coins: number; xp: number; level: number };
}

/** Lazily load the vendored economy singleton (null if unavailable). */
export function loadLegacyEconomy(): EconomyModule | null {
  try {
    const economyPath = path.join(process.cwd(), "src/bot/imported/utils/economy.js");
    const mod = require(economyPath);
    if (mod && typeof mod.addCoins === "function" && typeof mod.getUser === "function") {
      return mod as EconomyModule;
    }
    return null;
  } catch {
    return null;
  }
}

const renewYouTubeCommand: BotCommand = {
  name: "rnyt",
  aliases: ["renewyoutube", "renewyt", "coins"],
  category: "Economy",
  description: "Crédite 3000 pièces pour les téléchargements legacy (.ytvideo / .song).",
  usage: ".rnyt",
  execute: async (_sock, _msg, context) => {
    // Same gate as importedBridge: without legacy enabled there is nothing to
    // renew (the coin-charging commands are quarantined).
    if (process.env.NEBULA_ENABLE_LEGACY !== "true") {
      await context.reply(
        `🔒 *Les commandes legacy sont en quarantaine* — il n'y a donc aucune pièce à recharger.\n\n` +
          `Active le corpus legacy :\n` +
          `\`\`\`\nnebula env set NEBULA_ENABLE_LEGACY true\nnebula restart\n\`\`\`\n\n` +
          `💡 *Astuce :* pas besoin de pièces avec le pipeline natif —\n` +
          `📺 \`.youtube <lien>\` · 🎵 \`.download <lien> audio\` (gratuits)`
      );
      return;
    }

    const eco = loadLegacyEconomy();
    if (!eco) {
      await context.reply("❌ Module économie introuvable (`src/bot/imported/utils/economy.js`). Lance `nebula update` puis réessaie.");
      return;
    }

    const user = eco.addCoins(context.sender, RENEW_AMOUNT);
    await context.react("🪙");
    await context.reply(
      `🪙 *+${RENEW_AMOUNT.toLocaleString("fr-FR")} pièces créditées !*\n\n` +
        `💰 Nouveau solde : *${user.coins.toLocaleString("fr-FR")} pièces*\n\n` +
        `📺 \`.ytvideo <lien>\` — 150 pièces\n` +
        `🎵 \`.song <titre>\` — 50 pièces\n\n` +
        `> Rechargeable à volonté : \`.rnyt\` à chaque fois 👍`
    );
  }
};

export default renewYouTubeCommand;
