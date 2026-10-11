import fs from "fs";
import path from "path";

/**
 * 9.16 — Répertoire des utilisateurs et groupes connus du bot.
 *
 * Contrainte honnête : Baileys ne peut PAS énumérer les contacts du
 * propriétaire — le répertoire se construit à l'usage, un utilisateur
 * apparaît dès son PREMIER message au bot (ou sa première participation
 * active dans un groupe où le bot se trouve). Les groupes sont connus
 * dès le premier message qui y arrive.
 *
 * Données par utilisateur : nom le plus frais connu (pushName), premier
 * contact, dernière activité, compteurs messages/commandes, statut banni.
 * Un banni est ignoré par TOUT le moteur (commandes, agent, notes
 * vocales) — le propriétaire ne peut jamais être banni.
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
}

export interface KnownGroup {
  jid: string;
  name: string; // subject du groupe le plus frais vu
  firstSeen: number;
  lastSeen: number;
  messageCount: number;
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

/** Clé de stockage : jid aplati (jamais de chemin/séparateur injectable). */
function safeKey(jid: string): string {
  return String(jid || "").replace(/[^0-9a-zA-Z@.:_-]/g, "").slice(0, 80);
}

/** Enregistre un message d'un utilisateur (création à la volée). */
export function touchUser(jid: string, opts: { name?: string; now?: number } = {}): void {
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
    };
  } else {
    existing.lastSeen = now;
    existing.messageCount += 1;
    // Le pushName change quand un contact met à jour son nom — on garde le plus frais non vide.
    if (opts.name && opts.name !== existing.name) existing.name = String(opts.name).slice(0, 60);
  }
  scheduleSave();
}

/** Enregistre un message dans un groupe (subject rafraîchi à la volée). */
export function touchGroup(jid: string, opts: { name?: string; now?: number } = {}): void {
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
    };
  } else {
    existing.lastSeen = now;
    existing.messageCount += 1;
    if (opts.name) existing.name = String(opts.name).slice(0, 80);
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

export function isBannedUser(jid: string): boolean {
  const existing = store.users[safeKey(jid)];
  return !!existing?.banned;
}

/** Bannir/réhabiliter. Refuse toujours le propriétaire (garde côté route). */
export function setUserBanned(jid: string, banned: boolean): boolean {
  const key = safeKey(jid);
  const existing = store.users[key];
  if (!existing) return false;
  existing.banned = banned;
  scheduleSave();
  return true;
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
