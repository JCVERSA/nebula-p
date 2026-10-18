// NOTE: use the NAMED export only. This module is ESM-only ("type": "module")
// with no CJS build; in the esbuild CJS production bundle a default import
// compiles to `(0, import_baileys.default)(...)`, and esbuild's __toESM
// interop sets `.default` to the whole require(esm) namespace instead of the
// function — which crashed the bot with "(0, import_baileys.default) is not
// a function". Named imports pass through the wrapper untouched.
import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  downloadContentFromMessage
} from "@whiskeysockets/baileys";
import pino from "pino";
// 9.0c (SEC) : avant toute connexion — libsignal console.info des sessions
// complètes (rootKey/privKey…) à la fermeture ; on les avale ICI.
import "./suppressLibsignalNoise.js";
// 9.18ggg (audit 17/10) — publication du socket vivant pour les envois tardifs.
import { setLiveSocket } from "./liveSocket.js";
import { Boom } from "@hapi/boom";
import fs from "fs";
import { getConfig } from "./config.js";
import { ownerDeliveryJid, resolveOwnerIdentity } from "./ownerIdentity.js";
import { getCommand, initRegistry, isRegistryReady } from "./commandRegistry.js";
import { BotCommandContext } from "./types.js";
import { incrementCommandStats } from "./commandStats.js";
import { generateTextWithFallback, isAIConfigured } from "./geminiClient.js";
import { getPersonaPrompt } from "./persona.js";
import {
  getMemoryContext,
  recordExchange,
  compactIfNeeded,
  defaultMemorySummarizer
} from "./services/aiMemory.js";
import { database } from "./database.js";
import { checkAIQuota, consumeAIQuota, withAIConcurrency } from "./aiQuota.js";
import { setWatchSender, startWatchScheduler } from "./services/episodeWatchService.js";
import { setDigestSender, startDigestScheduler } from "./services/digestService.js";
import { startBackupScheduler } from "./services/backupService.js";
import {
  assessDowntime,
  formatDowntimeDuration,
  formatReturnMessage,
  readLivenessMarker,
  startLivenessHeartbeat
} from "./services/downtimeService.js";
import { dispatchBotCommand, type DispatchInfo } from "./commandDispatch.js";
import { handleAgentMessage, messageAddressesBot, type AgentMessageInfo, type AgentExecutor } from "./services/agentRunner.js";
import { handleIncomingCalls } from "./services/callGate.js";
import { describeMessageMedia, extractQuotedText } from "./utils/quotedMedia.js";
import { getRecentMessage, recordRecentMessage } from "./services/recentMessages.js";
import { peekPendingConfirmation } from "./services/agentBrain.js";
import { hasPendingLanguageConfirm, bareLanguageAnswer } from "./commands/novabox.js";
import { bareYtvChoiceAnswer, hasPendingYtvChoice } from "./commands/ytvideo.js";
import { checkAsrBudget, chargeAsrBudget, isAsrEnabled, transcribeVoiceNote } from "./services/voiceTranscribe.js";
import { getAnimeChoiceContext, messageSuggestsAnimeHistory } from "./services/animeChoices.js";
import { isBannedUser, touchGroup, touchUser } from "./userDirectory.js";
import { setAnnounceSender } from "./services/announcementService.js";


const groupMetadataCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds cache
const CACHE_MAX_ENTRIES = 500; // M7: bound memory for departed/unused groups

export function invalidateGroupMetadataCache(groupId?: string) {
  if (groupId) {
    groupMetadataCache.delete(groupId);
  } else {
    groupMetadataCache.clear();
  }
}

export async function getCachedGroupMetadata(sock: any, groupId: string) {
  const cached = groupMetadataCache.get(groupId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  try {
    const metadata = await sock.groupMetadata(groupId);
    groupMetadataCache.set(groupId, { data: metadata, timestamp: Date.now() });
    if (groupMetadataCache.size > CACHE_MAX_ENTRIES) {
      const oldest = groupMetadataCache.keys().next().value as string | undefined;
      if (oldest) groupMetadataCache.delete(oldest);
    }
    return metadata;
  } catch (err) {
    return cached ? cached.data : null;
  }
}

export type ConnectionStatus = "disconnected" | "connecting" | "qr_ready" | "pairing_code_ready" | "connected" | "error";

export type ConnectionMode = "qr" | "pair_code";

interface BotState {
  status: ConnectionStatus;
  qrCode: string;
  pairingCode: string;
  pairingNumber: string;
  pairingExpiresAt: number | null;
  connectionMode: ConnectionMode;
  logs: string[];
  socket: any | null;
  reconnectCount: number;
  reconnectTimeout?: NodeJS.Timeout | null;
}

const botState: BotState = {
  status: "disconnected",
  qrCode: "",
  pairingCode: "",
  pairingNumber: "",
  pairingExpiresAt: null,
  connectionMode: "qr",
  logs: ["🤖 Nebula Bot Engine initialized. Ready to start."],
  socket: null,
  reconnectCount: 0,
  reconnectTimeout: null,
};

/**
 * 9.18mmm — notification de (re)connexion, DÉCISION OWNER 18/10 : le
 * « is online and connected! » à chaque reconnexion n'était PAS un spam
 * pour lui — 9.18ggg (P6) l'avait supprimé sur lecture de l'audit, il
 * revient INTÉGRALEMENT, amélioré :
 *  - première connexion du démarrage → le message classique ;
 *  - chaque reconnexion → « reconnecté ⚡ » avec la CAUSE (flux synchronisé
 *    515/428 = routine WhatsApp, vs connexion perdue 408) et le temps de
 *    rétablissement — l'owner sait d'un coup d'œil si c'est bénin ;
 *  - vraie chute (assessDowntime) → message de downtime détaillé (priorité).
 */
let bootOpenNotified = false;

/** Mémo de la dernière fermeture (cause de la reconnexion suivante). */
export interface DisconnectMemo {
  statusCode: number | null;
  /** true = 515/428/restartRequired (flux synchronisé — routine WhatsApp). */
  routine: boolean;
  at: number;
}

let lastDisconnectMemo: DisconnectMemo | null = null;

/** Plus vieille reconnexion qu'on décrive encore en « rétabli en X s ». */
const RECONNECT_MEMO_MAX_MS = 10 * 60_000;

/**
 * Message « en ligne » pour l'owner (pur, testé) :
 *  - démarrage du process (ou mémo périmé > 10 min = facto un redémarrage)
 *    → le message classique que l'owner aime retrouver ;
 *  - reconnexion fraîche → cause + temps de rétablissement.
 */
export function formatOnlineNotice(
  botName: string,
  prefix: string,
  firstBootOpen: boolean,
  memo: DisconnectMemo | null,
  now = Date.now()
): string {
  const classic = `🌌 *${botName}* is online and connected!\nPrefix: \`${prefix}\``;
  if (firstBootOpen || !memo) return classic;
  const elapsed = now - memo.at;
  if (elapsed > RECONNECT_MEMO_MAX_MS) return classic;
  const secs = Math.max(1, Math.round(elapsed / 1000));
  const cause = memo.routine
    ? "flux synchronisé (routine WhatsApp)"
    : memo.statusCode === 408
      ? "connexion perdue puis rétablie"
      : "reconnexion";
  return `🌌 *${botName}* reconnecté ⚡\n${cause} — rétabli en ${secs} s\nPrefix: \`${prefix}\``;
}

/** M6: mask a WhatsApp number in logs (keep only the last 4 digits). */
export function maskLogNumber(value: string): string {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  if (digits.length <= 4) return "…" + digits;
  return "…" + digits.slice(-4);
}

/** M6: when logging is set to content-off (default), never echo message text. */
const LOG_MESSAGE_CONTENT = process.env.NEBULA_LOG_CONTENT === "1";

export function maskLogText(text: string): string {
  if (LOG_MESSAGE_CONTENT) {
    return text.substring(0, 60) + (text.length > 60 ? "..." : "");
  }
  return "[content hidden]";
}

export function addLog(message: string) {
  const timestamp = new Date().toLocaleTimeString();
  const formattedLog = `[${timestamp}] ${message}`;
  botState.logs.push(formattedLog);
  // Keep logs capped at 200 items for memory efficiency
  if (botState.logs.length > 200) {
    botState.logs.shift();
  }
  console.log(formattedLog);
}

export function getBotState() {
  return {
    status: botState.status,
    qrCode: botState.qrCode,
    pairingCode: botState.pairingCode,
    pairingNumber: botState.pairingNumber,
    pairingExpiresAt: botState.pairingExpiresAt,
    connectionMode: botState.connectionMode,
    logs: botState.logs,
  };
}

/**
 * 9.18ggg — budget de reconnexion (audit 17/10 §3) : 5 tentatives à 5 s,
 * puis une pause longue de 5 min et un NOUVEAU budget — indéfiniment.
 * L'ancien comportement s'arrêtait DÉFINITIVEMENT au 5e échec consécutif
 * alors que le process vivait (health-check 200, superviseur sans
 * incident) : plus personne ne relançait jamais le bot.
 */
export const RECONNECT_SERIES = 5;
export const RECONNECT_LONG_PAUSE_MS = 5 * 60_000;

export interface ReconnectPlan {
  delayMs: number;
  /** Nouveau compteur après décision. */
  count: number;
  /** true = série épuisée → pause longue avant une nouvelle série. */
  longPause: boolean;
}

export function nextReconnectPlan(reconnectCount: number): ReconnectPlan {
  if (reconnectCount >= RECONNECT_SERIES) {
    return { delayMs: RECONNECT_LONG_PAUSE_MS, count: 0, longPause: true };
  }
  return { delayMs: 5_000, count: reconnectCount + 1, longPause: false };
}

/**
 * 9.18xx — télécommande Nova (agent dans la poche).
 *
 * Exécute un texte EXACTEMENT comme si l'owner l'avait tapé sur WhatsApp :
 *  - préfixe (`.`) → dispatchBotCommand (chemin préfixe éprouvé) ;
 *  - langage naturel → handleAgentMessage (l'agent IA, DM = adressé au bot).
 * Les réponses partent dans le CHAT WHATSAPP de l'owner (OWNER_NUMBER) —
 * le canal naturel : liens de téléchargement, notes vocales, écrans
 * interactifs y arrivent déjà.
 *
 * Garde-fous (décision owner 17/10, patterns recherche API security) :
 *  - texte ≤ 500 chars, non vide ;
 *  - commandes SYSTÈME exclues (stop/update/restart/purge) : elles ont leur
 *    interface dédiée dans Nova → Réglages, pas de doublon d'attaque ;
 *  - moteur déconnecté / OWNER_NUMBER absent → refus honnête ;
 *  - journal d'audit [NOVA] à chaque exécution.
 * Jamais de shell, jamais d'eval : tout passe par le registre typé.
 */
export const REMOTE_EXCLUDED_COMMANDS = new Set(["stop", "update", "restart", "purge"]);

/** Tests uniquement — simule un moteur connecté avec le sock donné. */
export function __setRemoteStateForTests(socket: any, status: string): void {
  botState.socket = socket;
  setLiveSocket(socket); // 9.18ggg — cohérence avec le socket vivant publié
  botState.status = status as any;
}

export async function runAsOwnerCommand(text: string): Promise<{ ok: boolean; message: string }> {
  const t = String(text || "").trim();
  if (!t) return { ok: false, message: "Texte vide." };
  if (t.length > 500) return { ok: false, message: "Texte trop long (max 500 caractères)." };

  const config = getConfig();
  const prefix = config.prefix || ".";
  // Politique AVANT l'état de connexion : commandes système exclues et
  // commande inconnue refusée honnêtement, quoi qu'il arrive au moteur.
  let parsedCommand: { commandName: string; args: string[] } | null = null;
  if (t.startsWith(prefix)) {
    const body = t.slice(prefix.length).trim();
    const args = body.split(/\s+/);
    const commandName = (args.shift() || "").toLowerCase();
    if (REMOTE_EXCLUDED_COMMANDS.has(commandName)) {
      return { ok: false, message: `Commande \`${prefix}${commandName}\` bloquée à distance — utilise l'onglet Réglages de Nova (plus sûr).` };
    }
    if (!getCommand(commandName)) {
      return { ok: false, message: `Commande inconnue \`${prefix}${commandName}\` — \`${prefix}menu\` pour la liste.` };
    }
    parsedCommand = { commandName, args };
  }
  const ownerDigits = String(process.env.OWNER_NUMBER || config.ownerNumber || "").replace(/\D/g, "");
  if (ownerDigits.length < 8) {
    return { ok: false, message: "OWNER_NUMBER non configuré — la télécommande ne sait pas où répondre." };
  }
  // 9.18yy (F6) : livrer au LID mémorisé quand on le connaît (routage
  // direct), sinon au PN — même politique que le digest et le « bot en ligne ».
  const ownerJid = ownerDeliveryJid(ownerDigits);
  const sock = botState.socket;
  if (!sock || botState.status !== "connected") {
    return { ok: false, message: "Le moteur WhatsApp n'est pas connecté — réessaie quand le bot est en ligne." };
  }

  // Message synthétique : les réponses (reply/quoted) partent vers ce chat.
  const synthMsg = {
    key: { remoteJid: ownerJid, fromMe: false, id: `3EB0NOVA${Date.now().toString(16).toUpperCase()}` },
    message: { conversation: t },
    pushName: "Nova Remote",
  };
  const info: DispatchInfo = {
    senderJid: ownerJid,
    actorJid: ownerJid,
    senderName: "Nova (télécommande)",
    senderNumber: ownerDigits,
    isOwner: true,
    isAdmin: false,
    isGroup: false,
    prefix,
    text: t,
    messageContent: synthMsg.message,
  };

  try {
    if (parsedCommand) {
      const outcome = await dispatchBotCommand(sock, synthMsg, info, parsedCommand.commandName, parsedCommand.args, "prefix");
      addLog(`[NOVA] 📱 commande distante : ${t.slice(0, 80)}`);
      return {
        ok: outcome.ok && !outcome.hadError && !outcome.denied,
        message: "✓ Exécuté — la réponse arrive sur WhatsApp.",
      };
    }
    // Langage naturel → l'agent IA (répond dans le chat owner, voix comprise).
    const exec: AgentExecutor = (commandName, args) =>
      dispatchBotCommand(sock, synthMsg, info, commandName, args, "agent");
    const agentInfo: AgentMessageInfo = {
      senderJid: ownerJid,
      actorJid: ownerJid,
      actorNumber: ownerDigits,
      senderName: "Nova (télécommande)",
      isOwner: true,
      text: t,
      botName: config.botName,
      prefix,
      mediaHint: null,
      quotedTextExcerpt: null,
      voiceNote: false,
    };
    const handled = await handleAgentMessage(sock, synthMsg, agentInfo, exec);
    if (!handled) return { ok: false, message: "Le message n'a pas abouti (agent indisponible ?)." };
    addLog(`[NOVA] 📱 message agent distant : ${t.slice(0, 80)}`);
    return { ok: true, message: "Agent sollicité — la réponse arrive sur WhatsApp." };
  } catch (e: any) {
    return { ok: false, message: `Échec : ${String(e?.message || e).slice(0, 120)}` };
  }
}

export function clearLogs() {
  botState.logs = ["🤖 Logs cleared."];
}

/** Decodes a data: URI into a Buffer (used for AI-generated images). */
export function bufferFromDataUri(dataUri: string): Buffer | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUri);
  if (!match) return null;
  try {
    return Buffer.from(match[3], "base64");
  } catch {
    return null;
  }
}

/** Minimal mock socket so simulator runs of sock-dependent commands don't crash. */
function createMockSocket(capture: {
  replyText: () => string;
  setReply: (text: string) => void;
  setImageUrl: (url: string) => void;
  setEmoji: (emoji: string) => void;
}) {
  return {
    sendMessage: async (jid: string, content: any) => {
      if (content?.text !== undefined) {
        capture.setReply(String(content.text));
      }
      if (content?.image !== undefined) {
        const url = typeof content.image === "string" ? content.image : content.image?.url;
        if (url) capture.setImageUrl(String(url));
      }
      if (content?.video !== undefined) {
        const url = typeof content.video === "string" ? content.video : content.video?.url;
        if (url) capture.setImageUrl(String(url));
      }
      if (content?.react !== undefined) {
        capture.setEmoji(String(content.react.text ?? content.react));
      }
      return {};
    },
    groupMetadata: async (jid: string) => ({
      id: jid || "1234567890@g.us",
      participants: [
        { id: "1234567890@s.whatsapp.net", admin: "admin" },
        { id: "9876543210@s.whatsapp.net", admin: null }
      ],
      subject: "Nebula Simulator Group",
      desc: "Simulated sandbox playground for testing Nebula commands",
      owner: "1234567890@s.whatsapp.net"
    }),
    groupParticipantsUpdate: async (jid: string, participants: string[], action: string) => {
      addLog(`[Simulator Group] Participants ${participants.join(", ")}: action "${action}" simulated on ${jid}`);
      return [];
    },
    groupSettingUpdate: async (jid: string, setting: string, value: string) => {
      addLog(`[Simulator Group] Update setting "${setting}" to "${value}" on ${jid}`);
    },
    groupUpdateSubject: async (jid: string, subject: string) => {
      addLog(`[Simulator Group] Update subject to "${subject}" on ${jid}`);
    },
    groupUpdateDescription: async (jid: string, description: string) => {
      addLog(`[Simulator Group] Update description to "${description}" on ${jid}`);
    },
    groupInviteCode: async (jid: string) => {
      return "nebula-simulated-invite-code";
    },
    groupAcceptInvite: async (code: string) => {
      addLog(`[Simulator Group] Accepted invite code: ${code}`);
      return "1234567890@g.us";
    },
    groupLeave: async (jid: string) => {
      addLog(`[Simulator Group] Bot left group ${jid}`);
    },
    profilePictureUrl: async (jid: string, type?: "image" | "preview") => {
      return "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=150";
    },
    sendPresenceUpdate: async (type: "unavailable" | "available" | "composing" | "recording" | "paused", to?: string) => {
      addLog(`[Simulator Presence] Set status to "${type}"${to ? ` for ${to}` : ""}`);
    },
    user: { id: "1234567890:1" },
    ev: { on: () => {} },
    downloadContentFromMessage: async () => [],
  };
}

// Simulated execution for the web play-zone
export async function simulateMessage(senderName: string, text: string): Promise<{ text: string; imageUrl?: string; emoji?: string }> {
  addLog(`[Simulator] Message from ${senderName}: "${maskLogText(text)}"`);

  const config = getConfig();
  const prefix = config.prefix;

  if (text === "🎙️ [Voice Note]") {
    return {
      text: `🎙️ *Nebula Audio Processor:* Voice note of *0:07* received successfully.\n\n_I have parsed the binary stream buffer and visualized the wave frequencies. Type \`${prefix}menu\` to see what textual commands you can send!_`,
      emoji: "🎵"
    };
  }

  // Check if starts with prefix
  if (!text.startsWith(prefix)) {
    if (isAIConfigured()) {
      try {
        const aiAnswer = await generateTextWithFallback(
          text,
          getPersonaPrompt("dm", config.botName),
          "gemini-3.7-flash"
        );
        addLog(`[Simulator Direct AI] Generated direct reply for "${maskLogText(text)}"`);
        return { text: aiAnswer, emoji: "🤖" };
      } catch (err: any) {
        addLog(`[Simulator Direct AI Error] ${err.message}`);
      }
    }

    return {
      text: `🤖 Hello! I am ${config.botName}.\n\n💬 *Direct AI Chat:* Send any natural message in private chat to chat with AI directly, or type \`${prefix}menu\` to browse all commands!`,
      emoji: "🤖",
    };
  }

  // Parse command
  const body = text.slice(prefix.length).trim();
  const args = body.split(/\s+/);
  const commandName = args.shift()?.toLowerCase() || "";

  const command = getCommand(commandName);
  if (!command) {
    return { text: `❌ *Error:* Command \`${prefix}${commandName}\` not found. Type \`${prefix}menu\` for a list of commands.` };
  }

  let replyText = "";
  let replyImageUrl: string | undefined = undefined;
  let reactionEmoji: string | undefined = undefined;

  // Mock sock + msg so commands that send directly (hidetag, download) work too.
  const mockSock = createMockSocket({
    replyText: () => replyText,
    setReply: (t) => { replyText = t; },
    setImageUrl: (u) => { replyImageUrl = u; },
    setEmoji: (e) => { reactionEmoji = e; },
  });

  const mockMsg = {
    key: { remoteJid: "1234567890@g.us", fromMe: false, id: "SIMULATED", participant: "1234567890@s.whatsapp.net" },
    message: { extendedTextMessage: { text, contextInfo: { mentionedJid: [] } } },
    pushName: senderName,
  };

  // Mock context
  const mockContext: BotCommandContext = {
    sender: "1234567890@g.us", // Group jid so group-only commands are testable
    senderName,
    isOwner: true, // Simulator user is simulated as owner to test all commands
    isAdmin: true, // ...and as group admin to test admin commands
    prefix,
    commandName,
    args,
    fullMessage: text,
    reply: async (replyMsg: string, mediaUrl?: string) => {
      replyText = replyMsg;
      replyImageUrl = mediaUrl;
      addLog(`[Simulator Reply] ${replyMsg.slice(0, 100)}${replyMsg.length > 100 ? "..." : ""}`);
      return {};
    },
    react: async (emoji: string) => {
      reactionEmoji = emoji;
      addLog(`[Simulator Reaction] ${emoji}`);
      return {};
    },
    downloadMedia: async () => {
      addLog(`[Simulator Media] Simulated downloading dummy media.`);
      return Buffer.from("dummy media");
    },
    getGroupMetadata: async (jid: string) => {
      return {
        id: jid,
        subject: "Nebula Simulator Group",
        participants: [
          { id: "1234567890@s.whatsapp.net", admin: "superadmin" },
          { id: "9876543210@s.whatsapp.net", admin: "admin" },
          { id: "5551234567@s.whatsapp.net", admin: null },
          { id: "5559876543@s.whatsapp.net", admin: null },
        ],
      };
    },
    getGroupMembers: async (_jid: string) => {
      return [
        { id: "1234567890@s.whatsapp.net", number: "1234567890", admin: "superadmin" },
        { id: "9876543210@s.whatsapp.net", number: "9876543210", admin: "admin" },
        { id: "5551234567@s.whatsapp.net", number: "5551234567", admin: null },
        { id: "5559876543@s.whatsapp.net", number: "5559876543", admin: null },
      ];
    },
    updateParticipants: async (jid: string, participants: string[], action: string) => {
      addLog(`[Simulator Group] Participants [${participants.join(", ")}] action: ${action} on ${jid}`);
      return [];
    },
    kickMember: async (jid: string, participantJid: string) => {
      addLog(`[Simulator Kick] Member ${participantJid} kicked from ${jid}`);
      return [];
    },
    promoteMember: async (jid: string, participantJid: string) => {
      addLog(`[Simulator Promote] Member ${participantJid} promoted to admin in ${jid}`);
      return [];
    },
    demoteMember: async (jid: string, participantJid: string) => {
      addLog(`[Simulator Demote] Admin ${participantJid} demoted in ${jid}`);
      return [];
    },
  };


  try {
    incrementCommandStats(commandName);
    await command.execute(mockSock, mockMsg, mockContext);
    return { text: replyText, imageUrl: replyImageUrl, emoji: reactionEmoji };
  } catch (error: any) {
    addLog(`[Simulator Error] Failed to execute ${commandName}: ${error.message}`);
    return { text: `❌ *System Error executing command:* ${error.message || error}` };
  }
}

// Live Baileys startup
// Serialized: concurrent start calls (manual button + API + reconnect timer)
// previously raced and could create two live sockets. A single in-flight
// promise now guarantees one socket per (re)start cycle.
let startInFlight: Promise<void> | null = null;

export function startLiveBot(isManualStart = false, pairingPhone?: string): Promise<void> {
  if (startInFlight) return startInFlight;
  startInFlight = runStartLiveBot(isManualStart, pairingPhone).finally(() => {
    startInFlight = null;
  });
  return startInFlight;
}

async function runStartLiveBot(isManualStart = false, pairingPhone?: string) {
  if (botState.status === "connected") {
    addLog("⚠️ Bot is already connected.");
    return;
  }

  // 9.18zz — marqueur de vie : on capture l'état AVANT que les heartbeats
  // de ce process ne le rafraîchissent. Périmé = le moteur était absent
  // (chute / reboot / arrêt) → la reconnexion notifiera la durée à l'owner.
  const bootAliveAt = readLivenessMarker()?.at ?? null;
  startLivenessHeartbeat();

  if (pairingPhone) {
    botState.connectionMode = "pair_code";
    botState.pairingNumber = pairingPhone.replace(/[^0-9]/g, "");
    botState.pairingCode = "";
    botState.pairingExpiresAt = null;
  }

  // Clear any pending reconnection timer
  if (botState.reconnectTimeout) {
    clearTimeout(botState.reconnectTimeout);
    botState.reconnectTimeout = null;
  }

  // Safely end any lingering socket to prevent duplicate connections and conflict events
  if (botState.socket) {
    try {
      addLog("🧹 Cleaning up duplicate/lingering socket connection...");
      (botState.socket as any).isClosedByEngine = true;
      botState.socket.end(new Error("Superseded by new connection request"));
      if ((botState.socket as any).ws?.terminate) {
        (botState.socket as any).ws.terminate();
      } else if ((botState.socket as any).ws?.close) {
        (botState.socket as any).ws.close();
      }
    } catch (e) {}
    botState.socket = null;
    setLiveSocket(null);
  }

  addLog(pairingPhone ? `🔌 Starting Baileys in Pairing Code mode for +${botState.pairingNumber}...` : "🔌 Starting Baileys Live Connection (QR mode)...");
  botState.status = "connecting";
  botState.qrCode = "";
  // Only a manual start (button / API) resets the reconnection budget.
  // Reconnect-timer calls must NOT reset it, or the 5-attempt limit never triggers.
  if (isManualStart) {
    botState.reconnectCount = 0;
  }

  try {
    if (!isRegistryReady()) await initRegistry(); // 8.56: server.ts already init at boot

    // Auth state directory
    const authDir = process.env.NEBULA_AUTH_DIR || "nebula_auth_info";
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const cfg = getConfig();
    const browserPlatform = cfg.browserPlatform?.trim() || "Ubuntu";
    const browserName = cfg.browserName?.trim() || "Chrome";
    const browserVersion = cfg.browserVersion?.trim() || "22.04.4";

    addLog(`🌐 Connecting to WhatsApp using Web API v${version.join(".")} [Browser Signature: ${browserPlatform} · ${browserName} · ${browserVersion}]`);

    // Use makeCacheableSignalKeyStore to prevent Signal protocol key race conditions during pairing handshake
    const pinoLogger = pino({ level: "silent" }) as any;
    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pinoLogger),
      },
      printQRInTerminal: false,
      logger: pinoLogger,
      browser: [browserPlatform, browserName, browserVersion],
      syncFullHistory: false,
      markOnlineOnConnect: true,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      // 9.18ggg : 30 s = le défaut Baileys. Le 10 s d'avant abaissait le
      // seuil d'auto-coupure « 408 Connection was lost » à 15 s de silence
      // reçu (keepAliveIntervalMs + 5 s dans socket.js) : une pause GC/CPU
      // pendant un gros média suffisait à couper la connexion (audit 17/10 §2).
      keepAliveIntervalMs: 30_000,
      generateHighQualityLinkPreview: false,
      retryRequestDelayMs: 250,
    });

    botState.socket = sock;
    setLiveSocket(sock); // 9.18ggg — socket vivant publiable pour les envois tardifs

    // If account is already registered, ensure pairing mode flags are cleared
    if (state.creds.registered || state.creds.me?.id) {
      botState.connectionMode = "qr";
      botState.pairingCode = "";
      botState.pairingNumber = "";
      botState.pairingExpiresAt = null;
    }

    // Asynchronous pairing code generator with retry loop for handshake stability
    const triggerPairingCodeHandshake = async (phoneToPair: string) => {
      if (state.creds.registered || state.creds.me?.id || (botState.status as string) === "connected") return;

      addLog(`🔑 Initiating WhatsApp pairing code handshake for +${phoneToPair}...`);
      const maxAttempts = 6;
      let attempt = 0;

      while (attempt < maxAttempts) {
        attempt++;
        if ((sock as any).isClosedByEngine || (botState.status as string) === "connected" || sock.authState?.creds?.registered || sock.authState?.creds?.me?.id) {
          return;
        }

        // Wait before attempt so Baileys WebSocket has established its connection
        await new Promise((r) => setTimeout(r, attempt === 1 ? 2500 : 2000));

        if ((sock as any).isClosedByEngine || (botState.status as string) === "connected" || sock.authState?.creds?.registered || sock.authState?.creds?.me?.id) {
          return;
        }

        try {
          addLog(`📲 Requesting 8-digit pairing code from WhatsApp servers (attempt ${attempt}/${maxAttempts})...`);
          const rawCode = await sock.requestPairingCode(phoneToPair);
          if (rawCode) {
            const formattedCode = rawCode?.match(/.{1,4}/g)?.join("-") || rawCode;
            botState.pairingCode = formattedCode;
            botState.status = "pairing_code_ready";
            botState.pairingExpiresAt = Date.now() + 120000; // 2 min expiration
            addLog(`✨ WhatsApp Pairing Code generated: ${formattedCode}. Enter this on your phone in WhatsApp > Linked Devices > Link with phone number instead.`);
            return;
          }
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          if (attempt < maxAttempts && !sock.authState?.creds?.registered && (botState.status as string) !== "connected") {
            addLog(`⏳ Waiting for WhatsApp connection to stabilize (${errMsg}). Retrying in 2s (attempt ${attempt}/${maxAttempts})...`);
          } else if (!sock.authState?.creds?.registered && (botState.status as string) !== "connected") {
            addLog(`❌ Failed to generate pairing code after ${maxAttempts} attempts: ${errMsg}`);
            botState.status = "error";
          }
        }
      }
    };

    // If pairing code mode was explicitly triggered with a phone number and account is not yet registered
    if (pairingPhone && botState.connectionMode === "pair_code" && !state.creds.registered && !state.creds.me?.id) {
      triggerPairingCodeHandshake(pairingPhone);
    }

    // Listen to connection updates
    sock.ev.on("connection.update", (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && botState.connectionMode !== "pair_code" && !state.creds.registered && !state.creds.me?.id) {
        botState.status = "qr_ready";
        botState.qrCode = qr;
        addLog("📟 QR Code generated. Scan to login!");
      }

      if (connection === "connecting") {
        if (botState.status !== "pairing_code_ready") {
          botState.status = "connecting";
        }
        addLog("⚡ Re-establishing WebSocket connection...");
      }

      if (connection === "open") {
        botState.status = "connected";
        botState.qrCode = "";
        botState.pairingCode = "";
        botState.pairingNumber = "";
        botState.pairingExpiresAt = null;
        botState.connectionMode = "qr";
        botState.reconnectCount = 0;
        addLog("✅ Nebula Bot is officially CONNECTED to WhatsApp!");

        // Notify owner if a valid number is configured (avoids messaging random placeholder numbers)
        const config = getConfig();
        const envOwnerNumber = (process.env.OWNER_NUMBER || "").trim();
        const configuredOwner = envOwnerNumber || config.ownerNumber;
        const ownerDigits = configuredOwner.replace(/[^0-9]/g, "");
        if (ownerDigits.length >= 8) {
          // 9.18yy (F6) : LID mémorisé en priorité (routage direct), sinon PN.
          const ownerJid = ownerDeliveryJid(ownerDigits);
          // 9.18zz : si le marqueur capturé au démarrage était périmé, le
          // moteur était réellement tombé — on chiffre la coupure au lieu
          // du simple « online » (notification de chute sans FCM).
          const downtime = assessDowntime(bootAliveAt, Date.now());
          if (downtime.notify) {
            addLog(`🔄 [CHUTE] retour après ${formatDowntimeDuration(downtime.downtimeMs)} d'indisponibilité`);
            sock.sendMessage(ownerJid, { text: formatReturnMessage(config.botName, downtime) }).catch(() => {});
          } else {
            // 9.18mmm (décision owner 18/10) : à CHAQUE (re)connexion — le
            // message classique au démarrage, cause + temps de rétablissement
            // sur les reconnexions de routine.
            sock.sendMessage(ownerJid, {
              text: formatOnlineNotice(config.botName, config.prefix, !bootOpenNotified, lastDisconnectMemo),
            }).catch(() => {});
          }
          bootOpenNotified = true;
          lastDisconnectMemo = null;
        }

        // Episode watcher (`.a watch`, audit S4): refresh the sender with the
        // live socket on every (re)connection, then start the scheduler once.
        setWatchSender(async (chatJid, text) => {
          await sock.sendMessage(chatJid, { text });
        });
        startWatchScheduler();

        // 8.99 — digest quotidien du propriétaire (8 h, NEBULA_DIGEST=0 off)
        // : même pattern que le watcher — sender réinjecté à chaque
        // (re)connexion, planificateur démarré une seule fois.
        setDigestSender(async (text) => {
          if (ownerDigits.length >= 8) {
            // 9.18yy (F6) : livrer au LID connu — un matin de routing PN→LID
            // manqué ne doit plus faire perdre le digest.
            await sock.sendMessage(ownerDeliveryJid(ownerDigits), { text });
          }
        });
        startDigestScheduler();

        // 9.18yy — sauvegarde quotidienne du dossier de données du bot
        // (audit 16/10) : chaque moteur sauvegarde SON NEBULA_DATA_DIR,
        // NEBULA_BACKUP=0 coupe, rétention 7, journalisée dans le Journal.
        startBackupScheduler((message) => addLog(message));

        // 9.16 — annonces du dashboard : sender réinjecté à chaque
        // (re)connexion, même pattern que le digest et le watcher.
        setAnnounceSender(async (jid, text) => {
          await sock.sendMessage(jid, { text });
        });
      }

      if (connection === "close") {
        if ((sock as any).isClosedByEngine || (botState.socket && botState.socket !== sock)) {
          addLog("🧹 Ignored close event of superseded/closed socket.");
          return;
        }

        botState.qrCode = "";
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode || (lastDisconnect?.error as any)?.statusCode;
        const errMessage = lastDisconnect?.error?.message || "unknown";
        const isConflict = statusCode === 401 && String(errMessage).toLowerCase().includes("conflict");

        // If logged out or bad session, we must stop reconnection and clear directory to prevent "Stream Errored (conflict)" loops
        const isBadSession = statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.badSession || statusCode === 403 || isConflict;
        const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515 || statusCode === 428;
        const shouldReconnect = !isBadSession;
        // 9.18mmm : mémoire de la cause — le prochain « open » pourra dire à
        // l'owner POURQUOI on s'est reconnecté et en combien de temps.
        lastDisconnectMemo = { statusCode: statusCode ?? null, routine: isRestartRequired, at: Date.now() };

        if (isRestartRequired) {
          addLog("🔄 WhatsApp session synchronized / stream refresh (Status Code: 515). Resuming connection with saved credentials in 1.2s...");
          botState.status = "connecting";
        } else if (isConflict) {
          addLog(`⚠️ WhatsApp Stream conflict detected (Status Code: 401). Another active session or unlinked device was detected. Auth cache reset cleanly.`);
          botState.status = "disconnected";
        } else {
          addLog(`❌ Connection closed. Reason: ${errMessage} (Status Code: ${statusCode}). Reconnect: ${shouldReconnect}`);
          botState.status = "disconnected";
        }

        botState.socket = null;
        setLiveSocket(null);

        if (isBadSession) {
          addLog("🗑️ Session is invalid, unlinked, or conflicted. Clearing stored credentials to allow a clean fresh scan/pairing...");
          try {
            if (fs.existsSync(authDir)) {
              fs.rmSync(authDir, { recursive: true, force: true });
              fs.mkdirSync(authDir, { recursive: true });
              addLog("✨ Stored credentials cleared and refreshed successfully.");
            }
          } catch (e: any) {
            addLog(`⚠️ Failed to clear credentials: ${e.message}`);
          }
        }

        if (shouldReconnect) {
          let delayMs = 5000;
          if (isRestartRequired) {
            delayMs = 1200; // Allow credentials to flush to disk before re-initializing
          } else {
            // 9.18ggg : PLUS D'ARRÊT DÉFINITIF AU 5e ÉCHEC — le process
            // vivait (health-check 200) et plus personne ne relançait le
            // bot (audit 17/10 §3). Le budget se renouvelle après une
            // pause longue, indéfiniment.
            const plan = nextReconnectPlan(botState.reconnectCount);
            botState.reconnectCount = plan.count;
            if (plan.longPause) {
              addLog(`⏳ ${RECONNECT_SERIES} échecs consécutifs — pause de ${Math.round(plan.delayMs / 60000)} min puis reprise des tentatives (le moteur reste debout).`);
            } else {
              addLog(`🔄 Attempting reconnect (${plan.count}/${RECONNECT_SERIES}) in 5 seconds...`);
            }
            delayMs = plan.delayMs;
          }

          if (botState.reconnectTimeout) {
            clearTimeout(botState.reconnectTimeout);
          }

          // Mark this socket as superseded so future duplicate close events are discarded
          (sock as any).isClosedByEngine = true;

          botState.reconnectTimeout = setTimeout(() => {
            botState.reconnectTimeout = null;
            // On automatic reconnection or restartRequired, boot with saved auth credentials directly
            startLiveBot(false);
          }, delayMs);
        } else {
          addLog("🚫 Logged out or bad session. Ready for fresh pairing or QR scan.");
        }
      }
    });

    sock.ev.on("creds.update", async () => {
      try {
        const authDir = process.env.NEBULA_AUTH_DIR || "nebula_auth_info";
        if (!fs.existsSync(authDir)) {
          fs.mkdirSync(authDir, { recursive: true });
        }
        await saveCreds();
        // If pairing was completed on phone, update mode
        if (state.creds.registered || state.creds.me?.id) {
          botState.connectionMode = "qr";
        }
      } catch (err: any) {
        // Silently swallow ENOENT if directory is being reset
        if (err?.code !== "ENOENT") {
          console.error("Failed to save credentials:", err?.message || err);
        }
      }
    });

    // Invalidate group metadata cache when group participants or settings change
    sock.ev.on("groups.update", async (updates: any[]) => {
      for (const update of updates) {
        if (update?.id) invalidateGroupMetadataCache(update.id);
      }
    });

    // Welcome / goodbye messages when members join or leave groups
    sock.ev.on("group-participants.update", async (update: any) => {
      const { id, participants, action } = update;
      if (!id) return;
      // Invalidate metadata cache so admin promotions/demotions and participant lists stay immediately up-to-date
      invalidateGroupMetadataCache(id);

      if (!Array.isArray(participants) || !action) return;
      if (action !== "add" && action !== "remove") return;

      try {
        const settings = database.getGroupSettings(id);
        const enabled = action === "add" ? settings.welcome : settings.goodbye;
        if (!enabled) return;

        const metadata = await getCachedGroupMetadata(sock, id);
        const groupName = metadata?.subject || "this group";

        for (const participant of participants) {
          const jid = typeof participant === "string" ? participant : participant?.id;
          if (!jid || jid.endsWith("@g.us")) continue;
          const number = jid.split("@")[0].replace(/[^0-9]/g, "");
          if (!number) continue;

          const template = action === "add" ? settings.welcomeMessage : settings.goodbyeMessage;
          const message = template
            .replace(/@user/g, `@${number}`)
            .replace(/@group/g, groupName);

          await sock.sendMessage(id, {
            text: message,
            mentions: [jid],
          }).catch(() => {});
          addLog(`👋 ${action === "add" ? "Welcome" : "Goodbye"} message sent to @${number} in ${id}`);
        }
      } catch (e: any) {
        addLog(`⚠️ Failed to send ${action} message: ${e?.message || e}`);
      }
    });

    // Message handler with memory guards
    // 9.18jj (A) — décrochage honnête : rejet propre + guidage note vocale.
    sock.ev.on("call", (calls: any[]) => {
      void handleIncomingCalls(sock, calls, { prefix: getConfig().prefix || "." });
    });

    sock.ev.on("messages.upsert", async (m: any) => {
      if (m.type !== "notify") return;

      for (const msg of m.messages) {
        if (!msg.message) continue;

        // 9.8 : registre borné des messages récents (reçus ET émis) —
        // résout les replies dont la citation a été épurée (chat éphémère).
        recordRecentMessage(String(msg.key?.remoteJid || ""), String(msg.key?.id || ""), msg.message);

        // Unwrap ephemeral, viewOnce, or other wrapper messages
        let messageContent = msg.message;
        if (messageContent.ephemeralMessage) {
          messageContent = messageContent.ephemeralMessage.message || {};
        }
        if (messageContent.viewOnceMessage) {
          messageContent = messageContent.viewOnceMessage.message || {};
        }
        if (messageContent.viewOnceMessageV2) {
          messageContent = messageContent.viewOnceMessageV2.message || {};
        }
        if (messageContent.documentWithCaptionMessage) {
          messageContent = messageContent.documentWithCaptionMessage.message || {};
        }

        if (!messageContent) continue;

        // Extract text from the unwrapped message
        const text = messageContent.conversation ||
                     messageContent.extendedTextMessage?.text ||
                     messageContent.imageMessage?.caption ||
                     messageContent.videoMessage?.caption ||
                     messageContent.templateButtonReplyMessage?.selectedId ||
                     messageContent.buttonsResponseMessage?.selectedButtonId ||
                     messageContent.listResponseMessage?.singleSelectReply?.selectedRowId ||
                     "";

        const config = getConfig();
        const prefix = config.prefix;
        const senderJid = msg.key.remoteJid || "";
        const senderNumber = senderJid.split("@")[0];
        const senderName = msg.pushName || "WhatsApp User";
        const isFromMe = !!msg.key.fromMe;

        // Extract precise actual sender info (handles group participants vs DM)
        const actualSenderJid = msg.key.participant || msg.key.remoteJid || "";
        const actualSenderNumber = actualSenderJid.split("@")[0].replace(/[^0-9]/g, "");
        const envOwnerNumber = (process.env.OWNER_NUMBER || "").trim();
        const configuredOwner = envOwnerNumber || config.ownerNumber;
        // 8.89 : le message peut arriver d'un jid @lid (WhatsApp « masquer mon
        // numéro ») — résolution LID→numéro via Baileys puis comparaison
        // EXACTE (helper partagé avec whois ; comportement IDENTIQUE pour les
        // jids téléphone). Fallback NEBULA_OWNER_LID si la table est inconnue.
        const ownerCheck = await resolveOwnerIdentity(sock, actualSenderJid, configuredOwner);
        const isOwner = ownerCheck.isOwner;

        // Add visual live logs to the dashboard so the user knows messages are being processed
        if (text.trim()) {
          addLog(`📨 Message Received: "${maskLogText(text)}" from ${senderName} (${maskLogNumber(senderNumber)}) [fromMe: ${isFromMe}]`);
        }

        // Active Group Moderation Engine
        const isGroup = senderJid.endsWith("@g.us");
        let isSenderAdmin = false;

        if (isGroup && !isFromMe) {
          try {
            const groupMetadata = await getCachedGroupMetadata(sock, senderJid);
            if (groupMetadata) {
              const senderParticipant = groupMetadata.participants.find((p: any) => p.id.split("@")[0] === actualSenderNumber);
              isSenderAdmin = senderParticipant?.admin === "admin" || senderParticipant?.admin === "superadmin";
            }
            // 9.16/9.18 — répertoire : le groupe est connu dès son premier
            // message, avec sa taille (ciblage annonces du dashboard).
            touchGroup(senderJid, {
              name: groupMetadata?.subject,
              memberCount: Array.isArray(groupMetadata?.participants) ? groupMetadata.participants.length : undefined,
            });
          } catch (e) {}
        }

        // 9.16 — répertoire utilisateurs : chaque message (hors échos du bot)
        // rafraîchit fiche, compteurs et dernier contact. Un banni est
        // ignoré par TOUT le moteur ; le propriétaire ne peut jamais l'être.
        if (!isFromMe) {
          // 9.18 — ownerCheck a déjà résolu le LID vers le vrai numéro (pour
          // tout expéditeur @lid, owner ou pas) : on le conserve dans la
          // fiche, zéro appel Baileys supplémentaire.
          touchUser(actualSenderJid, {
            name: msg.pushName || "",
            resolvedNumber: ownerCheck.resolvedNumber || undefined,
          });
          if (!isOwner && isBannedUser(actualSenderJid)) {
            continue;
          }
        }

        // Moderation hooks (antilink/antitag/antibot) were removed with the
        // 8.59 command curation; welcome/goodbye and RoleGuard remain active.
        // Allow owner to run commands on their own session, but ignore regular self messages that don't start with prefix
        if (isFromMe && !text.startsWith(prefix)) {
          continue;
        }

        // 8.93 : infos de dispatch partagées entre le chemin préfixe et l'agent.
        const dispatchInfo: DispatchInfo = {
          senderJid,
          actorJid: actualSenderJid,
          senderName,
          senderNumber,
          isOwner,
          isAdmin: isSenderAdmin,
          isGroup,
          prefix,
          text,
          messageContent,
        };

        // 9.6b/9.11 : contexte de reply pour l'agent — nature du média cité
        // (+ repli registre stanzaId 9.8) et extrait du TEXTE cité (lien,
        // titre — audit B4). Calculés une fois, utilisés en DM ET en groupe.
        let mediaHint = describeMessageMedia(messageContent);
        let quotedTextExcerpt: string | null = null;
        {
          const ctxInfo = messageContent?.extendedTextMessage?.contextInfo;
          const quotedRaw = ctxInfo?.quotedMessage;
          quotedTextExcerpt = extractQuotedText(quotedRaw);
          if (!mediaHint || !quotedTextExcerpt) {
            const stanzaId = ctxInfo?.stanzaId;
            if (stanzaId) {
              const stored = getRecentMessage(senderJid, String(stanzaId));
              if (stored) {
                if (!mediaHint) {
                  const q = describeMessageMedia(stored);
                  if (q) mediaHint = { what: q.what, how: "reply" };
                }
                if (!quotedTextExcerpt) quotedTextExcerpt = extractQuotedText(stored);
              }
            }
          }
        }

        // 9.13/9.15d : note vocale adressée au bot → transcription Gemini
        // (audio natif — l'ASR NIM hébergé n'existe pas, cf. voiceTranscribe),
        // puis tour
        // agent sur le texte obtenu. DM : toujours ; groupe : seulement si le
        // message s'adresse au bot (mention/reply — même porte que 9.11).
        // Échec = réponse honnête, jamais de tour IA sur un texte vide.
        if (!isFromMe && !text.trim() && messageContent.audioMessage) {
          const voiceAddressed = !isGroup || messageAddressesBot(msg, sock?.user?.id);
          if (voiceAddressed) {
            if (!isAsrEnabled()) {
              await sock.sendMessage(senderJid, {
                text: "🎙️ Je ne peux pas encore écouter les notes vocales (transcription désactivée ou clé Gemini absente) — écris-moi ton message."
              }, { quoted: msg });
              continue;
            }
            const budget = checkAsrBudget(actualSenderJid);
            if (!budget.allowed) {
              await sock.sendMessage(senderJid, {
                text: `⏳ Budget transcription atteint (10 notes vocales/heure) — réessaie dans ${budget.retryAfterMin} min ou écris-moi.`
              }, { quoted: msg });
              continue;
            }
            await sock.sendPresenceUpdate("recording", senderJid).catch(() => {});
            try {
              const stream = await downloadContentFromMessage(messageContent.audioMessage, "audio");
              let buffer = Buffer.alloc(0);
              for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
                if (buffer.length > 16 * 1024 * 1024) break;
              }
              const asr = await transcribeVoiceNote(buffer);
              if (!asr.ok) {
                addLog(`[ASR] Échec transcription : ${asr.error}`);
                await sock.sendMessage(senderJid, {
                  text: `🎙️ Je n'ai pas réussi à transcrire cette note vocale (${asr.error}).`
                }, { quoted: msg });
                continue;
              }
              chargeAsrBudget(actualSenderJid);
              addLog(`[ASR] Note vocale transcrite (${asr.text.length} caractères) de ${maskLogNumber(actualSenderNumber)}`);
              if (isAIConfigured()) {
                const handled = await handleAgentMessage(
                  sock,
                  msg,
                  {
                    senderJid,
                    actorJid: actualSenderJid,
                    actorNumber: actualSenderNumber,
                    senderName,
                    isOwner,
                    text: asr.text,
                    voiceNote: true,
                    botName: config.botName,
                    prefix,
                    mediaHint: null,
                    quotedTextExcerpt: null
                  },
                  (commandName, args) =>
                    dispatchBotCommand(sock, msg, dispatchInfo, commandName, args, "agent")
                );
                if (handled) continue;
              } else {
                await sock.sendMessage(senderJid, {
                  text: `🎙️ (transcription) « ${asr.text.slice(0, 800)} »\n\n_L'agent IA est désactivé — la transcription brute ci-dessus._`
                }, { quoted: msg });
                continue;
              }
            } catch (err: any) {
              addLog(`[ASR] Erreur inattendue : ${err?.message || err}`);
              await sock.sendMessage(senderJid, {
                text: "🎙️ Erreur inattendue pendant la transcription — réessaie ou écris-moi."
              }, { quoted: msg });
              continue;
            }
          }
        }

        // Direct AI response in private chat when not starting with prefix.
        // 9.18j (retour terrain 13/10) : text.trim() obligatoire — un média
        // sans caption (sticker, image, document) produisait un tour IA à
        // PROMPT VIDE : Gemini répondait n'importe quoi (« Je suis NOVA… »,
        // « Je suis à ton écoute ! »), brûlait le quota IA et remplissait
        // les logs d'erreurs NIM « Textless prompt ». Les notes vocales
        // restent gérées plus haut (ASR) ; un sticker n'a rien à dire.
        if (!isGroup && !isFromMe && text.trim() && !text.startsWith(prefix)) {
          // 8.95b : question novabox en attente (« continuer en VOSTFR ? ») —
          // un « oui »/« non » nu doit RÉPONDRE À CETTE QUESTION, pas partir
          // dans l'agent IA (qui reformulerait une nouvelle demande).
          // Priorité à la confirmation de l'agent si les deux pendent (elle
          // est alors plus récente : l'agent vient de poser sa question).
          const bareAnswer = bareLanguageAnswer(text);
          if (
            bareAnswer &&
            hasPendingLanguageConfirm(senderJid) &&
            !peekPendingConfirmation(actualSenderJid)
          ) {
            await dispatchBotCommand(sock, msg, dispatchInfo, "a", [bareAnswer], "agent");
            continue;
          }
          // 9.12 (B5, décision owner) : « 1 »/« 2 » nu alors qu'un choix .ytv
          // de CET utilisateur est en attente → consommé SANS tour IA (éco
          // tokens — même logique que la confirmation de langue ci-dessus).
          const bareYtv = bareYtvChoiceAnswer(text);
          if (
            bareYtv &&
            hasPendingYtvChoice(senderJid, actualSenderJid) &&
            !peekPendingConfirmation(actualSenderJid)
          ) {
            await dispatchBotCommand(sock, msg, dispatchInfo, "ytvideo", [bareYtv], "agent");
            continue;
          }
          if (isAIConfigured()) {
            // 8.93 agent beta (privé uniquement) : l'IA traduit la demande
            // naturelle en commande existante et l'exécute aux droits de
            // l'utilisateur (RoleGuard inchangé). Renvoie false → l'IA
            // n'est pas configurée : laisser le chemin normal répondre.
            const handledByAgent = await handleAgentMessage(
              sock,
              msg,
              {
                senderJid,
                actorJid: actualSenderJid,
                actorNumber: actualSenderNumber,
                senderName,
                isOwner,
                text,
                botName: config.botName,
                prefix,
                mediaHint,
                quotedTextExcerpt,
              },
              (commandName, args) =>
                dispatchBotCommand(sock, msg, dispatchInfo, commandName, args, "agent")
            );
            if (handledByAgent) {
              continue;
            }
            const quota = checkAIQuota(actualSenderJid);
            if (!quota.allowed) {
              await sock.sendMessage(senderJid, { text: `⚠️ ${quota.error}` }, { quoted: msg });
              continue;
            }
            try {
              if (sock && typeof sock.sendPresenceUpdate === "function") {
                try {
                  await sock.sendPresenceUpdate("composing", senderJid);
                } catch (pe) {}
              }
              consumeAIQuota(actualSenderJid);
              const memoryBlock = getMemoryContext(senderJid);
              // 8.97/8.99 — dernier téléchargement anime du chat, comme
              // l'agent — mais SEULEMENT si le message y ressemble (leçon
              // Mastra : pas d'historique inutile dans « salut ça va »).
              const choiceBlock = messageSuggestsAnimeHistory(text)
                ? getAnimeChoiceContext(senderJid)
                : null;
              const answer = await withAIConcurrency(() =>
                generateTextWithFallback(
                  text,
                  getPersonaPrompt("dm", config.botName) +
                    (memoryBlock ? `\n\n${memoryBlock}` : "") +
                    (choiceBlock ? `\n\n${choiceBlock}` : ""),
                  "gemini-3.7-flash"
                )
              );
              // Per-conversation memory (audit 8.38) — fire and forget.
              recordExchange(senderJid, text, answer);
              compactIfNeeded(senderJid, defaultMemorySummarizer).catch(() => {});
              if (sock && typeof sock.sendPresenceUpdate === "function") {
                try {
                  await sock.sendPresenceUpdate("paused", senderJid);
                } catch (pe) {}
              }
              await sock.sendMessage(senderJid, { text: answer }, { quoted: msg });
              addLog(`🤖 [AI Direct DM] Replied directly to @${actualSenderNumber} without .ai command`);
              continue;
            } catch (error: any) {
              console.error("[Private Chat AI Error]:", error);
              addLog(`❌ [Private Chat AI Error]: ${error.message}`);
              // 8.71: users used to get TOTAL SILENCE when the AI chain
              // failed (production logs: the same users retrying 3-5x).
              // Honest French notice, same tone as the other messages.
              try {
                await sock.sendMessage(
                  senderJid,
                  { text: "😕 *L’IA est momentanément indisponible.*\n\n🔁 *Réessaie dans un instant.*\n_Si ça persiste, préviens l’administrateur du bot._" },
                  { quoted: msg }
                );
              } catch {}
            }
          } else {
            // Friendly fallback guide if AI key is not yet configured
            await sock.sendMessage(
              senderJid,
              {
                text: `🤖 *Hello! I am ${config.botName}.*\n\n💬 Send \`${prefix}ai <prompt>\` or configure your Gemini API Key in the panel to enable full direct private AI conversation!\n\nType \`${prefix}menu\` for all available commands.`,
              },
              { quoted: msg }
            );
            continue;
          }
        }

        // 9.11 (audit M1, décision owner) : l'agent répond AUSSI en groupe,
        // mais uniquement si le message S'ADRESSE au bot (mention @ ou reply
        // à un message du bot) — jamais sur la conversation générale.
        if (isGroup && !isFromMe && !text.startsWith(prefix)) {
          // 9.12 (B5, décision owner) : « 1 »/« 2 »/« video »/« playlist » nu
          // d'un utilisateur ayant un choix .ytv en attente → consommé SANS
          // tour IA (l'écran a été déclenché PAR cet utilisateur — sans ça,
          // la consigne « Réponds avec 1 ou 2 » serait mensongère en groupe).
          const bareYtv = bareYtvChoiceAnswer(text);
          if (
            bareYtv &&
            hasPendingYtvChoice(senderJid, actualSenderJid) &&
            !peekPendingConfirmation(actualSenderJid)
          ) {
            await dispatchBotCommand(sock, msg, dispatchInfo, "ytvideo", [bareYtv], "agent");
            continue;
          }
          if (isAIConfigured() && messageAddressesBot(msg, sock?.user?.id)) {
            const handledByAgent = await handleAgentMessage(
              sock,
              msg,
              {
                senderJid,
                actorJid: actualSenderJid,
                actorNumber: actualSenderNumber,
                senderName,
                isOwner,
                text,
                botName: config.botName,
                prefix,
                mediaHint,
                quotedTextExcerpt,
              },
              (commandName, args) =>
                dispatchBotCommand(sock, msg, dispatchInfo, commandName, args, "agent")
            );
            if (handledByAgent) continue;
          }
          continue;
        }

        if (!text.startsWith(prefix)) continue;


        const body = text.slice(prefix.length).trim();
        const args = body.split(/\s+/);
        const commandName = args.shift()?.toLowerCase() || "";
        // 8.93 : le dispatch (contexte, RoleGuard, stats, exécution) vit dans
        // commandDispatch.ts — source unique partagée avec l'agent IA.
        await dispatchBotCommand(sock, msg, dispatchInfo, commandName, args, "prefix");
      }
    });

  } catch (error: any) {
    botState.status = "error";
    addLog(`❌ Failed to start bot connection: ${error.message || error}`);
  }
}

export function stopLiveBot() {
  if (botState.reconnectTimeout) {
    clearTimeout(botState.reconnectTimeout);
    botState.reconnectTimeout = null;
  }
  if (botState.socket) {
    try {
      (botState.socket as any).isClosedByEngine = true;
      botState.socket.end(new Error("Engine stopped manually"));
      if ((botState.socket as any).ws?.terminate) {
        (botState.socket as any).ws.terminate();
      } else if ((botState.socket as any).ws?.close) {
        (botState.socket as any).ws.close();
      }
    } catch (e) {}
    botState.socket = null;
    setLiveSocket(null);
  }
  botState.status = "disconnected";
  botState.qrCode = "";
  botState.pairingCode = "";
  botState.pairingNumber = "";
  botState.pairingExpiresAt = null;
  addLog("🔌 Baileys Live Connection stopped manually.");
}

/**
 * Requests an 8-character WhatsApp pairing code for the given phone number
 * (similar to Knight Bot pairing code service).
 */
export async function requestPairingCode(phoneNumber: string): Promise<{ success: boolean; code?: string; error?: string; expiresAt?: number | null }> {
  const cleanPhone = phoneNumber.replace(/[^0-9]/g, "");
  if (!cleanPhone || cleanPhone.length < 8 || cleanPhone.length > 16) {
    return {
      success: false,
      error: "Invalid phone number. Please provide your full international WhatsApp number including country code (e.g. 1234567890 or 628123456789).",
    };
  }

  if (botState.status === "connected") {
    return {
      success: false,
      error: "Bot is already connected to WhatsApp. Disconnect first to link a new number.",
    };
  }

  addLog(`📱 User requested 8-digit Pairing Code for +${cleanPhone}`);

  // Safely stop any running connection and clean session directory
  stopLiveBot();

  await new Promise((resolve) => setTimeout(resolve, 800));

  const authDir = process.env.NEBULA_AUTH_DIR || "nebula_auth_info";
  try {
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
      addLog("🗑️ Cleared existing auth cache for fresh Pairing Code handshake.");
    }
  } catch (err: any) {
    console.error("Failed to clear auth dir for pairing code:", err);
  }
  // Immediately recreate directory so subsequent operations never encounter ENOENT
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  botState.connectionMode = "pair_code";
  botState.pairingNumber = cleanPhone;
  botState.pairingCode = "";
  botState.pairingExpiresAt = null;

  // Start live bot with pairing phone specified
  await startLiveBot(true, cleanPhone);

  // Poll for up to 25 seconds waiting for the pairing code
  const startTime = Date.now();
  while (Date.now() - startTime < 25000) {
    if (botState.pairingCode) {
      return {
        success: true,
        code: botState.pairingCode,
        expiresAt: botState.pairingExpiresAt,
      };
    }
    if (botState.status === "error" && Date.now() - startTime > 12000) {
      return {
        success: false,
        error: "Failed to establish connection to request pairing code. Please retry.",
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  if (botState.pairingCode) {
    return {
      success: true,
      code: botState.pairingCode,
      expiresAt: botState.pairingExpiresAt,
    };
  }

  return {
    success: false,
    error: "Timed out waiting for WhatsApp servers to issue pairing code. Please try again.",
  };
}

/**
 * Clears the session authentication cache directory ('nebula_auth_info')
 * and resets all bot connection state parameters.
 */
export async function clearSessionAuth(): Promise<{
  success: boolean;
  filesRemoved: number;
  authDir: string;
  error?: string;
  message: string;
}> {
  const authDir = process.env.NEBULA_AUTH_DIR || "nebula_auth_info";
  addLog(`🔌 Stopping active Baileys socket to release locks on '${authDir}'...`);
  stopLiveBot();

  // Allow a moment for file descriptors to release
  await new Promise((resolve) => setTimeout(resolve, 800));

  let fileCount = 0;
  try {
    if (fs.existsSync(authDir)) {
      try {
        const files = fs.readdirSync(authDir);
        fileCount = files.length;
      } catch {
        fileCount = 1;
      }

      addLog(`🧹 Purging ${fileCount} stored session file(s) from '${authDir}'...`);

      // Attempt removal with retry for resilient deletion
      let removed = false;
      let lastErr: any = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          fs.rmSync(authDir, { recursive: true, force: true });
          removed = true;
          break;
        } catch (err: any) {
          lastErr = err;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      if (!removed && fs.existsSync(authDir)) {
        throw lastErr || new Error("Failed to remove auth directory after multiple attempts.");
      }

      // Recreate empty auth directory immediately so creds saving never fails
      fs.mkdirSync(authDir, { recursive: true });

      addLog(`✨ Session directory '${authDir}' successfully purged (${fileCount} key files removed). Clean authentication state established.`);
    } else {
      fs.mkdirSync(authDir, { recursive: true });
      addLog(`ℹ️ Session directory '${authDir}' prepared.`);
    }

    botState.reconnectCount = 0;
    botState.status = "disconnected";
    botState.qrCode = "";
    botState.pairingCode = "";
    botState.pairingNumber = "";
    botState.pairingExpiresAt = null;
    botState.connectionMode = "qr";

    return {
      success: true,
      filesRemoved: fileCount,
      authDir,
      message: `Authentication cache cleared successfully (${fileCount} files removed).`,
    };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    addLog(`❌ Failed to clear session directory '${authDir}': ${errorMsg}`);
    console.error("Failed to clear auth dir:", err);
    return {
      success: false,
      filesRemoved: 0,
      authDir,
      error: errorMsg,
      message: `Failed to clear authentication cache: ${errorMsg}`,
    };
  }
}

/**
 * Retries the live connection by clearing session auth cache files
 * and restarting the connection to generate a fresh session / QR code.
 */
export async function retryLiveConnection(): Promise<{
  success: boolean;
  filesRemoved: number;
  authDir: string;
  error?: string;
  message: string;
}> {
  addLog("🔄 Reset Session requested: purging authentication cache before fresh handshake...");
  const clearResult = await clearSessionAuth();

  if (!clearResult.success) {
    addLog(`⚠️ Aborted fresh handshake due to session purge failure: ${clearResult.error}`);
    return clearResult;
  }

  addLog("🚀 Initiating fresh Baileys handshake with clean multi-device authentication credentials...");
  
  // Start fresh live connection
  try {
    await startLiveBot(true);
    return {
      ...clearResult,
      message: "Session authentication cache purged and fresh Baileys handshake initiated.",
    };
  } catch (err: any) {
    const startError = err?.message || String(err);
    addLog(`❌ Failed to initiate fresh handshake: ${startError}`);
    return {
      ...clearResult,
      success: false,
      error: startError,
      message: `Auth cleared, but failed to start handshake: ${startError}`,
    };
  }
}

