/**
 * 8.93 — Orchestrateur de l'agent IA (beta, PRIVÉ uniquement).
 *
 * Pourquoi ce module : la boucle de messages (botEngine) et la commande
 * `.agent` partagent le même pipeline, testable avec l'IA et l'exécuteur
 * injectés en dépendances.
 *
 * Flux :
 *   message naturel (DM sans préfixe, ou .agent <demande>)
 *     ├─ confirmation en attente ?  → OK = exécution, autre = remplace
 *     ├─ quota IA (identique au chat DM actuel)
 *     ├─ 1 appel IA avec contrat JSON strict → execute | ask | reply
 *     ├─ JSON invalide → dégradation : rappel avec le prompt guidage
 *     │  classique (leçon Laudacode : « degrades, never aborts »)
 *     ├─ execute → validation locale zéro confiance (registre + denylist)
 *     │    ├─ lourd  → confirmation fail-closed (OK explicite, TTL 2 min)
 *     │    └─ léger  → exécution directe (plafond 10/h en plus du quota)
 *     └─ erreur de commande → UN rattrapage IA (explique + propose la
 *        commande corrigée en attente d'OK) — jamais de boucle.
 *
 * En groupe l'agent n'exécute JAMAIS (beta) : la commande .agent y répond
 * par une notice honnête, et la boucle ne branche l'agent que en privé.
 */

import { getCommand } from "../commandRegistry.js";
import { generateTextWithFallback, isAIConfigured } from "../geminiClient.js";
import { getPersonaPrompt } from "../persona.js";
import { checkAIQuota, consumeAIQuota, withAIConcurrency } from "../aiQuota.js";
import { recordAudit } from "../auditTrail.js";
import {
  getMemoryContext,
  recordExchange,
  compactIfNeeded,
  defaultMemorySummarizer
} from "./aiMemory.js";
import { buildAgentKnowledge } from "../commandKnowledge.js";
import type { AgentCommandOutcome } from "../commandDispatch.js";
import {
  parseAgentDecision,
  parseAgentFix,
  isAgentDeniedCommand,
  isHeavyAgentCommand,
  checkAgentBudget,
  recordAgentExecution,
  setPendingConfirmation,
  peekPendingConfirmation,
  takePendingConfirmation,
  clearPendingConfirmation,
  isConfirmationAffirmative,
  toggleCatalogFlag
} from "./agentBrain.js";

export interface AgentMessageInfo {
  senderJid: string;    // jid du chat (clé mémoire)
  actorJid: string;     // expéditeur réel (clé quota/confirmations)
  actorNumber: string;  // numéro masqué pour l'audit
  senderName: string;
  isOwner: boolean;
  text: string;
  botName: string;
  prefix: string;
}

export type AgentExecutor = (
  commandName: string,
  args: string[],
  source: "agent"
) => Promise<AgentCommandOutcome>;

/** Message honnête identique au chemin DM actuel quand l'IA est down. */
const AI_DOWN_NOTICE =
  "😕 *L'IA est momentanément indisponible.*\n\n🔁 *Réessaie dans un instant.*\n_Si ça persiste, préviens l'administrateur du bot._";

/**
 * Tente de traiter le message comme une demande agent.
 * @returns true = géré (le chemin IA normal doit s'arrêter), false = laisser
 *          le chemin normal prendre le relais (IA non configurée).
 */
export async function handleAgentMessage(
  sock: any,
  msg: any,
  info: AgentMessageInfo,
  exec: AgentExecutor
): Promise<boolean> {
  const text = (info.text || "").trim();
  if (!text) return false;

  const sendText = async (t: string) => {
    try {
      await sock.sendMessage(info.senderJid, { text: t }, { quoted: msg });
    } catch {}
  };
  const setPresence = async (state: "composing" | "paused") => {
    try {
      if (sock && typeof sock.sendPresenceUpdate === "function") {
        await sock.sendPresenceUpdate(state, info.senderJid);
      }
    } catch {}
  };

  // ── 1. Confirmation en attente (fail-closed) ────────────────────────────
  if (peekPendingConfirmation(info.actorJid)) {
    if (isConfirmationAffirmative(text)) {
      const p = takePendingConfirmation(info.actorJid)!;
      if (!checkAgentBudget(info.actorJid)) {
        await sendText("⏳ Tu as déjà demandé beaucoup d'actions cette heure — réessaie dans un instant.");
        return true;
      }
      recordAgentExecution(info.actorJid);
      recordAudit(`wa:${info.actorNumber}`, "agent.exec", p.command, "confirmed");
      await setPresence("composing");
      try {
        const out = await exec(p.command, p.args, "agent");
        if (!out.denied && out.vfFallbackHint && p.command === "anime") {
          await offerCatalogRetry(sock, msg, info, p.args, out.hadError);
        } else if (out.hadError && !out.denied) {
          await runErrorRecovery(sock, msg, info, exec, {
            command: p.command, args: p.args, lastText: out.lastText
          });
        }
      } finally {
        await setPresence("paused");
      }
      return true;
    }
    // Tout autre message remplace la demande en cours (silencieusement).
    clearPendingConfirmation(info.actorJid);
  }

  // ── 2. IA non configurée → le chemin normal gère (message d'accueil) ────
  if (!isAIConfigured()) return false;

  // ── 3. Quota IA — même règle que le chat DM actuel ──────────────────────
  const quota = checkAIQuota(info.actorJid);
  if (!quota.allowed) {
    await sendText(`⚠️ ${quota.error}`);
    return true;
  }

  await setPresence("composing");
  try {
    consumeAIQuota(info.actorJid);
    const memoryBlock = getMemoryContext(info.senderJid);
    const persona = getPersonaPrompt("dm", info.botName) + (memoryBlock ? `\n\n${memoryBlock}` : "");
    const agentSystem = `${persona}\n\n${buildAgentKnowledge(info.prefix)}`;

    let decision = null as ReturnType<typeof parseAgentDecision>;
    try {
      const raw = await withAIConcurrency(() =>
        generateTextWithFallback(text, agentSystem, "gemini-3.7-flash")
      );
      decision = parseAgentDecision(raw);
    } catch {
      await sendText(AI_DOWN_NOTICE);
      return true;
    }

    if (!decision) {
      // ── Dégradation : prompt guidage classique (comportement d'avant
      //    l'agent) — jamais de silence, jamais de JSON cassé chez l'user.
      const raw = await withAIConcurrency(() =>
        generateTextWithFallback(text, persona, "gemini-3.7-flash")
      );
      await sendText(raw);
      recordExchange(info.senderJid, text, raw);
      compactIfNeeded(info.senderJid, defaultMemorySummarizer).catch(() => {});
      return true;
    }

    if (decision.action === "reply" || decision.action === "ask") {
      await sendText(decision.text);
      recordExchange(info.senderJid, text, decision.text);
      compactIfNeeded(info.senderJid, defaultMemorySummarizer).catch(() => {});
      return true;
    }

    // ── action = execute : validation locale, zéro confiance ───────────────
    const canonical = getCommand(decision.command);
    if (!canonical || isAgentDeniedCommand(canonical.name)) {
      recordAudit(
        `wa:${info.actorNumber}`,
        "agent.deny",
        decision.command,
        canonical ? "denylist" : "unknown-command"
      );
      const honest =
        canonical && isAgentDeniedCommand(canonical.name)
          ? `🤖 Je ne peux pas exécuter \`${info.prefix}${canonical.name}\` moi-même — utilise-la directement.`
          : `🤖 Je n'ai pas de commande pour cette demande — tape \`${info.prefix}menu\` pour voir ce que je sais faire.`;
      await sendText(honest);
      recordExchange(info.senderJid, text, honest);
      return true;
    }

    const args = decision.args.split(/\s+/).filter(Boolean);
    const pretty = `\`${info.prefix}${canonical.name}${args.length ? ` ${args.join(" ")}` : ""}\``;

    // ── Lourd → confirmation fail-closed ──────────────────────────────────
    if (isHeavyAgentCommand(canonical, args)) {
      setPendingConfirmation(info.actorJid, { command: canonical.name, args, say: decision.say });
      recordAudit(`wa:${info.actorNumber}`, "agent.confirm.pending", canonical.name, "heavy");
      await sendText(
        `${decision.say ? `${decision.say}\n\n` : ""}⚠️ Je m'apprête à lancer ${pretty} — réponds *OK* pour confirmer _(2 minutes)_.`
      );
      return true;
    }

    // ── Léger → direct (plafond agent en plus du quota IA) ────────────────
    if (!checkAgentBudget(info.actorJid)) {
      await sendText("⏳ Tu as déjà demandé beaucoup d'actions cette heure — réessaie dans un instant.");
      return true;
    }
    if (decision.say) await sendText(decision.say);
    recordAgentExecution(info.actorJid);
    recordAudit(`wa:${info.actorNumber}`, "agent.exec", canonical.name, "light");
    const out = await exec(canonical.name, args, "agent");

    if (!out.denied && out.vfFallbackHint && canonical.name === "anime") {
      await offerCatalogRetry(sock, msg, info, args, out.hadError);
    } else if (out.hadError && !out.denied) {
      await runErrorRecovery(sock, msg, info, exec, {
        command: canonical.name, args, lastText: out.lastText
      });
    }
    recordExchange(info.senderJid, text, decision.say || `[${canonical.name} exécutée]`);
    compactIfNeeded(info.senderJid, defaultMemorySummarizer).catch(() => {});
    return true;
  } catch {
    await sendText(AI_DOWN_NOTICE);
    return true;
  } finally {
    await setPresence("paused");
  }
}

/**
 * 8.94 — Bascule déterministe de catalogue anime : la commande a signalé
 * « langue absente sur ce catalogue, essaie l'autre ». L'agent connaît le
 * retry EXACT (même one-liner, flag va basculé) : aucun appel IA, juste
 * une offre confirmée par OK (fail-closed comme le reste).
 */
async function offerCatalogRetry(
  sock: any,
  msg: any,
  info: AgentMessageInfo,
  args: string[],
  commandStopped: boolean
): Promise<void> {
  const retryArgs = toggleCatalogFlag(args);
  const rest = (retryArgs[0]?.toLowerCase() === "va" ? retryArgs.slice(1) : retryArgs).join(" ");
  const display = `${info.prefix}a${retryArgs[0]?.toLowerCase() === "va" ? " va" : ""}${rest ? ` ${rest}` : ""}`;
  setPendingConfirmation(info.actorJid, { command: "anime", args: retryArgs });
  recordAudit(`wa:${info.actorNumber}`, "agent.confirm.pending", "anime", "catalog-retry");
  const closing = commandStopped
    ? ""
    : "\n_Le bot a déjà proposé la suite en VOSTFR — choisis simplement la résolution si ça te convient._";
  try {
    await sock.sendMessage(
      info.senderJid,
      { text: `ℹ️ *Cette langue n'est pas sur ce catalogue.*\nJe peux essayer l'autre : \`${display}\`\n\nRéponds *OK* pour que je lance _(2 minutes)_.${closing}` },
      { quoted: msg }
    );
  } catch {}
}

/**
 * Rattrapage UNIQUE après une commande en erreur : l'erreur de la commande
 * est déjà visible chez l'utilisateur ; l'IA explique et peut proposer la
 * commande corrigée — qui, elle aussi, attend un OK explicite.
 */
async function runErrorRecovery(
  sock: any,
  msg: any,
  info: AgentMessageInfo,
  exec: AgentExecutor,
  errContext: { command: string; args: string[]; lastText: string }
): Promise<void> {
  try {
    const quota = checkAIQuota(info.actorJid);
    if (!quota.allowed) return; // l'erreur est déjà visible, pas de bruit
    consumeAIQuota(info.actorJid);

    const system =
      `Tu es l'agent du bot ${info.botName}. Une commande que tu viens de lancer pour l'utilisateur ` +
      `a répondu par un message d'erreur (reproduit plus bas). Explique en 1 à 2 phrases en français ` +
      `ce qui s'est passé, sans jargon technique, et propose une suite utile.\n\n` +
      `Réponds par un UNIQUE objet JSON, rien d'autre :\n` +
      `{"say":"<explication courte>","offer":{"command":"<commande sans préfixe>","args":"<arguments corrigés>"} ou null}\n` +
      `offer = null si aucune commande corrigée n'a de sens. Jamais .ai ni .agent dans offer.`;

    const launched = `${info.prefix}${errContext.command}${errContext.args.length ? ` ${errContext.args.join(" ")}` : ""}`;
    const raw = await withAIConcurrency(() =>
      generateTextWithFallback(
        `L'utilisateur avait demandé : « ${info.text.slice(0, 300)} ».\n` +
        `Tu as lancé ${launched} et le bot a répondu :\n« ${errContext.lastText.slice(0, 600)} »`,
        system,
        "gemini-3.7-flash"
      )
    );
    const fix = parseAgentFix(raw);
    if (!fix) return; // erreur déjà visible — on ne rajoute pas de bruit

    let out = fix.say;
    if (fix.offer) {
      const c = getCommand(fix.offer.command);
      if (c && !isAgentDeniedCommand(c.name)) {
        const oArgs = fix.offer.args.split(/\s+/).filter(Boolean);
        setPendingConfirmation(info.actorJid, { command: c.name, args: oArgs });
        recordAudit(`wa:${info.actorNumber}`, "agent.confirm.pending", c.name, "recovery");
        const pretty = `\`${info.prefix}${c.name}${oArgs.length ? ` ${oArgs.join(" ")}` : ""}\``;
        out += `\n\n_Réponds *OK* pour que je lance ${pretty} _(2 minutes)_._`;
      }
    }
    try {
      await sock.sendMessage(info.senderJid, { text: out }, { quoted: msg });
    } catch {}
  } catch {
    // L'erreur de la commande est déjà chez l'utilisateur : silence ici.
  }
}
