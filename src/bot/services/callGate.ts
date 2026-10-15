import { isMutedUser } from "../userDirectory.js";

/**
 * 9.18jj (A, décision owner 15/10) — décrochage honnête des appels WhatsApp.
 *
 * Baileys ne peut pas décrocher un appel (rejet = seule action supportée).
 * Sans ça, un appel au numéro du bot sonne dans le vide, sans explication —
 * contraire à notre règle d'honnêteté. Ici :
 *   - chaque offre d'appel 1:1 est rejetée proprement ;
 *   - l'appelant reçoit UNE fois (cooldown 10 min) un message qui le guide
 *     vers le talkie-walkie : note vocale → réponse en voix (.on) ;
 *   - utilisateur en sourdine : rejet SANS message (la sourdine s'applique) ;
 *   - appels groupe et statuts non-« offer » ignorés ;
 *   - jamais de crash moteur : tout échec est avalé (best-effort).
 *
 * Aucun contenu stocké : un Map jid → timestamp en mémoire (cooldown).
 */
const GUIDE_COOLDOWN_MS = 10 * 60 * 1000;
const GUIDE_CAP = 200;
const lastGuide = new Map<string, number>();

export async function handleIncomingCalls(
  sock: any,
  calls: any[],
  opts: { prefix?: string } = {},
  now = Date.now()
): Promise<void> {
  try {
    if (!Array.isArray(calls)) return;
    const p = (opts.prefix || ".").trim() || ".";
    for (const call of calls) {
      try {
        if (!call || call.status !== "offer") continue;
        const from = String(call.from || "");
        if (!from || from.includes("@g.us")) continue; // 1:1 uniquement
        try {
          if (typeof sock.rejectCall === "function") await sock.rejectCall(call.id, from);
        } catch {}
        if (isMutedUser(from)) continue; // sourdine : rejet silencieux
        const last = lastGuide.get(from);
        if (last !== undefined && now - last < GUIDE_COOLDOWN_MS) continue; // anti-spam
        lastGuide.set(from, now);
        console.log(`[CALL] 📞 appel entrant rejeté + guidage vocal (chat ${from.slice(0, 8)}…)`);
        await sock.sendMessage(from, {
          text:
            "📞 *Je ne peux pas décrocher* — les appels ne sont pas supportés.\n\n" +
            `Parle-moi en *note vocale* : je comprends et je te répondrai *en voix* (active \`${p}on\` si ce n'est pas déjà fait).`
        });
      } catch {}
    }
    if (lastGuide.size > GUIDE_CAP) {
      for (const [k, ts] of [...lastGuide.entries()]) {
        if (now - ts > GUIDE_COOLDOWN_MS) lastGuide.delete(k);
      }
    }
  } catch {
    // Le gate d'appels ne doit jamais casser le moteur.
  }
}

/** Tests uniquement. */
export function __resetCallGateForTests(): void {
  lastGuide.clear();
}
