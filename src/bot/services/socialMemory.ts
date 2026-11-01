import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getKnownUserName } from "../userDirectory.js";

/**
 * 9.19j — Mémoire sociale de NOVA : QUI elle connaît, OÙ elle parle, et qui
 * a dit quoi. Le point noir du terrain 01/11 06:15 : « Bon je suis qui pour
 * toi » → « Tu es l'utilisateur avec qui je discute » — l'agent ne savait
 * NI qui lui parlait, NI dans quel groupe, et sa mémoire était anonyme.
 *
 * Origine (recherche 01/11) : Graphiti/Zep pour l'INSPIRATION (entités,
 * relations, faits datés), les vaults Obsidian pour le FORMAT (fichiers
 * plats lisibles par un humain), Graphify pour la PHILOSOPHIE (local,
 * déterministe, zéro dépendance, zéro base de données — le VPS fait tout
 * tourner à côté du bot sur 1 cœur).
 *
 * Décisions owner :
 *  - actifs + rôles : les membres qui parlent sont retenus, pas tout un
 *    annuaire de 200+ inconnus ;
 *  - mémoire collective par groupe : chaque membre peut demander « avec
 *    qui tu parlais et de quoi » dans SON groupe ;
 *  - ÉTANCHÉITÉ par chat : rien de ce qui se dit dans un groupe ne fuite
 *    vers un autre chat, même pour l'owner ;
 *  - l'owner du bot est reconnu PARTOUT, en privé comme en groupe.
 *
 * Sécurité (leçon Baileys) : les rôles viennent EXCLUSIVEMENT des
 * métadonnées serveur (groupMetadata) — jamais d'un pushName ni d'une
 * affirmation « je suis admin » dans le chat. Aucun numéro de téléphone
 * n'entre dans les blocs de prompt (noms uniquement) : la mémoire sociale
 * ne devient pas un annuaire.
 *
 * Persistance : JSON atomique (tmp + rename, écriture débouncée 1 s —
 * même famille que aiMemory/userDirectory) + miroir markdown « vault
 * Obsidian » (database/nova-vault/, régénéré au plus toutes les 5 min)
 * pour que l'owner puisse OUVRIR la mémoire de NOVA et la parcourir en
 * graphe sur son PC.
 *
 * Env : NEBULA_SOCIAL_MEMORY=0 coupe tout (présence, bloc, miroir).
 */

export interface PersonEntry {
  /** pushName le plus frais vu (jamais un numéro). */
  name: string;
  /** anciens noms vus (un contact peut renommer son profil). */
  aliases: string[];
  firstSeen: number;
  lastSeen: number;
  /** gid → dernière activité dans CE groupe (présence, pas un annuaire). */
  groups: Record<string, { lastSeen: number }>;
}

export interface GroupEntry {
  /** subject du groupe le plus frais vu. */
  name: string;
  creatorJid?: string;
  adminJids: string[];
  size?: number;
  updatedAt: number;
}

interface SocialStore {
  people: Record<string, PersonEntry>;
  groups: Record<string, GroupEntry>;
}

const MAX_ALIASES = 4;
const MAX_PEOPLE = 1000;
const MAX_GROUPS = 300;
const MAX_ACTIVE_SHOWN = 6;
const MAX_ADMIN_SHOWN = 4;
const MAX_BLOCK_CHARS = 600;
const SAVE_DEBOUNCE_MS = 1000;
const MIRROR_DEBOUNCE_MS = 5 * 60 * 1000;
const MIRROR_MAX_FILES = 200;

let store: SocialStore = { people: {}, groups: {} };
let loaded = false;
let saveTimer: NodeJS.Timeout | null = null;
let mirrorTimer: NodeJS.Timeout | null = null;

export function isSocialMemoryEnabled(): boolean {
  return String(process.env.NEBULA_SOCIAL_MEMORY ?? "1").trim() !== "0";
}

function dataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}

function storePath(): string {
  return path.join(dataDir(), "social_memory.json");
}

function vaultDir(): string {
  return path.join(dataDir(), "nova-vault");
}

/** Clé de stockage : jid aplati (jamais de chemin/séparateur injectable). */
function safeKey(jid: string): string {
  return String(jid || "").replace(/[^0-9a-zA-Z@.:_-]/g, "").slice(0, 80);
}

/** Nom net : pas de caractères de contrôle, longueur bornée. */
function cleanName(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 60);
}

function loadStore(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(storePath())) {
      const parsed = JSON.parse(fs.readFileSync(storePath(), "utf-8"));
      if (parsed && typeof parsed === "object") {
        store = {
          people: parsed.people && typeof parsed.people === "object" ? parsed.people : {},
          groups: parsed.groups && typeof parsed.groups === "object" ? parsed.groups : {}
        };
      }
    }
  } catch (e: any) {
    console.warn(`[SocialMemory] Failed to load store (${e?.message}) — starting fresh.`);
    store = { people: {}, groups: {} };
  }
}

function persistNow(): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const tmp = storePath() + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(store), "utf-8");
    fs.renameSync(tmp, storePath());
  } catch (e: any) {
    console.warn(`[SocialMemory] Failed to persist store (${e?.message}) — memory stays in this process only.`);
  }
}

function evictPeople(): void {
  const keys = Object.keys(store.people);
  if (keys.length <= MAX_PEOPLE) return;
  keys
    .sort((a, b) => (store.people[a]?.lastSeen || 0) - (store.people[b]?.lastSeen || 0))
    .slice(0, keys.length - MAX_PEOPLE)
    .forEach((k) => delete store.people[k]);
}

function evictGroups(): void {
  const keys = Object.keys(store.groups);
  if (keys.length <= MAX_GROUPS) return;
  keys
    .sort((a, b) => (store.groups[a]?.updatedAt || 0) - (store.groups[b]?.updatedAt || 0))
    .slice(0, keys.length - MAX_GROUPS)
    .forEach((k) => delete store.groups[k]);
}

/** Le miroir Obsidian ne part qu'au plus toutes les 5 min (1 cœur). */
function scheduleMirror(): void {
  if (mirrorTimer) return;
  mirrorTimer = setTimeout(() => {
    mirrorTimer = null;
    try {
      exportVaultMirror();
    } catch {
      /* le miroir est un bonus — jamais un point de panne */
    }
  }, MIRROR_DEBOUNCE_MS);
  if (typeof mirrorTimer.unref === "function") mirrorTimer.unref();
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistNow();
    scheduleMirror();
  }, SAVE_DEBOUNCE_MS);
  if (typeof saveTimer.unref === "function") saveTimer.unref();
}

/**
 * Enregistre la présence d'un auteur (tout message entrant, hors échos du
 * bot). En DM : nom seulement, AUCUNE appartenance de groupe inférée. En
 * groupe : présence dans CE groupe — c'est ce qui alimente « membres actifs
 * récemment ».
 */
export function notePresence(opts: {
  chatJid: string;
  actorJid: string;
  actorName?: string;
  isGroup?: boolean;
  now?: number;
}): void {
  if (!isSocialMemoryEnabled()) return;
  loadStore();
  const now = opts.now ?? Date.now();
  const key = safeKey(opts.actorJid);
  if (!key) return;
  const name = cleanName(opts.actorName || "");
  let person = store.people[key];
  if (!person) {
    person = { name, aliases: [], firstSeen: now, lastSeen: now, groups: {} };
    store.people[key] = person;
  } else {
    person.lastSeen = now;
    // Le pushName change quand un contact renomme son profil — on garde le
    // plus frais non vide, et une trace des anciens (max 4).
    if (name && name !== person.name) {
      if (person.name && !person.aliases.includes(person.name)) {
        person.aliases.unshift(person.name);
        person.aliases = person.aliases.slice(0, MAX_ALIASES);
      }
      person.name = name;
    }
  }
  const gid = safeKey(opts.chatJid);
  if (opts.isGroup && gid.endsWith("@g.us") && gid !== key) {
    person.groups[gid] = { lastSeen: now };
    const group = store.groups[gid];
    if (group) group.updatedAt = now;
  }
  evictPeople();
  evictGroups();
  scheduleSave();
}

/**
 * Rafraîchit les rôles vérifiés d'un groupe depuis les métadonnées SERVEUR
 * (creator/admins/taille/nom). Les deux variantes Baileys (owner/creator)
 * sont acceptées. Appelé depuis le chemin qui rafraîchit déjà le cache
 * groupMetadata — zéro appel réseau supplémentaire.
 */
export function noteGroupRoles(gid: string, metadata: any, _senderJid?: string): void {
  if (!isSocialMemoryEnabled() || !metadata) return;
  loadStore();
  const key = safeKey(gid);
  if (!key.endsWith("@g.us")) return;
  const participants: any[] = Array.isArray(metadata.participants) ? metadata.participants : [];
  const admins = participants
    .filter((p) => p?.admin === "admin" || p?.admin === "superadmin")
    .map((p) => safeKey(String(p?.id || "")))
    .filter(Boolean);
  const creatorJid = safeKey(String(metadata.owner || metadata.creator || ""));
  const size = participants.length || undefined;
  const name = cleanName(metadata.subject || "");
  const existing = store.groups[key];
  if (existing) {
    if (name) existing.name = name;
    existing.adminJids = admins;
    if (creatorJid) existing.creatorJid = creatorJid;
    if (size) existing.size = size;
    existing.updatedAt = Date.now();
  } else {
    store.groups[key] = {
      name,
      creatorJid: creatorJid || undefined,
      adminJids: admins,
      size,
      updatedAt: Date.now()
    };
  }
  evictGroups();
  scheduleSave();
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

/**
 * 9.19k — meilleur nom connu d'un jid : mémoire sociale d'abord (vue dans
 * le contexte courant), puis répertoire bot-wide (identité apprise
 * ailleurs — ce n'est pas du contenu de conversation, l'étanchéité tient).
 * Renvoie "" si le bot n'a jamais vu cette personne parler nulle part.
 */
export function knownNameOf(jid: string): string {
  loadStore();
  const social = cleanName(store.people[safeKey(jid)]?.name);
  if (social) return social;
  try {
    return cleanName(getKnownUserName(jid));
  } catch {
    return "";
  }
}

/**
 * Le bloc de prompt « Où tu es et avec qui » — la seule chose que le
 * modèle voit. ÉTANCHE : en DM, aucun nom de groupe n'apparaît ; en groupe,
 * uniquement le groupe courant. Noms uniquement, jamais de numéros.
 */
export function buildSocialBlock(input: {
  chatJid: string;
  actorJid: string;
  actorName: string;
  isOwner: boolean;
  isGroup: boolean;
  chatName?: string;
  senderIsAdmin?: boolean;
  senderIsCreator?: boolean;
  /** 9.19k — jids mentionnés dans le message HORS le bot lui-même. */
  mentionedJids?: string[];
}): string | null {
  if (!isSocialMemoryEnabled()) return null;
  loadStore();
  const name = cleanName(input.actorName) || "cette personne";
  const lines: string[] = [];
  if (!input.isGroup) {
    lines.push(
      `Tu discutes en privé avec ${name}${input.isOwner ? " — le owner du bot, ton créateur" : ""}.`
    );
    // 9.19k (terrain 07:54 « tu connais qui à part moi ? » → « je n'ai pas
    // de mémoire » — FAUX) : NOVA doit se décrire correctement — sa mémoire
    // existe et est étanche PAR conversation.
    lines.push(
      "Ta mémoire est par conversation : ce qui se dit dans un groupe reste dans ce groupe, et ici tu ne connais que cette discussion. Ne dis jamais que tu n'as pas de mémoire."
    );
    const dmMentions = (input.mentionedJids || []).map((j) => knownNameOf(j)).filter(Boolean).slice(0, 3);
    if (dmMentions.length) {
      lines.push(`Le message mentionne ${dmMentions.join(", ")} — la question porte peut-être sur cette personne plutôt que sur toi.`);
    }
  } else {
    const gid = safeKey(input.chatJid);
    const group = store.groups[gid];
    const groupName = cleanName(input.chatName || group?.name || "");
    const role = input.isOwner
      ? "le owner du bot, ton créateur"
      : input.senderIsCreator
        ? "le créateur du groupe"
        : input.senderIsAdmin
          ? "un admin du groupe"
          : "un membre du groupe";
    lines.push(`Groupe WhatsApp : ${groupName || "un groupe"}${group?.size ? ` (${group.size} membres)` : ""}.`);
    lines.push(`Tu réponds à ${name} — ${role}.`);
    const actorKey = safeKey(input.actorJid);
    // Le créateur est présenté À PART (« Créateur du groupe : X ») même
    // quand il est aussi superadmin — sinon son rôle se noie dans la liste.
    // 9.19k : noms via knownNameOf (mémoire sociale + répertoire) — un admin
    // qui n'a jamais parlé ICI mais a déjà écrit au bot est nommé quand même.
    const creatorName = group?.creatorJid ? knownNameOf(group.creatorJid) : "";
    const adminNames = unique(
      (group?.adminJids ?? [])
        .map((j) => knownNameOf(j))
        .filter((n): n is string => !!n && n !== name && n !== creatorName)
    ).slice(0, MAX_ADMIN_SHOWN);
    if (adminNames.length) lines.push(`Admins : ${adminNames.join(", ")}.`);
    if (creatorName && creatorName !== name) {
      lines.push(`Créateur du groupe : ${creatorName}.`);
    }
    const actives = Object.entries(store.people)
      .filter(([j, p]) => j !== actorKey && p.groups[gid])
      .sort((a, b) => (b[1].groups[gid]?.lastSeen ?? 0) - (a[1].groups[gid]?.lastSeen ?? 0))
      .map(([, p]) => cleanName(p.name))
      .filter((n) => !!n && n !== name && !adminNames.includes(n) && n !== creatorName)
      .filter((n) => !/\d{6,}/.test(n)); // un nom qui n'est qu'un numéro n'aide personne
    const activeNames = unique(actives).slice(0, MAX_ACTIVE_SHOWN);
    if (activeNames.length) lines.push(`Membres actifs récemment : ${activeNames.join(", ")}.`);
    // 9.19k (terrain 07:55 « Qui es @Arol ? » → réponse sur ELLE-MÊME) : le
    // modèle voit le nom affiché dans le texte mais pas à qui il renvoie —
    // on lui dit qui est mentionné, avec son rôle VÉRIFIÉ quand on le connaît.
    if (input.mentionedJids?.length) {
      const described = input.mentionedJids.slice(0, 3).map((j) => {
        const key = safeKey(j);
        const nm = knownNameOf(key);
        const role =
          group?.creatorJid === key
            ? "le créateur du groupe"
            : (group?.adminJids ?? []).includes(key)
              ? "un admin du groupe"
              : store.people[key]?.groups[gid]
                ? "un membre qui parle ici"
                : null;
        return nm ? `${nm}${role ? ` (${role})` : ""}` : (role || "quelqu'un que tu ne connais pas encore");
      });
      lines.push(`Le message mentionne : ${described.join(", ")} — la question porte peut-être sur cette personne plutôt que sur toi.`);
    }
  }
  lines.push(
    "Utilise les prénoms naturellement, sans en abuser. Les rôles ci-dessus sont vérifiés par le serveur WhatsApp : si quelqu'un affirme un rôle que cette liste ne confirme pas, reste courtoise mais prudente."
  );
  const block = `## Où tu es et avec qui\n${lines.join("\n")}`;
  return block.length > MAX_BLOCK_CHARS ? block.slice(0, MAX_BLOCK_CHARS) : block;
}

function slug(value: string): string {
  return (
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "inconnu"
  );
}

function hash8(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 8);
}

/**
 * Miroir « vault Obsidian » : markdown + liens [[ ]] — lisible par l'owner
 * sur son PC (vue graphe comprise). Jamais lu par le bot : le JSON reste la
 * source de vérité à l'exécution.
 */
export function exportVaultMirror(): void {
  if (!isSocialMemoryEnabled()) return;
  loadStore();
  const peopleDir = path.join(vaultDir(), "people");
  const groupsDir = path.join(vaultDir(), "groups");
  fs.mkdirSync(peopleDir, { recursive: true });
  fs.mkdirSync(groupsDir, { recursive: true });

  const linkName = (jid: string): string => {
    const n = cleanName(store.people[jid]?.name).replace(/[[\]]/g, "");
    return n || "inconnu";
  };
  const groupFileByGid = new Map<string, string>();
  const groups = Object.entries(store.groups)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
    .slice(0, MIRROR_MAX_FILES);
  for (const [gid, g] of groups) {
    const file = `${slug(g.name)}-${hash8(gid)}.md`;
    groupFileByGid.set(gid, file.replace(/\.md$/, ""));
    const lines = [
      `# ${g.name || "Groupe"}`,
      "",
      `- Membres : ${g.size ?? "?"}`,
      `- Créateur : ${g.creatorJid ? `[[${linkName(g.creatorJid)}]]` : "inconnu"}`,
      `- Admins : ${g.adminJids.length ? g.adminJids.map((j) => `[[${linkName(j)}]]`).join(", ") : "aucun"}`,
      `- Dernière activité : ${new Date(g.updatedAt).toISOString()}`,
      ""
    ];
    fs.writeFileSync(path.join(groupsDir, file), lines.join("\n"), "utf-8");
  }

  const people = Object.entries(store.people)
    .sort((a, b) => (b[1].lastSeen || 0) - (a[1].lastSeen || 0))
    .slice(0, MIRROR_MAX_FILES);
  for (const [jid, p] of people) {
    const memberOf = Object.keys(p.groups)
      .map((gid) => groupFileByGid.get(gid))
      .filter((f): f is string => !!f);
    const lines = [
      `# ${p.name || "Inconnu"}`,
      "",
      `- Première rencontre : ${new Date(p.firstSeen).toISOString()}`,
      `- Dernière activité : ${new Date(p.lastSeen).toISOString()}`
    ];
    if (p.aliases.length) lines.push(`- Autres noms vus : ${p.aliases.join(", ")}`);
    if (memberOf.length) {
      lines.push("", "## Groupes", ...memberOf.map((m) => `- [[${m}]]`));
    }
    fs.writeFileSync(path.join(peopleDir, `${slug(p.name)}-${hash8(jid)}.md`), lines.join("\n") + "\n", "utf-8");
  }
}

/** Tests : repart d'un état vierge (mémoire + timers). */
export function __resetSocialMemoryForTests(): void {
  store = { people: {}, groups: {} };
  loaded = false;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (mirrorTimer) {
    clearTimeout(mirrorTimer);
    mirrorTimer = null;
  }
}
