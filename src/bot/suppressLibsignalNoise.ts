/**
 * Filtre anti-fuite libsignal (9.0c — sécurité).
 *
 * Constaté en production (nouveau VPS Docker) : libsignal — la couche de
 * chiffrement de Baileys — imprime des SESSIONS COMPLÈTES via
 * console.info/console.warn à la fermeture :
 *
 *   node_modules/libsignal/src/session_record.js
 *     console.warn("Session already closed", session);
 *     console.info("Closing session:", session);
 *
 * Ces dumps contiennent le matériel cryptographique (rootKey, privKey,
 * chainKey…) et atterrissent dans /root/bot.log — un fichier persistant
 * qu'on ne veut JAMAIS voir contenir des clés. Le logger pino de Baileys
 * est déjà « silent » dans botEngine, mais ces console.* de bas niveau ne
 * passent PAS par lui : impossible à couper sans patcher la lib.
 *
 * Ce module avale donc EXACTEMENT ces deux messages (comparaison stricte
 * du 1er argument) et laisse tout le reste de la console intact. Il est
 * importé au chargement du moteur, avant la première connexion.
 */

const SUPPRESSED_INFO = "Closing session:";
const SUPPRESSED_WARN = "Session already closed";
/** 9.18b — bruit de déchiffrement connu (messages hors-ordre/rejoués après
 *  une reconnexion) : Baileys imprime l'erreur AVEC sa pile, ~15 fois par
 *  incident, dans bot.log et le tail du dashboard. Rien d'actionnable —
 *  la couche au-dessus gère (message abandonné). On n'avale QUE cette
 *  combinaison exacte (prefix + Bad MAC), tout le reste passe. */
const SUPPRESSED_ERR_PREFIX = "Session error:";
/**
 * 9.18e — libsignal déverse AUSSI les sessions supprimées après une
 * reconnexion (« Removing old closed session: SessionEntry {…} ») :
 * même matériel cryptographique (privKey, rootKey, chainKey) que les
 * deux messages de 9.0c, même fichier source (session_record.js),
 * même destination (/root/bot.log) — constaté en production sur le VPS.
 * Préfixe (avec ou sans deux-points selon le formatage) + hook de
 * console.log en plus d'info/warn : la méthode exacte varie selon la
 * version de la lib, on couvre les trois.
 */
const SUPPRESSED_DUMP_PREFIX = "Removing old closed session";

function isSessionDump(args: unknown[]): boolean {
  return (
    args.length > 0 &&
    typeof args[0] === "string" &&
    args[0].startsWith(SUPPRESSED_DUMP_PREFIX)
  );
}

const g = globalThis as { __nebulaLibsignalNoiseSuppressed?: boolean };

if (!g.__nebulaLibsignalNoiseSuppressed) {
  g.__nebulaLibsignalNoiseSuppressed = true;

  const originalLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    if (isSessionDump(args)) return; // session complète (clés) → jetée
    originalLog(...args);
  };

  const originalInfo = console.info.bind(console);
  console.info = (...args: unknown[]) => {
    if (args[0] === SUPPRESSED_INFO || isSessionDump(args)) return; // clé de session → jeté
    originalInfo(...args);
  };

  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (args[0] === SUPPRESSED_WARN || isSessionDump(args)) return; // objet session → jeté
    originalWarn(...args);
  };

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (args.length > 1 && args[0] === SUPPRESSED_ERR_PREFIX) {
      const second = args[1] as { message?: unknown } | undefined;
      const text = String(second instanceof Error ? second.message : (second ?? ""));
      if (text.includes("Bad MAC")) return; // bruit connu → jeté
    }
    originalError(...args);
  };
}
