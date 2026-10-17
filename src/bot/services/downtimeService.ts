import fs from "fs";
import path from "path";

/**
 * ============================================================================
 *  9.18zz — notification de chute, sans FCM (retour terrain 9.18i)
 * ============================================================================
 *  FCM a été retiré en 9.18i (complexité d'infra pour peu de valeur). Le
 *  besoin reste : l'owner veut savoir quand le bot tombe. Résolution : le
 *  canal qui existe déjà — WhatsApp — porte la nouvelle, au RETOUR.
 *
 *  Principe : chaque moteur écrit un marqueur de vie (heartbeat 60 s) dans
 *  SON dossier de données (NEBULA_DATA_DIR, multi-bots 8.75) :
 *  <dataDir>/liveness.json = { at: <epoch ms> }.
 *
 *  À chaque démarrage de socket (runStartLiveBot), on capture le marqueur
 *  AVANT que les heartbeats de CE process ne le rafraîchissent :
 *   - process tombé / VPS rebooté / moteur arrêté puis relancé → marqueur
 *     périmé ; à la reconnexion WhatsApp, l'owner reçoit
 *     « 🔄 Nebula est de retour — coupure de ~1 h 23 » ;
 *   - process vivant (reconnexion 515, resync…) → marqueur frais → silence
 *     (pas de faux positif), le message « online » habituel part ;
 *   - chute courte auto-guérie (< seuil) → silence : rien à signaler.
 *
 *  Réglages : NEBULA_DOWNTIME_NOTIFY=0 coupe tout ;
 *  NEBULA_DOWNTIME_NOTIFY_MIN = seuil en minutes (défaut 10) — un
 *  redéploiement (~2 min) ne notifie pas, une vraie chute oui.
 *
 *  formatDowntimeDuration / assessDowntime / formatReturnMessage sont PURS
 *  (testés à plat) ; read/writeLivenessMarker font l'IO et ne jettent JAMAIS.
 */

const LIVENESS_FILE = "liveness.json";
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

function dataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}

export interface LivenessMarker {
  at: number;
}

export interface DowntimeVerdict {
  notify: boolean;
  /** Durée d'absence constatée (now - dernier heartbeat), en ms. */
  downtimeMs: number;
  /** Dernier heartbeat avant la coupure (null : premier démarrage). */
  lastAliveAt: number | null;
}

function thresholdMs(): number {
  if (String(process.env.NEBULA_DOWNTIME_NOTIFY || "").trim() === "0") return Infinity;
  const raw = Number(process.env.NEBULA_DOWNTIME_NOTIFY_MIN);
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : 10;
  return minutes * 60 * 1000;
}

/** Pur : la coupure constatée mérite-t-elle une notification ? */
export function assessDowntime(lastAliveAt: number | null, now: number): DowntimeVerdict {
  if (lastAliveAt === null || !Number.isFinite(lastAliveAt) || lastAliveAt <= 0) {
    return { notify: false, downtimeMs: 0, lastAliveAt: null };
  }
  const downtimeMs = Math.max(0, now - lastAliveAt);
  return { notify: downtimeMs >= thresholdMs(), downtimeMs, lastAliveAt };
}

/** Pur : durée lisible — « ~45 min », « ~1 h 23 min », « ~2 j 4 h ». */
export function formatDowntimeDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  if (totalMin < 1) return "moins d'une minute";
  if (totalMin < 60) return `~${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (h < 24) return min > 0 ? `~${h} h ${min} min` : `~${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `~${d} j ${rh} h` : `~${d} j`;
}

/** Pur : message WhatsApp de retour après chute. */
export function formatReturnMessage(botName: string, verdict: DowntimeVerdict, now = new Date()): string {
  const lines = [`🔄 *${botName}* est de retour en ligne`];
  lines.push(`⏱️ Coupure : ${formatDowntimeDuration(verdict.downtimeMs)}`);
  if (verdict.lastAliveAt !== null) {
    try {
      lines.push(`📉 Dernière trace vivante : ${new Date(verdict.lastAliveAt).toLocaleString("fr-FR")}`);
    } catch {}
  }
  lines.push(``, `_Si tu n'as rien demandé, vérifie le panneau._`);
  return lines.join("\n");
}

// --------------------------------------------------------------------------- IO

export function readLivenessMarker(dir?: string): LivenessMarker | null {
  try {
    const raw = fs.readFileSync(path.join(dir || dataDir(), LIVENESS_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.at === "number" && Number.isFinite(parsed.at) && parsed.at > 0) {
      return { at: parsed.at };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeLivenessMarker(now = Date.now(), dir?: string): void {
  try {
    const target = dir || dataDir();
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, LIVENESS_FILE), JSON.stringify({ at: now }));
  } catch {}
}

// --------------------------------------------------------------------------- heartbeat

let heartbeatHandle: NodeJS.Timeout | null = null;

/**
 * Heartbeat 60 s, idempotent, unref'd (ne retient jamais le process ouvert
 * — ni en prod, ni dans les tests qui importent le moteur).
 */
export function startLivenessHeartbeat(): void {
  if (heartbeatHandle) return;
  writeLivenessMarker();
  heartbeatHandle = setInterval(() => writeLivenessMarker(), HEARTBEAT_INTERVAL_MS);
  heartbeatHandle.unref?.();
}

/** Tests uniquement. */
export function __stopLivenessHeartbeatForTests(): void {
  if (heartbeatHandle) {
    clearInterval(heartbeatHandle);
    heartbeatHandle = null;
  }
}
