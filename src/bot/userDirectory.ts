import fs from "fs";
import path from "path";

/**
 * 9.16/9.17/9.18 — Répertoire des utilisateurs et groupes connus du bot.
 *
 * Contrainte honnête : Baileys ne peut PAS énumérer les contacts du
 * propriétaire — le répertoire se construit à l'usage, un utilisateur
 * apparaît dès son PREMIER message au bot (ou sa première participation
 * active dans un groupe où le bot se trouve). Les groupes sont connus
 * dès le premier message qui y arrive.
 *
 * Données par utilisateur : nom le plus frais connu (pushName), premier
 * contact, dernière activité, compteurs messages/commandes, statut banni
 * (avec motif et expiration — 9.18), note owner, sourdine IA, refus
 * d'annonces, limite IA personnalisée, numéro résolu derrière un LID.
 *
 * Un banni est ignoré par TOUT le moteur (commandes, agent, notes
 * vocales) — le propriétaire ne peut jamais être banni. Un « muet »
 * garde ses commandes mais perd les tours IA (9.18 L).
 *
 * Persistance : JSON atomique (tmp + rename) dans le data dir, écriture
 * débouncée (1 s) — même famille que aiQuota/panelCommands.
 */

export interface KnownUser {
  jid: string;
  name: string; // pushName le plus frais vu ("" si jamais connu)
  firstSeen: number;
  lastSeen: number;
  messageCount: number;
  commandCount: number;
  lastCommand: string | null;
  banned: boolean;
  /** 9.18 — motif du ban (affiché à l'owner, tracé dans l'audit). */
  banReason?: string;
  /** 9.18 — timestamp d'expiration du ban (absent/0 = permanent). */
  bannedUntil?: number;
  /** 9.18 — note libre de l'owner sur cet utilisateur. */
  note?: string;
  /** 9.18 — sourdine IA : commandes OK, tours IA refusés honnêtement. */
  muted?: boolean;
  /** 9.18 — refuse les annonces (exclu du ciblage, côté serveur). */
  noAnnounce?: boolean;
  /** 9.18 — limite IA quotidienne personnalisée (null = limite globale). */
  aiLimitOverride?: number;
  /** 9.18 — numéro WhatsApp réel derrière un jid @lid, si résolu. */
  resolvedNumber?: string;
}

export interface KnownGroup {
  jid: string;
  name: string; // subject du groupe le plus frais vu
  firstSeen: number;
  lastSeen: number;
  messageCount: number;
  /** 9.18 — taille du groupe au dernier contact (ciblage annonces). */
  memberCount?: number;
}

function getDataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}
function getStoreFile(): string {
  return path.join(getDataDir(), "user_directory.json");
}

interface DirectoryShape {
  users: Record<string, KnownUser>;
  groups: Record<string, KnownGroup>;
}

let store: DirectoryShape = { users: {}, groups: {} };

function loadStore(): void {
  try {
    if (fs.existsSync(getStoreFile())) {
      const raw = JSON.parse(fs.readFileSync(getStoreFile(), "utf-8"));
      if (raw && typeof raw === "object") {
        store = {
          users: raw.users && typeof raw.users === "object" ? raw.users : {},
          groups: raw.groups && typeof raw.groups === "object" ? raw.groups : {},
        };
      }
    }
  } catch (e: any) {
    console.warn("[UserDirectory] Failed to load store:", e?.message || e);
  }
}
loadStore();

let saveTimer: NodeJS.Timeout | null = null;
function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(getDataDir(), { recursive: true });
      const tmp = `${getStoreFile()}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
      fs.renameSync(tmp, getStoreFile());
    } catch (e: any) {
      console.error("[UserDirectory] Failed to persist:", e?.message || e);
    }
  }, 1000);
}

/** Aplatit une saisie owner : pas de caractères de contrôle, longueur bornée. */
function cleanOwnerText(value: unknown, max: number): string {
  // eslint-disable-next-line no-control-regex
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

/** Clé de stockage : jid aplati (jamais de chemin/séparateur injectable). */
function safeKey(jid: string): string {
  return String(jid || "").replace(/[^0-9a-zA-Z@.:_-]/g, "").slice(0, 80);
}

/**
 * 9.17 (audit J-2) — plafond du répertoire : le JSON croissait à vie, un
 * expéditeur par personne ayant jamais écrit au bot. Au-delà du cap, les
 * fiches les moins récemment actives partent — SAUF les bannis (leur fiche
 * est la mémoire du ban), les muets et les refus d'annonces (9.18 : la
 * sanction/préférence doit survivre à l'inactivité).
 */
export const MAX_DIRECTORY_USERS = 5000;

function isProtected(u: KnownUser): boolean {
  return u.banned || !!u.muted || !!u.noAnnounce;
}

function evictIfNeeded(): void {
  const keys = Object.keys(store.users);
  if (keys.length <= MAX_DIRECTORY_USERS) return;
  const evictable = keys
    .filter((k) => !isProtected(store.users[k]))
    .sort((a, b) => store.users[a].lastSeen - store.users[b].lastSeen);
  const toRemove = keys.length - MAX_DIRECTORY_USERS;
  for (let i = 0; i < Math.min(toRemove, evictable.length); i++) {
    delete store.users[evictable[i]];
  }
}

/** Enregistre un message d'un utilisateur (création à la volée). */
export function touchUser(
  jid: string,
  opts: { name?: string; now?: number; resolvedNumber?: string } = {}
): void {
  const key = safeKey(jid);
  if (!key) return;
  const now = opts.now ?? Date.now();
  const existing = store.users[key];
  if (!existing) {
    store.users[key] = {
      jid: key,
      name: (opts.name || "").slice(0, 60),
      firstSeen: now,
      lastSeen: now,
      messageCount: 1,
      commandCount: 0,
      lastCommand: null,
      banned: false,
      // Le numéro résolu d'un LID peut précéder tout le reste
      resolvedNumber: opts.resolvedNumber ? opts.resolvedNumber.slice(0, 20) : undefined,
    };
  } else {
    existing.lastSeen = now;
    existing.messageCount += 1;
    // Le pushName change quand un contact met à jour son nom — on garde le plus frais non vide.
    if (opts.name && opts.name !== existing.name) existing.name = String(opts.name).slice(0, 60);
    // 9.18 — la résolution LID→numéro n'est JAMAIS écrasée par une absence.
    if (opts.resolvedNumber && !existing.resolvedNumber) {
      existing.resolvedNumber = opts.resolvedNumber.slice(0, 20);
    }
  }
  evictIfNeeded();
  scheduleSave();
}

/** Enregistre un message dans un groupe (subject + taille rafraîchis). */
export function touchGroup(
  jid: string,
  opts: { name?: string; now?: number; memberCount?: number } = {}
): void {
  const key = safeKey(jid);
  if (!key.endsWith("@g.us")) return;
  const now = opts.now ?? Date.now();
  const existing = store.groups[key];
  if (!existing) {
    store.groups[key] = {
      jid: key,
      name: (opts.name || "").slice(0, 80),
      firstSeen: now,
      lastSeen: now,
      messageCount: 1,
      memberCount: typeof opts.memberCount === "number" ? opts.memberCount : undefined,
    };
  } else {
    existing.lastSeen = now;
    existing.messageCount += 1;
    if (opts.name) existing.name = String(opts.name).slice(0, 80);
    if (typeof opts.memberCount === "number" && opts.memberCount > 0) existing.memberCount = opts.memberCount;
  }
  scheduleSave();
}

/** Compte une commande exécutée (appelé par commandDispatch après RoleGuard). */
export function recordCommandUse(jid: string, commandName: string): void {
  const key = safeKey(jid);
  const existing = store.users[key];
  if (!existing) return; // touchUser passe toujours avant dans le flux réel
  existing.commandCount += 1;
  existing.lastCommand = String(commandName || "").slice(0, 40);
  scheduleSave();
}

export interface BanState {
  banned: boolean;
  reason?: string;
  until?: number;
}

/** État de ban EFFECTIF (expiration paresseuse : un ban expiré se lève tout seul). */
export function getBanState(jid: string, now = Date.now()): BanState {
  const existing = store.users[safeKey(jid)];
  if (!existing || !existing.banned) return { banned: false };
  if (existing.bannedUntil && now >= existing.bannedUntil) {
    // Auto-libération paresseuse : l'état persisté est corrigé au passage.
    existing.banned = false;
    delete existing.banReason;
    delete existing.bannedUntil;
    scheduleSave();
    return { banned: false };
  }
  return { banned: true, reason: existing.banReason, until: existing.bannedUntil };
}

export function isBannedUser(jid: string, now = Date.now()): boolean {
  return getBanState(jid, now).banned;
}

/** Bannir/réhabiliter. Refuse toujours le propriétaire (garde côté route). */
export function setUserBanned(
  jid: string,
  banned: boolean,
  opts: { reason?: string; hours?: number } = {}
): boolean {
  const key = safeKey(jid);
  const existing = store.users[key];
  if (!existing) return false;
  if (banned) {
    existing.banned = true;
    existing.banReason = cleanOwnerText(opts.reason, 200) || undefined;
    existing.bannedUntil =
      typeof opts.hours === "number" && opts.hours > 0
        ? Date.now() + Math.floor(opts.hours * 3600_000)
        : undefined;
  } else {
    existing.banned = false;
    delete existing.banReason;
    delete existing.bannedUntil;
  }
  scheduleSave();
  return true;
}

/** 9.18 (D) — note libre de l'owner sur cet utilisateur. */
export function setUserNote(jid: string, note: string): boolean {
  const existing = store.users[safeKey(jid)];
  if (!existing) return false;
  const cleaned = cleanOwnerText(note, 300);
  if (cleaned) existing.note = cleaned;
  else delete existing.note;
  scheduleSave();
  return true;
}

/** 9.18 (L) — sourdine IA (les commandes restent). */
export function setUserMuted(jid: string, muted: boolean): boolean {
  const existing = store.users[safeKey(jid)];
  if (!existing) return false;
  existing.muted = muted || undefined;
  if (!muted) delete existing.muted;
  scheduleSave();
  return true;
}

export function isMutedUser(jid: string): boolean {
  return !!store.users[safeKey(jid)]?.muted;
}

/** 9.18 (F) — refus des annonces (exclu du ciblage, côté serveur). */
export function setUserNoAnnounce(jid: string, flag: boolean): boolean {
  const existing = store.users[safeKey(jid)];
  if (!existing) return false;
  if (flag) existing.noAnnounce = true;
  else delete existing.noAnnounce;
  scheduleSave();
  return true;
}

export function isNoAnnounceUser(jid: string): boolean {
  return !!store.users[safeKey(jid)]?.noAnnounce;
}

/** 9.18 (M) — limite IA quotidienne personnalisée (null = limite globale). */
export function setUserAILimit(jid: string, limit: number | null): boolean {
  const existing = store.users[safeKey(jid)];
  if (!existing) return false;
  if (limit === null || !Number.isFinite(limit) || limit <= 0) delete existing.aiLimitOverride;
  else existing.aiLimitOverride = Math.min(500, Math.max(1, Math.floor(limit)));
  scheduleSave();
  return true;
}

export function getUserAILimit(jid: string): number | null {
  const v = store.users[safeKey(jid)]?.aiLimitOverride;
  return typeof v === "number" && v > 0 ? v : null;
}

export function listUsers(): KnownUser[] {
  return Object.values(store.users).sort((a, b) => b.lastSeen - a.lastSeen);
}

export function listGroups(): KnownGroup[] {
  return Object.values(store.groups).sort((a, b) => b.lastSeen - a.lastSeen);
}

/** Tests uniquement : vide le répertoire en mémoire ET sur disque. */
export function __resetDirectoryForTests(): void {
  store = { users: {}, groups: {} };
  try {
    if (fs.existsSync(getStoreFile())) fs.rmSync(getStoreFile(), { force: true });
  } catch {}
}
