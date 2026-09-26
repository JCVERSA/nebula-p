import fs from "fs";

/**
 * Garde-fou taille du log bot (8.82, retour terrain cyberpunk).
 *
 * Contexte prod : la couche crypto WhatsApp (libsignal) crache de gros dumps
 * `SessionEntry {…}` (buffers complets) sur chaque message reçu, en direct
 * dans stdout — impossibles à taire (notre logger pino est déjà silent).
 * Tout atterrit dans /root/bot.log via la redirection de manage.sh. En
 * conteneur Docker, cron/logrotate ne tourne souvent PAS du tout, et même
 * sur VPS la rotation hebdo laissait le log gonfler sans plafond entre deux
 * passages → ~2 Go mangés en 3 jours, disque à 996 Mo, batchs refusés.
 *
 * Ce garde vit DANS le process superviseur (server.ts) : il vérifie la
 * taille du log périodiquement et le tronque au plafond. C'est le principe
 * `copytruncate` de logrotate, intégré — ça marche partout, cron ou pas.
 *
 * La redirection de manage.sh passe en mode APPEND (>>) depuis 8.82 : après
 * truncate, les écritures retombent à l'EOF (= 0) — pas de fichier sparse
 * (avec l'ancien `>`, le fd gardait son offset et le fichier re-gonflait
 * avec un trou).
 *
 * Env : NEBULA_LOG_FILE (chemin, passé par manage.sh — absent = garde
 * inactive, ex. dev au terminal), NEBULA_LOG_MAX_MB (plafond, 150 par
 * défaut), NEBULA_LOG_CHECK_MS (cadence, 10 min par défaut).
 */

export interface LogGuardResult {
  checked: boolean;
  truncated: boolean;
  sizeBytes: number;
}

export function getLogFilePath(): string | null {
  const f = (process.env.NEBULA_LOG_FILE || "").trim();
  return f || null;
}

export function getLogCapBytes(): number {
  const raw = Number(process.env.NEBULA_LOG_MAX_MB);
  const mb = Number.isFinite(raw) && raw > 0 ? raw : 150;
  return mb * 1024 * 1024;
}

/** Passe unique : tronque le log s'il dépasse le plafond. Ne lève jamais. */
export function truncateLogIfOversized(): LogGuardResult {
  const file = getLogFilePath();
  if (!file) return { checked: false, truncated: false, sizeBytes: 0 };
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    return { checked: true, truncated: false, sizeBytes: 0 };
  }
  if (size <= getLogCapBytes()) {
    return { checked: true, truncated: false, sizeBytes: size };
  }
  try {
    fs.truncateSync(file, 0);
    console.log(
      `🧹 [LogGuard] ${file} tronqué (${Math.round(size / 1024 / 1024)} Mo > plafond ` +
        `${Math.round(getLogCapBytes() / 1024 / 1024)} Mo) — les dumps crypto répétés ` +
        `n'ont aucune valeur de diagnostic, rien de fonctionnel n'est perdu.`
    );
    return { checked: true, truncated: true, sizeBytes: size };
  } catch (e: any) {
    console.warn(`[LogGuard] impossible de tronquer ${file} : ${e?.message || e}`);
    return { checked: true, truncated: false, sizeBytes: size };
  }
}

/**
 * Démarre la vérification périodique (interval unref : ne retient pas le
 * process). Un premier passage immédiat nettoie les restes d'un run
 * précédent — la redirection étant désormais en append, le log survit aux
 * restarts et peut dépasser le plafond dès le boot.
 */
export function startLogGuard(): void {
  const file = getLogFilePath();
  if (!file) {
    console.log("[LogGuard] inactif (NEBULA_LOG_FILE non défini) — ex. dev au terminal.");
    return;
  }
  const interval = Math.max(60_000, Number(process.env.NEBULA_LOG_CHECK_MS || 10 * 60_000));
  truncateLogIfOversized();
  const timer = setInterval(() => truncateLogIfOversized(), interval);
  timer.unref?.();
  console.log(
    `[LogGuard] actif : ${file} plafonné à ${Math.round(getLogCapBytes() / 1024 / 1024)} Mo ` +
      `(vérif toutes les ${Math.round(interval / 60000)} min).`
  );
}
