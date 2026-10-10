import { BotCommand } from "../types.js";
import { handleAgentMessage } from "../services/agentRunner.js";
import { dispatchBotCommand, type DispatchInfo } from "../commandDispatch.js";
import { getConfig } from "../config.js";

/**
 * 8.93 — .agent (alias .ag) : entrée EXPLICITE de l'agent IA.
 *
 * En privé, un message sans préfixe passe déjà par l'agent (beta) — cette
 * commande force la même interprétation et sert d'entrée découvrable :
 * `.agent passe-moi les annales de bio 2023`.
 *
 * En groupe : JAMAIS d'exécution (décision owner, beta) — notice honnête
 * et raccourci vers le privé.
 */
const agentCommand: BotCommand = {
  name: "agent",
  aliases: ["ag"],
  category: "AI & Creative",
  description: "L'agent IA comprend ta demande et exécute la commande (beta, privé).",
  usage: "agent <demande en langage naturel>",
  execute: async (sock, msg, context) => {
    const isGroup = (msg.key.remoteJid || "").endsWith("@g.us");
    const demand = (context.args || []).join(" ").trim();

    if (isGroup) {
      await context.reply(
        "🤖 *L'agent est en beta* — il agit en privé uniquement.\n" +
        "En groupe, tape la commande toi-même, ou écris-moi la même demande en privé."
      );
      return;
    }
    if (!demand) {
      await context.reply(
        "🤖 Je comprends les demandes en langage naturel et j'exécute la commande qui va bien.\n\n" +
        `Exemples :\n` +
        `• \`${context.prefix}agent passe-moi les annales de bio A/L 2023 papier 2\`\n` +
        `• \`${context.prefix}agent télécharge l'épisode 6 de jjk s3 en HD\`\n\n` +
        "_En privé, tu peux aussi simplement m'écrire la demande sans commande._"
      );
      return;
    }

    const senderNumber = context.sender.split("@")[0].replace(/[^0-9]/g, "");
    const dispatchInfo: DispatchInfo = {
      senderJid: context.sender,
      senderName: context.senderName,
      senderNumber,
      isOwner: context.isOwner,
      isAdmin: context.isAdmin,
      isGroup: false,
      prefix: context.prefix,
      text: context.fullMessage || demand,
      messageContent: msg.message || {},
    };

    const handled = await handleAgentMessage(
      sock,
      msg,
      {
        senderJid: context.sender,
        actorJid: msg.key.participant || context.sender,
        actorNumber: senderNumber,
        senderName: context.senderName,
        isOwner: context.isOwner,
        text: demand,
        botName: getConfig().botName,
        prefix: context.prefix,
      },
      (commandName, args) => dispatchBotCommand(sock, msg, dispatchInfo, commandName, args, "agent")
    );

    if (!handled) {
      // isAIConfigured() a refusé : le message d'accueil du chemin normal
      // n'est pas passé par ici — on reste honnête, pas de silence.
      await context.reply(
        "🤖 L'IA n'est pas encore configurée sur ce bot — ajoute une clé IA (Gemini ou NVIDIA NIM) depuis le panneau."
      );
    }
  },
};

export default agentCommand;
