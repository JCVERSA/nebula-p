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

const g = globalThis as { __nebulaLibsignalNoiseSuppressed?: boolean };

if (!g.__nebulaLibsignalNoiseSuppressed) {
  g.__nebulaLibsignalNoiseSuppressed = true;

  const originalInfo = console.info.bind(console);
  console.info = (...args: unknown[]) => {
    if (args.length > 0 && args[0] === SUPPRESSED_INFO) return; // clé de session → jeté
    originalInfo(...args);
  };

  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (args.length > 0 && args[0] === SUPPRESSED_WARN) return; // objet session → jeté
    originalWarn(...args);
  };
}
