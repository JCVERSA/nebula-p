/**
 * 8.93 — Dispatch de commande partagé (source unique de vérité).
 *
 * Extrait à l'identique de la boucle de messages de botEngine.ts (chemin
 * préfixe, éprouvé en prod) pour être réutilisé par l'agent IA :
 *   - chemin préfixe  : `.gce a bio 2023 2` tapé par l'utilisateur ;
 *   - chemin agent    : demande naturelle traduite par l'IA (privé, beta).
 *
 * Le dispatch construit le contexte complet (reply/react/média/groupe),
 * applique RoleGuard (fail-closed) puis exécute la commande. Pour l'agent,
 * les réponses sont CAPTURÉES pour détecter les erreurs (rattrapage 8.93).
 */

import { getCommand } from "./commandRegistry.js";
import { BotCommandContext, GroupMember } from "./types.js";
import { incrementCommandStats } from "./commandStats.js";
import { authorizeCommand, resolveRole } from "./accessControl.js";
import { getGroupPolicy } from "./groupAccessStore.js";
import { recordAudit } from "./auditTrail.js";
import { extractQuotedMediaContent } from "./utils/quotedMedia.js";
import { addLog, bufferFromDataUri, getCachedGroupMetadata, maskLogNumber } from "./botEngine.js";

export interface DispatchInfo {
  senderJid: string;
  senderName: string;
  senderNumber: string;
  isOwner: boolean;
  isAdmin: boolean;
  isGroup: boolean;
  prefix: string;
  text: string;
  messageContent: any;
}

/** Résultat d'exécution vu par l'agent (le chemin préfixe l'ignore). */
export interface AgentCommandOutcome {
  ok: boolean;        // commande exécutée sans exception
  denied: boolean;    // RoleGuard a refusé (aucun rattrapage possible)
  hadError: boolean;  // une réponse commençait par ❌/⚠️/⛔ (ou exception)
  lastText: string;   // dernier texte capturé
}

function replyLooksLikeError(t: string): boolean {
  return /^(❌|⚠️|⛔)/u.test(t) || t.includes("*Nebula Error:*");
}

export async function dispatchBotCommand(
  sock: any,
  msg: any,
  info: DispatchInfo,
  commandName: string,
  args: string[],
  source: "prefix" | "agent" = "prefix"
): Promise<AgentCommandOutcome> {
  const { senderJid, senderName, messageContent } = info;
  const outcome: AgentCommandOutcome = { ok: false, denied: false, hadError: false, lastText: "" };

  const command = getCommand(commandName);
  if (!command) {
    addLog(`⚠️ Unknown or dynamically excluded command: "${commandName}"`);
    return outcome;
  }

  // Build dynamic reply and react handlers
  const replyHandler = async (textStr: string, mediaUrl?: string) => {
    try {
      if (source === "agent") {
        outcome.lastText = textStr;
        if (replyLooksLikeError(textStr)) outcome.hadError = true;
      }
      // Typing simulation to enhance interaction realism
      if (sock && typeof sock.sendPresenceUpdate === "function") {
        try {
          await sock.sendPresenceUpdate("composing", senderJid);
          // Simulated typing delay depending on text length (approx 15ms per character, capped between 600ms and 2.5s)
          const typingDelay = Math.min(Math.max(textStr.length * 15, 600), 2500);
          await new Promise((resolve) => setTimeout(resolve, typingDelay));
          await sock.sendPresenceUpdate("paused", senderJid);
        } catch (presErr: any) {
          addLog(`[Presence] Failed to send typing simulation: ${presErr.message}`);
        }
      }

      if (mediaUrl) {
        // Decode data: URIs (e.g. AI-generated images) into a buffer —
        // Baileys cannot fetch data URIs directly.
        if (mediaUrl.startsWith("data:")) {
          const buffer = bufferFromDataUri(mediaUrl);
          if (buffer) {
            return await sock.sendMessage(senderJid, {
              image: buffer,
              caption: textStr
            }, { quoted: msg });
          }
        }
        return await sock.sendMessage(senderJid, {
          image: { url: mediaUrl },
          caption: textStr
        }, { quoted: msg });
      } else {
        return await sock.sendMessage(senderJid, { text: textStr }, { quoted: msg });
      }
    } catch (e: any) {
      addLog(`Error sending message: ${e.message}`);
    }
  };

  const reactHandler = async (emoji: string) => {
    try {
      return await sock.sendMessage(senderJid, {
        react: { text: emoji, key: msg.key }
      });
    } catch (e: any) {
      addLog(`Error reacting: ${e.message}`);
    }
  };

  // Sensible media handling - dynamic buffer downloader (operates on the unwrapped message)
  const mediaDownloader = async (): Promise<Buffer | null> => {
    try {
      let messageType = Object.keys(messageContent)[0];
      let mediaContent: any = messageContent;
      if (!["imageMessage", "videoMessage", "documentMessage", "audioMessage"].includes(messageType)) {
        // Media toolkit UX (audit 8.48): when the invoking message has no
        // media of its own, fall back to the QUOTED message's media
        // ("reply to a video with .m gif").
        const quoted = extractQuotedMediaContent(messageContent);
        if (!quoted) return null;
        messageType =
          Object.keys(quoted).find(k =>
            ["imageMessage", "videoMessage", "documentMessage", "audioMessage"].includes(k)
          ) || "";
        if (!messageType) return null;
        mediaContent = quoted;
      }

      addLog(`Downloading media content of type: ${messageType}`);
      const stream = await (sock as any).downloadContentFromMessage(
        mediaContent[messageType],
        messageType.replace("Message", "")
      );

      let buffer = Buffer.alloc(0);
      const MAX_MEDIA_BYTES = 100 * 1024 * 1024; // WhatsApp media ceiling
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > MAX_MEDIA_BYTES) {
          addLog("Media download aborted: exceeds the 100 MB memory cap.");
          return null;
        }
      }

      // Log memory safe usage
      addLog(`Media download finished. Buffer size: ${Math.round(buffer.length / 1024)} KB.`);
      return buffer;
    } catch (err: any) {
      addLog(`Media download failed: ${err.message}`);
      return null;
    }
  };

  const context: BotCommandContext = {
    sender: senderJid,
    senderName,
    isOwner: info.isOwner,
    isAdmin: info.isAdmin,
    prefix: info.prefix,
    commandName,
    args,
    fullMessage: info.text,
    reply: replyHandler,
    react: reactHandler,
    downloadMedia: mediaDownloader,
    getGroupMetadata: async (jid: string) => {
      return await getCachedGroupMetadata(sock, jid);
    },
    getGroupMembers: async (jid: string): Promise<GroupMember[]> => {
      const meta = await getCachedGroupMetadata(sock, jid);
      if (meta && Array.isArray(meta.participants)) {
        return meta.participants.map((p: any) => ({
          id: p.id,
          number: p.id.split("@")[0].replace(/[^0-9]/g, ""),
          admin: p.admin || null,
        }));
      }
      return [];
    },
    updateParticipants: async (jid: string, participants: string[], action: "add" | "remove" | "promote" | "demote") => {
      if (sock && typeof sock.groupParticipantsUpdate === "function") {
        return await sock.groupParticipantsUpdate(jid, participants, action);
      }
      return null;
    },
    kickMember: async (jid: string, participantJid: string) => {
      if (sock && typeof sock.groupParticipantsUpdate === "function") {
        return await sock.groupParticipantsUpdate(jid, [participantJid], "remove");
      }
      return null;
    },
    promoteMember: async (jid: string, participantJid: string) => {
      if (sock && typeof sock.groupParticipantsUpdate === "function") {
        return await sock.groupParticipantsUpdate(jid, [participantJid], "promote");
      }
      return null;
    },
    demoteMember: async (jid: string, participantJid: string) => {
      if (sock && typeof sock.groupParticipantsUpdate === "function") {
        return await sock.groupParticipantsUpdate(jid, [participantJid], "demote");
      }
      return null;
    },
  };

  addLog(`💬 Executing dynamic command: [${commandName}]${source === "agent" ? " (via agent)" : ""} for ${senderName} (${maskLogNumber(info.senderNumber)})`);

  // RoleGuard (M1): declarative ACL gate — fail closed on any error so a
  // policy/registry problem can never escalate to "everyone allowed".
  try {
    const accessPolicy = getGroupPolicy(senderJid);
    const aclDecision = authorizeCommand(
      { name: commandName, category: command.category || "misc" },
      resolveRole({ isOwner: info.isOwner, isAdmin: info.isAdmin, isGroup: info.isGroup }),
      accessPolicy,
      {
        ownerOnly: (command as any).ownerOnly,
        adminOnly: (command as any).adminOnly,
        groupOnly: (command as any).groupOnly,
        privateOnly: (command as any).privateOnly,
      }
    );
    if (!aclDecision.allowed) {
      addLog(`⛔ RoleGuard denied [${commandName}] for ${senderName} (${maskLogNumber(info.senderNumber)}): ${aclDecision.reason}`);
      recordAudit(`wa:${info.senderNumber}`, "roleguard.deny", commandName, aclDecision.reason);
      await replyHandler(`⛔ *Access Denied:* ${aclDecision.reason}.`);
      outcome.denied = true;
      outcome.hadError = true;
      return outcome;
    }
  } catch (aclErr: any) {
    addLog(`⛔ RoleGuard error on [${commandName}] for ${senderName}: ${aclErr.message || aclErr} (fail-closed)`);
    await replyHandler(`⛔ *Access Denied:* unable to verify permission for this command.`);
    outcome.denied = true;
    outcome.hadError = true;
    return outcome;
  }

  try {
    incrementCommandStats(commandName);
    await command.execute(sock, msg, context);
    outcome.ok = true;
  } catch (err: any) {
    addLog(`❌ Error in ${commandName}: ${err.message || err}`);
    await replyHandler(`❌ *Nebula Error:* Failed to execute command \`${commandName}\`.\nReason: ${err.message || err}`);
    outcome.hadError = true;
    outcome.lastText = `Nebula Error: ${err.message || err}`;
  }
  return outcome;
}
