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
  execute: (sock: any, msg: any, context: BotCommandContext) => Promise<void> | void;
}

