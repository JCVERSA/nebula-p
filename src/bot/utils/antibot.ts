import { database, GroupSettings } from "../database.js";

/**
 * Antibot & Link Detection Utility for Nebula Bot
 * Provides intelligent pattern matching to detect URLs, WhatsApp invite links,
 * and unauthorized bot signatures inside group messages.
 */

// Regular expressions for detecting web URLs, invite links, and shortened links
export const WHATSAPP_INVITE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:chat\.whatsapp\.com\/(?:invite\/)?[0-9A-Za-z]{20,24}|wa\.me\/[0-9A-Za-z]+)/i;
export const GENERAL_URL_REGEX = /(?:https?:\/\/|ftp:\/\/|www\.)[^\s/$.?#].[^\s]*/i;
export const DOMAIN_MATCH_REGEX = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|edu|gov|mil|io|co|ai|xyz|app|dev|me|info|biz|top|online|site|club|vip|live|cc|to|tv|link|shop|icu|ru|cn|in|de|uk|br|fr|it|es|nl|ca|au)\b/i;
export const IP_ADDRESS_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/;

export interface LinkDetectionResult {
  hasLink: boolean;
  links: string[];
  isWhatsAppInvite: boolean;
  isExternalLink: boolean;
}

/**
 * Scans text content for URLs, WhatsApp invite links, and domain links.
 */
export function detectLinks(text: string): LinkDetectionResult {
  if (!text || typeof text !== "string") {
    return {
      hasLink: false,
      links: [],
      isWhatsAppInvite: false,
      isExternalLink: false,
    };
  }

  const links: string[] = [];
  const hasWhatsAppInvite = WHATSAPP_INVITE_REGEX.test(text);
  const hasGeneralUrl = GENERAL_URL_REGEX.test(text);
  const hasDomain = DOMAIN_MATCH_REGEX.test(text);
  const hasIp = IP_ADDRESS_REGEX.test(text);

  if (hasWhatsAppInvite) {
    const match = text.match(WHATSAPP_INVITE_REGEX);
    if (match) links.push(match[0]);
  }

  if (hasGeneralUrl || hasDomain || hasIp) {
    const words = text.split(/\s+/);
    for (const word of words) {
      if (
        GENERAL_URL_REGEX.test(word) ||
        DOMAIN_MATCH_REGEX.test(word) ||
        IP_ADDRESS_REGEX.test(word)
      ) {
        if (!links.includes(word)) {
          links.push(word);
        }
      }
    }
  }

  const hasLink = links.length > 0 || hasWhatsAppInvite || hasGeneralUrl || hasDomain || hasIp;

  return {
    hasLink,
    links,
    isWhatsAppInvite: hasWhatsAppInvite,
    isExternalLink: hasLink && !hasWhatsAppInvite,
  };
}

/**
 * Checks whether a message appears to originate from an automated bot
 * (e.g. secondary Baileys/MD bots, automation scrapers, or bot command spam).
 */
export function isPotentialBot(msg: any, senderJid: string, text: string): boolean {
  if (!msg || !senderJid) return false;

  // NOTE: message-ID heuristics were removed — WhatsApp message IDs are
  // 32-char hex strings that routinely begin with 3EB0/BAE5, so matching on
  // them flagged and deleted ordinary human messages whenever antibot was
  // enabled. Detection now relies on message-shape and command-prefix signals.
  // Check if message has multiple bot button responses or automation flags
  if (
    msg.message?.templateButtonReplyMessage ||
    msg.message?.buttonsResponseMessage ||
    msg.message?.interactiveResponseMessage
  ) {
    // Buttons sent by other bots
    return true;
  }

  // Check for common external bot prefixes with command-like execution
  const botPrefixPattern = /^[!#$%&/\\?*+~^><](?:help|menu|ping|alive|runtime|owner|kick|tagall|hidetag|play|ytmp3|ytmp4|sticker|s)\b/i;
  if (botPrefixPattern.test(text.trim())) {
    return true;
  }

  return false;
}

/**
 * Inspects a group message and determines if it violates antibot or link policies.
 */
export function inspectMessageSafety(
  groupId: string,
  text: string,
  msg: any,
  senderJid: string
): {
  isViolation: boolean;
  reason?: "whatsapp_invite" | "external_link" | "unauthorized_bot";
  action: "delete" | "kick" | "warn";
  description: string;
} {
  const settings = database.getGroupSettings(groupId);

  // 1. Check Antibot setting
  if (settings.antibot) {
    const isBot = isPotentialBot(msg, senderJid, text);
    if (isBot) {
      return {
        isViolation: true,
        reason: "unauthorized_bot",
        action: settings.antibotAction || "delete",
        description: "Automated bot activity detected in group.",
      };
    }

    // Antibot also enforces strict link filtering
    const linkCheck = detectLinks(text);
    if (linkCheck.hasLink) {
      return {
        isViolation: true,
        reason: linkCheck.isWhatsAppInvite ? "whatsapp_invite" : "external_link",
        action: settings.antibotAction || "delete",
        description: linkCheck.isWhatsAppInvite
          ? "Unauthorized WhatsApp group invite link."
          : "Unauthorized external link / URL posted.",
      };
    }
  }

  // 2. Check standalone Antilink setting
  if (settings.antilink) {
    const linkCheck = detectLinks(text);
    if (linkCheck.isWhatsAppInvite || linkCheck.hasLink) {
      return {
        isViolation: true,
        reason: linkCheck.isWhatsAppInvite ? "whatsapp_invite" : "external_link",
        action: settings.antilinkAction || "delete",
        description: "Group invite link / URL prohibited.",
      };
    }
  }

  return {
    isViolation: false,
    action: "delete",
    description: "Message is safe.",
  };
}

/**
 * Retrieves per-group antibot status from database.
 */
export function getGroupAntibotStatus(groupId: string): { enabled: boolean; action: "delete" | "kick" | "warn" } {
  const settings = database.getGroupSettings(groupId);
  return {
    enabled: !!settings.antibot,
    action: settings.antibotAction || "delete",
  };
}

/**
 * Updates per-group antibot settings.
 */
export function setGroupAntibot(
  groupId: string,
  enabled: boolean,
  action: "delete" | "kick" | "warn" = "delete"
): GroupSettings {
  return database.updateGroupSettings(groupId, {
    antibot: enabled,
    antibotAction: action,
  });
}
