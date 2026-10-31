/**
 * 8.93 — Dispatch de commande partagé (source unique de vérité).
 *
 * Extrait à l'identique de la boucle de messages de botEngine.ts (chemin
 * préfixe, éprouvé en prod) pour être réutilisé par l'agent IA :
 *   - chemin préfixe  : `.wiki France` tapé par l'utilisateur ;
 *   - chemin agent    : demande naturelle traduite par l'IA (privé, beta).
 *
 * Le dispatch construit le contexte complet (reply/react/média/groupe),
 * applique RoleGuard (fail-closed) puis exécute la commande. Pour l'agent,
 * les réponses sont CAPTURÉES pour détecter les erreurs (rattrapage 8.93).
 */

// Named import uniquement (package ESM-only — voir note botEngine.ts) :
// en Baileys 7.x downloadContentFromMessage est un EXPORT du module,
// PAS une méthode du sock (l'appel sock.downloadContentFromMessage
// échouait : "not a function" — constaté en prod avec .up, 9.5b).
import { downloadContentFromMessage } from "@whiskeysockets/baileys";
import { getCommand, suggestClosestCommand } from "./commandRegistry.js";
import { BotCommandContext, GroupMember } from "./types.js";
import { incrementCommandStats } from "./commandStats.js";
import { recordCommandUse } from "./userDirectory.js";
import { authorizeCommand, resolveRole } from "./accessControl.js";
import { getGroupPolicy } from "./groupAccessStore.js";
import { recordAudit } from "./auditTrail.js";
// 9.18zzzz — outil interne `img` accessible en préfixe (voir plus bas) :
// mêmes garde-fous que le chemin agent (quota web, limite d'envois).
import { findImageCandidates, downloadImageCandidate, IMAGE_SEND_LIMIT, type ImageCandidate } from "./services/imageFinder.js";
import { checkWebQuota, consumeWebQuota } from "./webQuota.js";
// 9.18eeee (A3) : mémoire de la dernière livraison à lien (« renvoie le lien »).
import { recordLastDelivery } from "./services/lastDelivery.js";
import { extractQuotedMediaContent } from "./utils/quotedMedia.js";
import { replySuggestsOtherCatalog } from "./services/agentBrain.js";
// 9.8 : les écrans interactifs des commandes PREFIX (.a tapé directement)
// n'étaient pas mémorisés — un « 3 » nu après la liste partait en question
// au lieu d'exécuter .a 3 (constat prod).
import { setLastObservation } from "./services/agentObservation.js";
import { addLog, bufferFromDataUri, getCachedGroupMetadata, maskLogNumber } from "./botEngine.js";
import { resolveLiveSocket } from "./liveSocket.js";

export interface DispatchInfo {
  senderJid: string;
  /** 9.12 (B5) : JID de l'auteur réel (participant en groupe, = senderJid en DM). */
  actorJid: string;
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
  hadError: boolean;  // une réponse commençant par ❌/⚠️/⛔ (ou exception)
  lastText: string;   // dernier texte capturé
  /** 8.94 : la commande a signalé « langue absente → autre catalogue ». */
  vfFallbackHint: boolean;
  /**
   * 9.1 — TOUTES les réponses envoyées pendant l'exécution, dans l'ordre.
   * Nécessaire à la boucle d'observation de l'agent : une sélection
   * d'anime affiche plusieurs messages (recherche, puis liste) et c'est la
   * LISTE qui contient les choix à piloter. Plafonné pour rester léger.
   */
  texts: string[];
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
  const { senderJid, senderName, messageContent, prefix } = info;
  const outcome: AgentCommandOutcome = { ok: false, denied: false, hadError: false, lastText: "", vfFallbackHint: false, texts: [] };

  // 9.18zzzz — outil interne `img` tapé en PRÉFIXE (terrain 31/10 : l'agent
  // a un jour écrit « .img attack on titan » dans le chat, l'utilisateur l'a
  // copié → « commande inconnue / .instagram »). L'outil reste hors registre
  // et hors menu (curation owner 8.59/8.73) mais un humain qui le tape
  // explicitement veut une image : on route vers la même recherche que
  // l'agent, avec les mêmes quota et replis honnêtes.
  if (source === "prefix" && commandName === "img") {
    return await dispatchInternalImageTool(sock, msg, info, args);
  }

  const command = getCommand(commandName);
  if (!command) {
    addLog(`⚠️ Unknown or dynamically excluded command: "${commandName}"`);
    // 9.11 (audit B1) : plus de silence sur une typo — suggestion de la
    // commande la plus proche (uniquement en préfixe : le chemin agent a
    // déjà sa réponse honnête).
    if (source === "prefix") {
      const close = suggestClosestCommand(commandName);
      const hint = close
        ? ` — voulais-tu dire \`${prefix}${close}\` ?`
        : ` — \`${prefix}menu\` pour la liste des commandes.`;
      try {
        await sock.sendMessage(senderJid, { text: `❓ Commande inconnue : \`${prefix}${commandName}\`${hint}` }, { quoted: msg });
      } catch {}
    }
    return outcome;
  }

  // Build dynamic reply and react handlers
  const replyHandler = async (textStr: string, mediaUrl?: string) => {
    try {
      // 9.18eeee (A3) : chaque reply contenant un lien de téléchargement
      // temporaire devient la « dernière livraison » du chat — l'agent la
      // rejouera sur « renvoie le lien » sans rien re-télécharger.
      if (!mediaUrl && textStr.includes("/api/media/download/")) {
        recordLastDelivery(senderJid, textStr.slice(0, 1500));
      }
      if (source === "agent") {
        // 8.94 : le hint « autre catalogue » peut apparaître en MILIEU de flow
        // (avant la liste des résolutions) → vérifier CHAQUE reply, pas juste
        // la dernière.
        outcome.lastText = textStr;
        // 9.1 : mémoire complète pour la boucle d'observation (cap : on
        // garde les 6 derniers textes, 1 800 chars chacun — au-delà c'est
        // du bruit pour l'IA, pas de l'information actionnable).
        if (outcome.texts.length < 6) {
          outcome.texts.push(textStr.slice(0, 1800));
        }
        if (replyLooksLikeError(textStr)) outcome.hadError = true;
        if (replySuggestsOtherCatalog(textStr)) outcome.vfFallbackHint = true;
      }
      // 9.18ggg — le socket VIVANT au moment d'envoyer : un flux long qui
      // traverse une reconnexion (408/515) ne doit plus livrer dans le
      // socket capturé à l'arrivée du message — mort → « Connection Closed »
      // avalé, réponse perdue (audit 17/10 §1).
      const target = resolveLiveSocket(sock);
      // Typing simulation to enhance interaction realism
      if (target && typeof target.sendPresenceUpdate === "function") {
        try {
          await target.sendPresenceUpdate("composing", senderJid);
          // Simulated typing delay depending on text length (approx 15ms per character, capped between 600ms and 2.5s)
          const typingDelay = Math.min(Math.max(textStr.length * 15, 600), 2500);
          await new Promise((resolve) => setTimeout(resolve, typingDelay));
          await target.sendPresenceUpdate("paused", senderJid);
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
            return await target.sendMessage(senderJid, {
              image: buffer,
              caption: textStr
            }, { quoted: msg });
          }
        }
        return await target.sendMessage(senderJid, {
          image: { url: mediaUrl },
          caption: textStr
        }, { quoted: msg });
      } else {
        return await target.sendMessage(senderJid, { text: textStr }, { quoted: msg });
      }
    } catch (e: any) {
      addLog(`Error sending message: ${e.message}`);
      // 9.18bbbb — terrain 27/10 (.ping muet, .sweb sans réponse) : un envoi
      // perdu sur un socket mourant ne doit plus être un échec visible. UN
      // seul retry après une courte pause — le socket est RE-résolu (une
      // reconnexion a pu le remplacer entre-temps). Uniquement pour les
      // pannes de connexion : pas de retry aveugle (risque de doublon).
      const errText = String(e?.message || "");
      if (/connection|closed|reset|timed?\s*out|econn|socket|null|fetch failed/i.test(errText)) {
        try {
          await new Promise((r) => setTimeout(r, 1200));
          const retryTarget = resolveLiveSocket(sock);
          const payload = mediaUrl
            ? mediaUrl.startsWith("data:")
              ? { image: bufferFromDataUri(mediaUrl), caption: textStr }
              : { image: { url: mediaUrl }, caption: textStr }
            : { text: textStr };
          await retryTarget.sendMessage(senderJid, payload, { quoted: msg });
          addLog(`[Dispatch] Réponse renvoyée après retry (socket récupéré).`);
        } catch (retryErr: any) {
          addLog(`Error sending message (retry): ${retryErr?.message}`);
        }
      }
    }
  };

  const reactHandler = async (emoji: string) => {
    try {
      return await resolveLiveSocket(sock).sendMessage(senderJid, {
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
      const stream = await downloadContentFromMessage(
        mediaContent[messageType],
        messageType.replace("Message", "") as any
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
    senderUser: info.actorJid || senderJid,
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
    // 9.16 — répertoire utilisateurs : compte les commandes exécutées
    // (après RoleGuard — un refus n'est pas un usage).
    recordCommandUse(info.actorJid, commandName);
    await command.execute(sock, msg, context);
    outcome.ok = true;
  } catch (err: any) {
    addLog(`❌ Error in ${commandName}: ${err.message || err}`);
    await replyHandler(`❌ *Nebula Error:* Failed to execute command \`${commandName}\`.\nReason: ${err.message || err}`);
    outcome.hadError = true;
    outcome.lastText = `Nebula Error: ${err.message || err}`;
  }
  // 9.1/9.8 : mémorise la sortie pour CE chat, commandes prefix comprises —
  // le tour suivant de l'agent (un numéro nu, « le 2e »…) saura à quoi ça
  // se rapporte. Le chemin agent re-posera la même entrée : idempotent.
  if (outcome.texts.length > 0) {
    setLastObservation(senderJid, commandName, outcome.texts);
  }
  return outcome;
}

/**
 * 9.18zzzz — outil interne `img` en chemin PRÉFIXE : recherche d'images web
 * universelle (Wikipédia puis Tavily — même moteur que l'agent 9.18uuuu),
 * quota web partagé, replis honnêtes (aucune erreur crue).
 */
async function dispatchInternalImageTool(
  sock: any,
  msg: any,
  info: DispatchInfo,
  args: string[]
): Promise<AgentCommandOutcome> {
  const outcome: AgentCommandOutcome = { ok: true, denied: false, hadError: false, lastText: "", vfFallbackHint: false, texts: [] };
  const sendText = async (t: string) => {
    outcome.lastText = t;
    outcome.hadError = outcome.hadError || replyLooksLikeError(t);
    if (outcome.texts.length < 6) outcome.texts.push(t);
    try {
      await sock.sendMessage(info.senderJid, { text: t }, { quoted: msg });
    } catch {}
  };

  const query = args.join(" ").trim();
  if (!query) {
    await sendText(`📸 Donne-moi un sujet à chercher — ex. \`${info.prefix}img ciel étoilé\`, ou demande simplement « envoie-moi une photo de X ».`);
    return outcome;
  }
  const webQuota = checkWebQuota(info.actorJid);
  if (!webQuota.allowed) {
    await sendText(`📅 *Limite web du jour atteinte* (${webQuota.limit}/jour) — réessaie demain.`);
    return outcome;
  }

  recordAudit(`wa:${info.senderNumber}`, "agent.exec", "img", "image-search");
  try {
    const { candidates, engines } = await findImageCandidates(query);
    const picked = candidates.slice(0, IMAGE_SEND_LIMIT);
    const settled = await Promise.allSettled(
      picked.map(async (c: ImageCandidate) => ({ c, dl: await downloadImageCandidate(c.url) })),
    );
    const ready = settled
      .filter((r): r is PromiseFulfilledResult<{ c: ImageCandidate; dl: { buffer: Buffer; ext: string } | null }> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((v) => v.dl)
      .map((v) => ({ c: v.c, dl: v.dl! }));

    let sent = 0;
    for (const entry of ready) {
      try {
        await sock.sendMessage(
          info.senderJid,
          { image: entry.dl.buffer, caption: `📸 ${query} — ${entry.c.attribution} (${sent + 1}/${ready.length})` },
          { quoted: msg },
        );
        sent++;
      } catch {
        /* une image ratée n'arrête jamais les autres */
      }
    }

    if (sent > 0) {
      consumeWebQuota(info.actorJid);
      const via = engines.length ? ` via ${engines.join(" + ")}` : "";
      const missed = sent < picked.length ? ` — ${picked.length - sent} introuvable(s)` : "";
      await sendText(`📸 ${sent} image(s) envoyée(s) pour « ${query} »${via}${missed}.`);
    } else if (picked.length > 0) {
      await sendText(`⚠️ Les ${picked.length} image(s) trouvée(s) pour « ${query} » n'ont pas pu être téléchargées — réessaie, ou envoie-moi un lien direct et \`${info.prefix}dl\` le téléchargera.`);
    } else {
      await sendText(`❌ Aucune image trouvée pour « ${query} » — précise ta recherche, ou demande simplement à Nova « envoie-moi une photo de X ».`);
    }
  } catch {
    await sendText("⚠️ La recherche d'images a échoué — réessaie dans un instant.");
  }
  return outcome;
}
