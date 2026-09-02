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
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import pino from "pino";
import { Boom } from "@hapi/boom";
import fs from "fs";
import { getConfig } from "./config.js";
import { getCommand, initRegistry } from "./commandRegistry.js";
import { BotCommandContext, GroupMember } from "./types.js";
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
import { inspectMessageSafety } from "./utils/antibot.js";
import { extractQuotedMediaContent } from "./utils/quotedMedia.js";
import { checkAIQuota, consumeAIQuota, withAIConcurrency } from "./aiQuota.js";
import { authorizeCommand, resolveRole } from "./accessControl.js";
import { getGroupPolicy } from "./groupAccessStore.js";
import { recordAudit } from "./auditTrail.js";
import { setWatchSender, startWatchScheduler } from "./services/episodeWatchService.js";


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

async function getCachedGroupMetadata(sock: any, groupId: string) {
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

export function clearLogs() {
  botState.logs = ["🤖 Logs cleared."];
}

/** Decodes a data: URI into a Buffer (used for AI-generated images). */
function bufferFromDataUri(dataUri: string): Buffer | null {
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

  // Mock sock + msg so commands that send directly (roast, hidetag, download) work too.
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
    await initRegistry();

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
      keepAliveIntervalMs: 10_000,
      generateHighQualityLinkPreview: false,
      retryRequestDelayMs: 250,
    });

    botState.socket = sock;

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
          const ownerJid = `${ownerDigits}@s.whatsapp.net`;
          sock.sendMessage(ownerJid, { text: `🌌 *${config.botName}* is online and connected!\nPrefix: \`${config.prefix}\`` }).catch(() => {});
        }

        // Episode watcher (`.a watch`, audit S4): refresh the sender with the
        // live socket on every (re)connection, then start the scheduler once.
        setWatchSender(async (chatJid, text) => {
          await sock.sendMessage(chatJid, { text });
        });
        startWatchScheduler();
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
            if (botState.reconnectCount >= 5) {
              addLog("🚫 Reconnection failure limit reached. Bot stopped.");
              return;
            }
            botState.reconnectCount++;
            addLog(`🔄 Attempting reconnect (${botState.reconnectCount}/5) in 5 seconds...`);
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
    sock.ev.on("messages.upsert", async (m: any) => {
      if (m.type !== "notify") return;

      for (const msg of m.messages) {
        if (!msg.message) continue;

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
        const cleanedOwner = configuredOwner.replace(/[^0-9]/g, "");
        const isOwner = cleanedOwner ? (actualSenderNumber === cleanedOwner) : false;

        // Add visual live logs to the dashboard so the user knows messages are being processed
        if (text.trim()) {
          addLog(`📨 Message Received: "${maskLogText(text)}" from ${senderName} (${maskLogNumber(senderNumber)}) [fromMe: ${isFromMe}]`);
        }

        // Active Group Moderation Engine
        const isGroup = senderJid.endsWith("@g.us");
        let isSenderAdmin = false;
        let isBotAdmin = false;

        if (isGroup && !isFromMe) {
          const settings = database.getGroupSettings(senderJid);

          try {
            const groupMetadata = await getCachedGroupMetadata(sock, senderJid);
            if (groupMetadata) {
              const botJid = sock.user?.id ? (sock.user.id.split(":")[0] + "@s.whatsapp.net") : "";
              const senderParticipant = groupMetadata.participants.find((p: any) => p.id.split("@")[0] === actualSenderNumber);
              const botParticipant = groupMetadata.participants.find((p: any) => p.id.split("@")[0] === botJid.split("@")[0]);

              isSenderAdmin = senderParticipant?.admin === "admin" || senderParticipant?.admin === "superadmin";
              isBotAdmin = botParticipant?.admin === "admin" || botParticipant?.admin === "superadmin";
            }
          } catch (e) {}

          // 1. Antilink & Antibot Filtering using antibot utility
          if ((settings.antilink || settings.antibot) && !isSenderAdmin && !isOwner) {
            const safety = inspectMessageSafety(senderJid, text, msg, actualSenderJid);
            if (safety.isViolation) {
              addLog(`🛡️ [Security Violation] ${safety.description} from @${maskLogNumber(actualSenderNumber)} in group ${maskLogNumber(senderJid)}`);

              if (isBotAdmin) {
                await sock.sendMessage(senderJid, { delete: msg.key });

                if (safety.action === "kick") {
                  await sock.groupParticipantsUpdate(senderJid, [actualSenderJid], "remove");
                  await sock.sendMessage(senderJid, {
                    text: `🚫 *Security Enforcement:* @${actualSenderNumber} has been kicked.\n*Reason:* ${safety.description}`,
                    mentions: [actualSenderJid]
                  });
                } else if (safety.action === "warn") {
                  await sock.sendMessage(senderJid, {
                    text: `⚠️ *Security Warning:* @${actualSenderNumber}, ${safety.description}`,
                    mentions: [actualSenderJid]
                  });
                } else {
                  await sock.sendMessage(senderJid, {
                    text: `⚠️ *Notice:* Prohibited message from @${actualSenderNumber} has been removed.`,
                    mentions: [actualSenderJid]
                  });
                }
              }
              continue; // Prevent command execution / normal message processing
            }
          }

          // 2. Antitag (Mass Mentions) Filtering
          if (settings.antitag && !isSenderAdmin && !isOwner) {
            const ctxInfo = msg.message?.extendedTextMessage?.contextInfo || messageContent?.extendedTextMessage?.contextInfo;
            const mentionedJids = ctxInfo?.mentionedJid || [];
            if (mentionedJids.length >= 4) {
              addLog(`🛡️ [Antitag] Mass mention (${mentionedJids.length} tags) detected from @${actualSenderNumber}`);

              if (isBotAdmin) {
                await sock.sendMessage(senderJid, { delete: msg.key });

                if (settings.antitagAction === "kick") {
                  await sock.groupParticipantsUpdate(senderJid, [actualSenderJid], "remove");
                  await sock.sendMessage(senderJid, {
                    text: `🚫 *Antitag enforcement:* @${actualSenderNumber} has been kicked for mass mentioning group members.`,
                    mentions: [actualSenderJid]
                  });
                } else {
                  await sock.sendMessage(senderJid, {
                    text: `⚠️ *Antitag warning:* Mass mentions are disabled in this group, @${actualSenderNumber}.`,
                    mentions: [actualSenderJid]
                  });
                }
              }
              continue; // Prevent command execution / normal message processing
            }
          }
        }

        // Allow owner to run commands on their own session, but ignore regular self messages that don't start with prefix
        if (isFromMe && !text.startsWith(prefix)) {
          continue;
        }

        // Direct AI response in private chat when not starting with prefix
        if (!isGroup && !isFromMe && !text.startsWith(prefix)) {
          if (isAIConfigured()) {
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
              const answer = await withAIConcurrency(() =>
                generateTextWithFallback(
                  text,
                  getPersonaPrompt("dm", config.botName) + (memoryBlock ? `\n\n${memoryBlock}` : ""),
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

        if (!text.startsWith(prefix)) continue;


        const body = text.slice(prefix.length).trim();
        const args = body.split(/\s+/);
        const commandName = args.shift()?.toLowerCase() || "";

        const command = getCommand(commandName);
        if (!command) {
          addLog(`⚠️ Unknown or dynamically excluded command: "${commandName}"`);
          continue;
        }

        // Build dynamic reply and react handlers
        const replyHandler = async (textStr: string, mediaUrl?: string) => {
          try {
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
          isOwner,
          isAdmin: isSenderAdmin,
          prefix,
          commandName,
          args,
          fullMessage: text,
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

        addLog(`💬 Executing dynamic command: [${commandName}] for ${senderName} (${maskLogNumber(senderNumber)})`);

        // RoleGuard (M1): declarative ACL gate — fail closed on any error so a
        // policy/registry problem can never escalate to "everyone allowed".
        try {
          const accessPolicy = getGroupPolicy(senderJid);
          const aclDecision = authorizeCommand(
            { name: commandName, category: command.category || "misc" },
            resolveRole({ isOwner, isAdmin: isSenderAdmin, isGroup }),
            accessPolicy,
            {
              ownerOnly: (command as any).ownerOnly,
              adminOnly: (command as any).adminOnly,
              groupOnly: (command as any).groupOnly,
              privateOnly: (command as any).privateOnly,
            }
          );
          if (!aclDecision.allowed) {
            addLog(`⛔ RoleGuard denied [${commandName}] for ${senderName} (${maskLogNumber(senderNumber)}): ${aclDecision.reason}`);
            recordAudit(`wa:${maskLogNumber(senderNumber)}`, "roleguard.deny", commandName, aclDecision.reason);
            await replyHandler(`⛔ *Access Denied:* ${aclDecision.reason}.`);
            return;
          }
        } catch (aclErr: any) {
          addLog(`⛔ RoleGuard error on [${commandName}] for ${senderName}: ${aclErr.message || aclErr} (fail-closed)`);
          await replyHandler(`⛔ *Access Denied:* unable to verify permission for this command.`);
          return;
        }

        try {
          incrementCommandStats(commandName);
          await command.execute(sock, msg, context);
        } catch (err: any) {
          addLog(`❌ Error in ${commandName}: ${err.message || err}`);
          await replyHandler(`❌ *Nebula Error:* Failed to execute command \`${commandName}\`.\nReason: ${err.message || err}`);
        }
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

