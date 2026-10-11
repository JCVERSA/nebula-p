export interface GroupMember {
  id: string;
  number: string;
  admin: "admin" | "superadmin" | null;
}

export interface BotCommandContext {
  sender: string;
  senderName: string;
  isOwner: boolean;
  /** True when the sender is a group admin (always false outside groups). */
  isAdmin: boolean;
  prefix: string;
  commandName: string;
  args: string[];
  fullMessage: string;
  reply: (text: string, mediaUrl?: string) => Promise<any>;
  react: (emoji: string) => Promise<any>;
  downloadMedia?: () => Promise<Buffer | null>;
  getGroupMetadata?: (jid: string) => Promise<any>;
  getGroupMembers?: (jid: string) => Promise<GroupMember[]>;
  updateParticipants?: (jid: string, participants: string[], action: "add" | "remove" | "promote" | "demote") => Promise<any>;
  kickMember?: (jid: string, participantJid: string) => Promise<any>;
  promoteMember?: (jid: string, participantJid: string) => Promise<any>;
  demoteMember?: (jid: string, participantJid: string) => Promise<any>;
}

export interface BotCommand {
  name: string;
  category: string;
  parentCategory?: string;
  description: string;
  usage?: string;
  aliases?: string[];
  /**
   * 9.3b — la commande attend des URLs dans ses arguments (ytv, sweb,
   * fetch, tiktok, instagram…). Le guardrail d'args de l'agent (8.99)
   * supprime les URLs par défaut ; si cette propriété est vraie, les
   * tokens URL sont préservés (cap dédié 500 chars).
   */
  acceptsUrlArgs?: boolean;
  execute: (sock: any, msg: any, context: BotCommandContext) => Promise<void> | void;
}

