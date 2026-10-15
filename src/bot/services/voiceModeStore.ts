import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * 9.18ii (P6b, décisions owner 15/10) — mode vocal de l'agent par chat.
 *
 * `.on` / `.off` dans un chat → les réponses CONVERSATIONNELLES de l'agent
 * (réponses, questions, guidage, rattrapage) arrivent en note vocale au lieu
 * du texte. Les livraisons (liens), écrans de sélection et messages système
 * restent en texte (règles UX : jamais d'URL à voix, les listes sont
 * illisibles à l'oreille).
 *
 * Réglage PAR CHAT (comme les préférencés qualité et l'historique anime) —
 * un groupe peut activer sans toucher les MP. JSON atomique, AUCUN contenu
 * stocké (un booléen par chat + timestamp). Zéro nouvel env.
 */

type VoiceModeStore = Record<string, { on: boolean; ts: number }>;

const MAX_STORED_CHATS = 500;

function dataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}

function storePath(): string {
  return path.join(dataDir(), "voice_mode.json");
}

function loadStore(): VoiceModeStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as VoiceModeStore;
  } catch {
    return {};
  }
}

function saveStore(store: VoiceModeStore): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const tmp = storePath() + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(store), "utf-8");
    fs.renameSync(tmp, storePath());
  } catch {
    // Fail-closed : le réglage vaut pour ce process, rien de fatal.
  }
}

/** Mode vocal activé pour ce chat ? */
export function isVoiceModeEnabled(chatJid: string): boolean {
  if (!chatJid) return false;
  try {
    const e = loadStore()[chatJid];
    return !!(e && typeof e === "object" && (e as { on?: unknown }).on === true);
  } catch {
    return false;
  }
}

/** Active/désactive le mode vocal du chat. Retourne le nouvel état. */
export function setVoiceMode(chatJid: string, enabled: boolean, now = Date.now()): boolean {
  if (!chatJid) return false;
  const store = loadStore();
  if (enabled) {
    store[chatJid] = { on: true, ts: now };
  } else {
    delete store[chatJid];
  }
  const keys = Object.keys(store);
  if (keys.length > MAX_STORED_CHATS) {
    keys
      .sort((a, b) => (store[a].ts || 0) - (store[b].ts || 0))
      .slice(0, keys.length - MAX_STORED_CHATS)
      .forEach((k) => delete store[k]);
  }
  saveStore(store);
  return enabled;
}
