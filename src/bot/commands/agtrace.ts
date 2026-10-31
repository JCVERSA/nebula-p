/**
 * 9.18eeee (A6) — .agtrace : trace de décision agent (owner, DRY-RUN).
 *
 * Rejoue la décision IA d'un message SANS RIEN exécuter : réponse brute du
 * modèle, décision parsée, gardes (registre, denylist, lourd). L'owner
 * débogue ainsi en 10 s un comportement étrange de Nova, sans logs ni SSH.
 *
 * Approximation honnête : le prompt est le contexte STABLE (persona + fiche)
 * — sans la mémoire de conversation ni les écrans en attente, qui dépendent
 * de l'état du chat au moment du message d'origine.
 */
import { BotCommand } from "../types.js";
import { generateTextWithFallback, isAIConfigured } from "../geminiClient.js";
import { getPersonaPrompt } from "../persona.js";
import { buildAgentKnowledge } from "../commandKnowledge.js";
import { parseAgentDecision, isAgentDeniedCommand, isHeavyAgentCommand } from "../services/agentBrain.js";
import { getCommand } from "../commandRegistry.js";

const agtraceCommand: BotCommand = {
  name: "agtrace",
  category: "Tools",
  description: "Trace décision agent (owner)",
  usage: "agtrace <message à tracer>",
  execute: async (sock, msg, context) => {
    if (!context.isOwner) {
      return void (await context.reply("⛔ *Commande réservée à l'owner.*"));
    }
    const query = (context.args || []).join(" ").trim();
    if (!query) {
      return void (await context.reply(
        "🧪 *agtrace — trace une décision de Nova (dry-run)*\n\n" +
          `\`${context.prefix}agtrace télécharge one piece s1 e5\`\n\n` +
          "Rejoue la décision SANS rien exécuter : réponse brute du modèle, décision parsée, verdict des gardes.\n\n" +
          "_Note : contexte stable (sans mémoire de conversation)._"
      ));
    }
    if (!isAIConfigured()) {
      return void (await context.reply("⚠️ *L'IA n'est pas configurée* — impossible de tracer une décision."));
    }
    await context.react("🧪");
    try {
      const system = `${getPersonaPrompt("dm")}\n\n${buildAgentKnowledge(context.prefix)}`;
      const raw = await generateTextWithFallback(query, system, "gemini-3.7-flash", { jsonMode: true });
      const decision = parseAgentDecision(raw);

      const lines: string[] = [];
      lines.push("🧪 *AGTRACE — dry-run, RIEN n'a été exécuté*");
      lines.push(`📩 *Demande :* « ${query.slice(0, 200)} »`);
      lines.push(`🤖 *Réponse brute du modèle :*\n\`\`\`\n${(raw || "(vide)").slice(0, 600)}\n\`\`\``);
      if (!decision) {
        lines.push("❌ *Décision : NULL* — non conforme au contrat → le chemin dégradé prendrait le relais.");
      } else {
        lines.push(`✅ *Décision parsée :*\n\`\`\`json\n${JSON.stringify(decision).slice(0, 500)}\n\`\`\``);
        if (decision.action === "execute") {
          const canonical = getCommand(decision.command);
          const argList = decision.args ? decision.args.split(/\s+/) : [];
          if (!canonical) {
            lines.push(`⛔ *Résolution :* « ${decision.command} » inconnue au registre → suggestion de commande.`);
          } else if (isAgentDeniedCommand(canonical.name)) {
            lines.push(`⛔ *Garde :* « ${canonical.name} » est sur la denylist agent — jamais exécutée par Nova.`);
          } else if (isHeavyAgentCommand(canonical, argList)) {
            lines.push(`⏳ *Garde :* « ${canonical.name} » est LOURDE → Nova demanderait confirmation avant d'exécuter.`);
          } else {
            lines.push(`🟢 *Verdict :* Nova exécuterait \`${canonical.name}\` avec « ${decision.args} ».`);
          }
        }
      }
      lines.push("_Dry-run sur contexte stable — la mémoire du chat et les écrans en attente ne sont pas rejoués._");
      await context.reply(lines.join("\n\n"));
    } catch (e: any) {
      await context.reply(`⚠️ *Échec du traçage* (${e?.message || "erreur"}) — réessaie dans un instant.`);
    }
  },
};

export default agtraceCommand;
