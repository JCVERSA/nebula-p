export interface GroupMember {
  id: string;
  number: string;
  admin: "admin" | "superadmin" | null;
}

export interface BotCommandContext {
  sender: string;
  /**
   * 9.12 (audit B5) : JID de l'auteur RÉEL du message (participant en
   * groupe, = sender en DM). Les écrans de choix interactifs (.ytv 1/2,
   * piste audio) sont scopés par (chat, auteur) : en groupe, chacun a son
   * choix en attente — plus d'écrasement ni de consommation croisée.
   */
  senderUser?: string;
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
   * 9.18oooo (quick win) — exemples concrets pour la carte `.help <cmd>`
   * (chaque entrée est tapable telle quelle, préfixe compris).
   */
  examples?: string[];
  /**
   * 9.3b — la commande attend des URLs dans ses arguments (ytv, sweb,
   * fetch, tiktok, instagram…). Le guardrail d'args de l'agent (8.99)
   * supprime les URLs par défaut ; si cette propriété est vraie, les
   * tokens URL sont préservés (cap dédié 500 chars).
   */
  acceptsUrlArgs?: boolean;
  /**
   * 9.18mmmm — capability tags pris en charge par le RoleGuard (accessControl) :
   * ownerOnly (owner Nebula), adminOnly (admins du groupe + owner),
   * groupOnly / privateOnly (type de chat — vérifiés AUSSI au runtime par
   * chaque commande : défense en profondeur, le RoleGuard ne connaît pas le
   * type de chat au moment de l'appel).
   */
  ownerOnly?: boolean;
  adminOnly?: boolean;
  groupOnly?: boolean;
  privateOnly?: boolean;
  execute: (sock: any, msg: any, context: BotCommandContext) => Promise<void> | void;
}

