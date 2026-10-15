import { BotCommand } from "../types.js";
import {
  parseReminderSpec,
  listReminders,
  addReminder,
  cancelReminder
} from "../services/reminderService.js";

/**
 * `.remind` — rappels programmés (9.18bb, P7 du plan owner).
 *
 *   .remind 18h télécharger mushoku        → ⏰ livré à 18h00 (heure Cameroun)
 *   .remind 18h30 appeler maman
 *   .remind dans 30 min faire une pause
 *   .remind dans 1h30 couper le feu
 *   .remind demain 9h réviser les annales
 *   .remind list                           → rappels actifs (numérotés)
 *   .remind cancel 2                       → annule le n°2
 *
 * L'agent route « rappelle-moi de X à 18h » vers .remind 18h X (le moment
 * en premier, puis le texte). Parsing déterministe (reminderService), les
 * heures sont en heure du Cameroun (Africa/Douala). Léger : pas de quota IA.
 */

function fmtRemaining(dueAt: number, now: number): string {
  const ms = dueAt - now;
  if (ms <= 0) return "maintenant";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `dans ${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  if (h < 24) return `dans ${h} h${rest ? ` ${String(rest).padStart(2, "0")}` : ""}`;
  const days = Math.floor(h / 24);
  return `dans ${days} j`;
}

const remindCommand: BotCommand = {
  name: "remind",
  aliases: ["rappel", "rappelle"],
  category: "Utilities",
  description: "Rappel programmé (ex: .remind 18h texte — aussi dans 30 min, demain 9h ; list, cancel N)",
  usage: ".remind <moment> <texte>",
  execute: async (_sock, _msg, context) => {
    const spec = parseReminderSpec((context.args || []).join(" "));

    if (!spec) {
      return void (await context.reply(
        "⏰ *Rappels*\n\n" +
        "• `.remind 18h télécharger mushoku`\n" +
        "• `.remind 18h30 appeler maman`\n" +
        "• `.remind dans 30 min faire une pause`\n" +
        "• `.remind demain 9h réviser les annales`\n\n" +
        "• `.remind list` — tes rappels actifs\n" +
        "• `.remind cancel 2` — annule le n°2\n\n" +
        "_Heure du Cameroun · 10 rappels actifs max · 7 jours max d'avance._"
      ));
    }

    if (spec.kind === "list") {
      const list = listReminders(context.sender);
      if (list.length === 0) {
        return void (await context.reply("⏰ Aucun rappel actif dans ce chat."));
      }
      const now = Date.now();
      const lines = list
        .map((r, i) => `*${i + 1}.* ${r.text}\n   _${fmtRemaining(r.dueAt, now)}_`)
        .join("\n\n");
      return void (await context.reply(`⏰ *Tes rappels (${list.length})*\n\n${lines}\n\n_Annuler : .remind cancel <n>_`));
    }

    if (spec.kind === "cancel") {
      const ok = cancelReminder(context.sender, spec.index);
      return void (await context.reply(ok ? "✅ Rappel annulé." : "❌ Ce numéro n'existe pas — `.remind list` pour voir."));
    }

    // kind === "set"
    const rec = addReminder(context.sender, spec.dueAt, spec.text);
    if (!rec) {
      return void (await context.reply("⚠️ Tu as déjà *10 rappels actifs* dans ce chat — annule-en un avec `.remind list` + `.remind cancel <n>`."));
    }
    await context.reply(`⏰ *C'est noté* — ${spec.humanWhen}.\n\n« ${spec.text} »\n\n_Silencieux jusqu'à l'heure ; annuler : .remind cancel <n>_`);
  },
};

export default remindCommand;
