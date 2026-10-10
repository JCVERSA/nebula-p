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
import { effectiveDefaultSource } from "./animeSources.js";
import { getAnimeChoiceContext, messageSuggestsAnimeHistory } from "./animeChoices.js";
import { recordAgentTurn } from "./agentMetrics.js";
import { setLastObservation, outputLooksInteractive, observationContext } from "./agentObservation.js";
import { getPrimaryAIEngine } from "../geminiClient.js";
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
  toggleCatalogFlag,
  sanitizeAgentArgs
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
    // 8.97/8.99 — mémoire des choix interactifs, INJECTÉE À LA DEMANDE
    // (leçon Mastra : ce bloc n'a d'utilité que si le message parle
    // d'anime/téléchargement — le sortir de « salut ça va » économise le
    // prompt et réduit le bruit).
    const choiceBlock = messageSuggestsAnimeHistory(text)
      ? getAnimeChoiceContext(info.senderJid)
      : null;
    // 9.1 — écran en attente dans ce chat (liste de sélection…) : sans ce
    // contexte, un « le 2e » ou « en VF » en réponse naturelle repartirait
    // d'une page blanche → boucle. TTL 10 min côté agentObservation.
    const obsBlock = observationContext(info.senderJid);
    const persona =
      getPersonaPrompt("dm", info.botName) +
      (memoryBlock ? `\n\n${memoryBlock}` : "") +
      (choiceBlock ? `\n\n${choiceBlock}` : "") +
      (obsBlock ? `\n\n${obsBlock}` : "");
    const agentSystem = `${persona}\n\n${buildAgentKnowledge(info.prefix)}`;

    let decision = null as ReturnType<typeof parseAgentDecision>;
    let rawLatencyMs = 0;
    try {
      const tStart = Date.now();
      const raw = await withAIConcurrency(() =>
        // 8.99 — mode JSON natif : l'API contraint la réponse (Gemini
        // responseMimeType / NIM response_format). Le parsing tolérant
        // reste la garde (fail-closed) — ce n'est pas de la confiance.
        generateTextWithFallback(text, agentSystem, "gemini-3.7-flash", { jsonMode: true })
      );
      rawLatencyMs = Date.now() - tStart;
      decision = parseAgentDecision(raw);
    } catch {
      recordAgentTurn({
        ts: Date.now(), action: "error", engine: getPrimaryAIEngine(),
        latencyMs: 0, parseOk: false, argsSanitized: false
      });
      await sendText(AI_DOWN_NOTICE);
      return true;
    }

    if (!decision) {
      // ── Dégradation : prompt guidage classique (comportement d'avant
      //    l'agent) — jamais de silence, jamais de JSON cassé chez l'user.
      recordAgentTurn({
        ts: Date.now(), action: "degraded", engine: getPrimaryAIEngine(),
        latencyMs: rawLatencyMs, parseOk: false, argsSanitized: false
      });
      const raw = await withAIConcurrency(() =>
        generateTextWithFallback(text, persona, "gemini-3.7-flash")
      );
      await sendText(raw);
      recordExchange(info.senderJid, text, raw);
      compactIfNeeded(info.senderJid, defaultMemorySummarizer).catch(() => {});
      return true;
    }

    // 8.99 — tracing : une ligne par tour, SANS contenu (vie privée).
    recordAgentTurn({
      ts: Date.now(),
      action: decision.action === "execute" ? "execute" : decision.action === "ask" ? "ask" : "reply",
      engine: getPrimaryAIEngine(),
      latencyMs: rawLatencyMs,
      parseOk: true,
      argsSanitized: false // mis à jour ci-dessous si le guardrail agit
    });

    // ══ 9.1 — Boucle d'observation bornée (owner : « l'agent prend tout en
    // charge, je n'ai rien à taper ») : décide → exécute → OBSERVE la sortie
    // de la commande → décide l'étape suivante (ex. `.a 2` pour choisir dans
    // la liste) ou s'arrête proprement. Plafond 3 décisions IA par message
    // (décision owner — éco tokens, pas de dérive). TOUS les garde-fous
    // 8.93/8.98/8.99 s'appliquent à CHAQUE itération : validation locale
    // zéro confiance, sanitizeArgs, lourd = confirmation, plafond/h, quota
    // IA re-vérifié avant chaque décision.
    const MAX_AI_DECISIONS = 3;
    let decisionsUsed = 1; // la décision initiale compte
    let current = decision;
    const executedSignatures = new Set<string>(); // anti-boucle dégénérée

    while (true) {
      if (current.action === "reply" || current.action === "ask") {
        await sendText(current.text);
        recordExchange(info.senderJid, text, current.text);
        compactIfNeeded(info.senderJid, defaultMemorySummarizer).catch(() => {});
        return true;
      }

      // ── action = execute : validation locale, zéro confiance ─────────────
      const canonical = getCommand(current.command);
      if (!canonical || isAgentDeniedCommand(canonical.name)) {
        recordAgentTurn({
          ts: Date.now(), action: "denied", engine: getPrimaryAIEngine(),
          latencyMs: rawLatencyMs, parseOk: true, argsSanitized: false
        });
        recordAudit(
          `wa:${info.actorNumber}`,
          "agent.deny",
          current.command,
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

      // 8.99 — guardrail d'arguments (leçon OpenAI Agents SDK) : l'IA ne
      // peut pas glisser URL/backticks/flags dans les args d'une commande
      // autorisée. Exécution avec les args NETTOYÉS (la commande revalide).
      const rawArgs = current.args.split(/\s+/).filter(Boolean);
      const sanitized = sanitizeAgentArgs(rawArgs);
      if (sanitized.changed) {
        recordAudit(`wa:${info.actorNumber}`, "agent.args.sanitized", canonical.name, "");
      }
      const args = sanitized.args;
      const pretty = `\`${info.prefix}${canonical.name}${args.length ? ` ${args.join(" ")}` : ""}\``;

      // ── Lourd → confirmation fail-closed ─────────────────────────────────
      if (isHeavyAgentCommand(canonical, args)) {
        setPendingConfirmation(info.actorJid, { command: canonical.name, args, say: current.say });
        recordAudit(`wa:${info.actorNumber}`, "agent.confirm.pending", canonical.name, "heavy");
        await sendText(
          `${current.say ? `${current.say}\n\n` : ""}⚠️ Je m'apprête à lancer ${pretty} — réponds *OK* pour confirmer _(2 minutes)_.`
        );
        return true;
      }

      // ── Léger → direct (plafond agent en plus du quota IA) ──────────────
      if (!checkAgentBudget(info.actorJid)) {
        await sendText("⏳ Tu as déjà demandé beaucoup d'actions cette heure — réessaie dans un instant.");
        return true;
      }

      // 9.1 — anti-boucle : ne JAMAIS exécuter deux fois la même commande
      // avec les mêmes args dans un seul message (dérive IA impossible).
      const signature = `${canonical.name}|${args.join(" ")}`;
      if (executedSignatures.has(signature)) {
        await sendText("_Je m'arrête là — réponds directement au message du bot ci-dessus (ex. `.a 1`)._");
        return true;
      }
      executedSignatures.add(signature);

      if (current.say) await sendText(current.say);
      recordAgentExecution(info.actorJid);
      recordAudit(`wa:${info.actorNumber}`, "agent.exec", canonical.name, "light");
      const out = await exec(canonical.name, args, "agent");

      // 9.1 — mémorise la sortie pour CE chat : le tour suivant de l'agent
      // (ex. l'utilisateur répond « le 2e ») saura à quoi ça se rapporte.
      setLastObservation(info.senderJid, canonical.name, out.texts);

      if (!out.denied && out.vfFallbackHint && canonical.name === "anime") {
        await offerCatalogRetry(sock, msg, info, args, out.hadError);
        return true;
      }
      if (out.hadError && !out.denied) {
        await runErrorRecovery(sock, msg, info, exec, {
          command: canonical.name, args, lastText: out.lastText
        });
        return true;
      }

      // 9.1 — la sortie attend-elle un choix que l'agent peut piloter ?
      if (!outputLooksInteractive(out.texts)) {
        // Terminé (lien envoyé, réponse simple…) : rien à piloter.
        recordExchange(info.senderJid, text, current.say || `[${canonical.name} exécutée]`);
        compactIfNeeded(info.senderJid, defaultMemorySummarizer).catch(() => {});
        return true;
      }
      if (decisionsUsed >= MAX_AI_DECISIONS) {
        // Plafond atteint sur un écran interactif : relais propre, pas de
        // boucle — l'utilisateur répond directement au message du bot.
        await sendText("_Je passe le relais : réponds directement au message ci-dessus (ex. `.a 1`)._");
        return true;
      }
      const quotaNext = checkAIQuota(info.actorJid);
      if (!quotaNext.allowed) {
        await sendText(`⚠️ ${quotaNext.error}\n_Réponds directement au message ci-dessus (ex. \`.a 1\`)._`);
        return true;
      }

      // ── Décision de relance : 1 appel IA, sortie observée en contexte ──
      consumeAIQuota(info.actorJid);
      decisionsUsed++;
      const observation = out.texts.join("\n—\n").slice(0, 2400);
      const followUpSystem =
        `${agentSystem}\n\n` +
        `## Situation — tu viens d'agir\n` +
        `Tu as exécuté \`${info.prefix}${canonical.name}${args.length ? ` ${args.join(" ")}` : ""}\` pour l'utilisateur.\n` +
        `Le bot a répondu dans WhatsApp :\n\n${observation}\n\n` +
        `Décide de la suite par un UNIQUE objet JSON {"action":…} :\n` +
        `- La demande de l'utilisateur désigne CLAIREMENT une entrée de la liste (titre/numéro/saison/qualité demandés) → \"execute\" avec la commande qui choisit (ex. commande \"a\", args \"2\").\n` +
        `- Vraiment ambigu → \"ask\" avec UNE question courte qui liste les options pertinentes (numérotées).\n` +
        `- Préférence utilisateur (VF/VOSTFR, qualité non demandée, « tout la saison ? ») → TOUJOURS \"ask\", jamais à sa place.\n` +
        `- Si tout est déjà terminé (lien envoyé) → \"reply\" avec une phrase très courte.\n` +
        `Interdits : relancer la même commande avec les mêmes arguments ; inventer un numéro absent de la liste.`;
      let next = null as ReturnType<typeof parseAgentDecision>;
      try {
        const rawNext = await withAIConcurrency(() =>
          generateTextWithFallback(text, followUpSystem, "gemini-3.7-flash", { jsonMode: true })
        );
        next = parseAgentDecision(rawNext);
      } catch {
        next = null;
      }
      if (!next) {
        await sendText("_Réponds directement au message ci-dessus (ex. `.a 1`)._");
        return true;
      }
      current = next;
    }
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
  // 8.96 : le défaut est fourni ici (agentBrain reste sans dépendance) et
  // le flag de retry peut être va OU as — même règle de reconnaissance que
  // le parser (mot isolé exact).
  const retryArgs = toggleCatalogFlag(args, effectiveDefaultSource());
  const flag = /^(va|as)$/i.test(retryArgs[0] || "") ? retryArgs[0].toLowerCase() : "";
  const rest = (flag ? retryArgs.slice(1) : retryArgs).join(" ");
  const display = `${info.prefix}a${flag ? ` ${flag}` : ""}${rest ? ` ${rest}` : ""}`;
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
        out += `\n\n_Réponds *OK* pour lancer ${pretty} — 2 minutes pour confirmer._`;
      }
    }
    try {
      await sock.sendMessage(info.senderJid, { text: out }, { quoted: msg });
    } catch {}
  } catch {
    // L'erreur de la commande est déjà chez l'utilisateur : silence ici.
  }
}
