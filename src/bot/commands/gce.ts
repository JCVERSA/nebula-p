import fs from "fs";
import { BotCommand } from "../types.js";
import {
  GceLevel,
  GcePaper,
  GceSubject,
  getLevelSubjects,
  getLevelYears,
  getSubjectSessions,
  getSubjectsForYear,
  matchSubject,
  resolvePaper,
  downloadPaperPdf,
  type SubjectYearAvailability
} from "../services/gcerevisionClient.js";

/**
 * `.gce` / `.g` / `.ge` / `.papier` (8.91) — annales GCE Cameroun
 * (cameroongcerevision.com) : O/L, A/L et mocks régionaux, en PDF.
 *
 * Flow owner-validé 2026-10-06 (guidé par défaut) :
 *   .gce → OL/AL ? → année ? → matières dispo ? → papier(s) →
 *   PDF envoyé en document WhatsApp puis SUPPRIMÉ du VPS immédiatement.
 *
 * + raccourci une ligne (owner-validé) : .gce [a|o] <matière> <année> [papiers]
 * + fallback texte (owner-validé) : papier sans PDF publié → texte officiel
 *   en un seul message.
 * + pacing (owner-validé) : libre jusqu'à 20 papiers/heure par utilisateur,
 *   puis 10 s d'espacement automatique entre chaque papier.
 *
 * Papiers indisponibles : jamais de silence — état ❌ affiché AVANT le choix,
 * détail honnête dans le bilan si tentés via raccourci.
 */

const SESSION_TTL_MS = 10 * 60 * 1000;
const PACE_WINDOW_MS = 60 * 60 * 1000;
let PACE_FREE_COUNT = 20;   // owner : libre jusqu'à 20 papiers/heure…
let PACE_GAP_MS = 10 * 1000; // …puis 10 s entre chaque (auto-espacé)

/** Test hook — pacing accéléré pour les tests (aucune attente réelle). */
export function __setPaceForTests(freeCount: number, gapMs: number): void {
  PACE_FREE_COUNT = freeCount;
  PACE_GAP_MS = gapMs;
}

interface FlatPaper {
  sessionLabel: string;
  paper: GcePaper;
}

interface GceFlow {
  createdAt: number;
  step: "level" | "year" | "subject" | "papers";
  level?: GceLevel;
  year?: number;
  availability?: SubjectYearAvailability[];
  subject?: GceSubject;
  flatPapers?: FlatPaper[];
}

const flows = new Map<string, GceFlow>();
const sendLog = new Map<string, number[]>();

function freshFlow(): GceFlow {
  return { createdAt: Date.now(), step: "level" };
}

function getFlow(sender: string): GceFlow | null {
  const f = flows.get(sender);
  if (!f) return null;
  if (Date.now() - f.createdAt > SESSION_TTL_MS) {
    flows.delete(sender);
    return null;
  }
  return f;
}

/** Pacing owner : libre ≤ 20/heure, puis 10 s entre papiers (auto-espacé). */
async function paceBeforeSend(user: string): Promise<void> {
  const now = Date.now();
  const log = (sendLog.get(user) || []).filter(t => now - t < PACE_WINDOW_MS);
  if (log.length >= PACE_FREE_COUNT) {
    const wait = PACE_GAP_MS - (now - log[log.length - 1]);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }
  const stamp = Date.now();
  log.push(stamp);
  sendLog.set(user, log);
}

export function parseMultiSelect(input: string, max: number): number[] | null {
  const s = input.replace(/\s+/g, "");
  if (!/^\d+([,-]\d+)*$/.test(s)) return null;
  const out = new Set<number>();
  for (const part of s.split(",")) {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      if (!(a >= 1 && b >= a && b <= max)) return null;
      for (let i = a; i <= b; i++) out.add(i);
    } else {
      const n = Number(part);
      if (!(n >= 1 && n <= max)) return null;
      out.add(n);
    }
  }
  return Array.from(out).sort((a, b) => a - b);
}

const levelLabel = (l: GceLevel) => (l === "al" ? "Advanced Level (A/L)" : "Ordinary Level (O/L)");
const levelShort = (l: GceLevel) => (l === "al" ? "A-Level" : "O-Level");

function friendlyFilename(subject: GceSubject, level: GceLevel, year: number, label: string): string {
  const s = (t: string) => t.replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 60);
  return `GCE_${s(levelShort(level))}_${s(subject.name)}_${year}_${s(label)}.pdf`;
}

async function sendSelectedPapers(
  sock: any, chatId: string, msg: any, context: any,
  subject: GceSubject, level: GceLevel, year: number, papers: FlatPaper[]
): Promise<void> {
  let sentPdf = 0;
  let sentText = 0;
  const failed: string[] = [];
  for (const fp of papers) {
    if (!fp.paper.articleUrl) {
      failed.push(`${fp.sessionLabel} · ${fp.paper.label} : pas encore publié`);
      continue;
    }
    try {
      const resolved = await resolvePaper(fp.paper.articleUrl);
      if (resolved.kind === "pdf") {
        const tmp = await downloadPaperPdf(resolved.pdfUrl);
        try {
          await paceBeforeSend(context.sender);
          await sock.sendMessage(chatId, {
            document: { url: tmp },
            mimetype: "application/pdf",
            fileName: friendlyFilename(subject, level, year, fp.paper.label),
            caption: `📚 *${subject.name}* — ${levelShort(level)} · ${fp.sessionLabel} · ${fp.paper.label}\n_Source : cameroongcerevision.com_`
          }, { quoted: msg });
          sentPdf++;
        } finally {
          try { fs.unlinkSync(tmp); } catch {} // décision owner : rien ne reste sur le VPS
        }
      } else if (resolved.kind === "text") {
        await paceBeforeSend(context.sender);
        await context.reply(
          `📝 *${subject.name}* — ${fp.sessionLabel} · ${fp.paper.label}\n` +
          `⚠️ _PDF pas encore publié sur le site — texte officiel de la page_\n\n${resolved.text}`
        );
        sentText++;
      } else {
        failed.push(`${fp.sessionLabel} · ${fp.paper.label} : ${resolved.detail}`);
      }
    } catch (err: any) {
      console.error(`[GCE] échec ${subject.name} ${fp.sessionLabel} ${fp.paper.label}: ${err?.message || err}`);
      failed.push(`${fp.sessionLabel} · ${fp.paper.label} : erreur du site`);
    }
  }
  if (papers.length > 1) {
    const parts = [`✅ ${sentPdf} PDF envoyé${sentPdf > 1 ? "s" : ""}`];
    if (sentText > 0) parts.push(`📝 ${sentText} en texte (PDF non publié)`);
    if (failed.length > 0) parts.push(`❌ ${failed.length} indisponible${failed.length > 1 ? "s" : ""}`);
    await context.reply(`🎓 *Bilan — ${subject.name} ${year}*\n${parts.join(" · ")}` + (failed.length ? `\n\n_${failed.join("\n")}_` : ""));
  } else if (papers.length === 1 && failed.length === 1) {
    await context.reply(`❌ *${failed[0]}.*\n💡 Réessaie un autre papier de la même session.`);
  }
}

// ── Raccourci une ligne : .gce [a|o] <matière> <année> [papiers] ────────────
async function handleShortcut(sock: any, msg: any, context: any, args: string[]): Promise<boolean> {
  let level: GceLevel | null = null;
  let year: number | null = null;
  let paperSel: string | null = null;
  const words: string[] = [];
  for (const tok of args) {
    if (/^(a|al)$/i.test(tok)) level = "al";
    else if (/^(o|ol)$/i.test(tok)) level = "ol";
    else if (/^(19|20)\d{2}$/.test(tok)) year = Number(tok);
    else if (/^\d+([,-]\d+)*$/.test(tok) && year !== null) paperSel = tok;
    else words.push(tok);
  }
  const subjectQuery = words.join(" ").trim();
  if (!subjectQuery) return false; // pas de raccourci → flow guidé

  await context.reply(`🔍 *GCE* — recherche « ${subjectQuery} »…`);
  const levels: GceLevel[] = level ? [level] : ["ol", "al"];
  const found: Array<{ subject: GceSubject; level: GceLevel }> = [];
  for (const lv of levels) {
    try {
      const subjects = await getLevelSubjects(lv);
      const m = matchSubject(subjects, subjectQuery);
      if (m) found.push({ subject: m, level: lv });
    } catch (err: any) {
      console.error(`[GCE] getLevelSubjects(${lv}) échoué: ${err.message}`);
    }
  }
  if (found.length === 0) {
    await context.reply(`❌ Matière *« ${subjectQuery} »* introuvable.\n💡 Tape \`.gce\` pour voir la liste guidée des matières.`);
    return true;
  }
  if (found.length > 1 && !level) {
    await context.reply(
      `🎓 *« ${found[0].subject.name} » existe aux deux niveaux — lequel ?*\n\n1. Ordinary Level (O/L)\n2. Advanced Level (A/L)\n\n${year ? `_Ensuite je continue pour ${year}._` : ""}`
    );
    const flow = freshFlow();
    flow.step = "level";
    flow.subject = found[0].subject; // même nom aux deux niveaux
    flow.year = year ?? undefined;
    flow.createdAt = Date.now();
    flows.set(context.sender, flow);
    // Note : le niveau choisi relancera la recherche du sujet du bon niveau
    (flow as any).pendingShortcut = { query: subjectQuery, paperSel };
    return true;
  }
  const chosen = found.length > 1 && level ? found.find(f => f.level === level)! : found[0];
  return await proceedSubject(sock, msg, context, chosen.subject, chosen.level, year, paperSel);
}

async function proceedSubject(
  sock: any, msg: any, context: any,
  subject: GceSubject, level: GceLevel, year: number | null, paperSel: string | null
): Promise<boolean> {
  const sessions = await getSubjectSessions(subject);
  if (sessions.length === 0) {
    await context.reply(`❌ Aucune session trouvée pour *${subject.name}* — réessaie plus tard.`);
    return true;
  }
  if (year === null) {
    const years = Array.from(new Set(sessions.map(s => s.year))).sort((a, b) => b - a);
    await context.reply(
      `📅 *${subject.name} ${levelShort(level)}* — sessions disponibles :\n\n` +
      years.map((y, i) => `${i + 1}. ${y}`).join("\n") +
      `\n\n_Réponds avec le numéro ou l'année._`
    );
    const flow = freshFlow();
    flow.step = "year";
    flow.level = level;
    flow.subject = subject;
    flows.set(context.sender, flow);
    return true;
  }
  const matching = sessions.filter(s => s.year === year);
  if (matching.length === 0) {
    const closest = sessions.map(s => s.year).sort((a, b) => Math.abs(a - year) - Math.abs(b - year))[0];
    await context.reply(`❌ *${subject.name}* : rien pour ${year}.\n💡 Session la plus proche : ${closest}.`);
    return true;
  }
  const flat: FlatPaper[] = [];
  for (const sess of matching) {
    for (const p of sess.papers) flat.push({ sessionLabel: sess.label, paper: p });
  }
  if (paperSel) {
    const idx = parseMultiSelect(paperSel, flat.length);
    if (!idx) {
      await context.reply(`❌ Sélection de papiers invalide (1 à ${flat.length}).`);
      return true;
    }
    await sendSelectedPapers(sock, msg.key.remoteJid, msg, context, subject, level, year, idx.map(i => flat[i - 1]));
    return true;
  }
  await context.reply(
    `📄 *${subject.name} ${levelShort(level)} — ${year}*\n\n` +
    flat.map((fp, i) => `${i + 1}. ${fp.sessionLabel} · ${fp.paper.label} ${fp.paper.articleUrl ? "✅" : "❌ _pas publié_"}`).join("\n") +
    `\n\n_Réponds avec le(s) numéro(s) : 1 · 1,3 · 1-3_`
  );
  const flow = freshFlow();
  flow.step = "papers";
  flow.level = level;
  flow.subject = subject;
  flow.year = year;
  flow.flatPapers = flat;
  flows.set(context.sender, flow);
  return true;
}

// ── Commande ────────────────────────────────────────────────────────────────

const gceCommand: BotCommand = {
  name: "gce",
  aliases: ["g", "ge", "papier"],
  category: "Tools",
  description: "Annales GCE Cameroun en PDF (O/L, A/L, mocks).",
  usage: "gce  ·  gce a bio 2023 2",
  execute: async (sock, msg, context) => {
    const chatId = msg.key.remoteJid!;
    const args = (context.args || []).map(a => a.trim()).filter(Boolean);
    try {
      // `.gce` sans argument : (re)démarrage du flow guidé — une session
      // existante est remplacée (décision : relancer = repartir de zéro).
      if (args.length === 0) {
        await context.react("🎓");
        await context.reply(
          `🎓 *GCE Past Papers — Cameroun*\n\n` +
          `Quel niveau ?\n\n1. Ordinary Level (O/L)\n2. Advanced Level (A/L)\n\n` +
          `_Réponds : ${context.prefix}gce 1 · ou tout en une ligne : ${context.prefix}gce a bio 2023 2_`
        );
        flows.set(context.sender, freshFlow());
        return;
      }

      // `.gce 2` à froid (aucune session en cours) : « 2 » n'est pas une
      // matière — on démarre le flow guidé directement au niveau demandé
      // au lieu de répondre « matière introuvable ».
      if (!getFlow(context.sender) && args.length === 1 && /^(1|2|o|a|ol|al)$/i.test(args[0])) {
        flows.set(context.sender, freshFlow());
      }

      // Priorité des entrées : une SESSION ACTIVE absorbe la réponse
      // (ex. `.gce 3` à l'étape année) SAUF si l'entrée ressemble
      // franchement à un raccourci (une année 4 chiffres + un mot).
      const activeFlow = getFlow(context.sender);
      const looksLikeShortcut =
        args.some(a => /^(19|20)\d{2}$/.test(a)) && args.some(a => /[a-zà-ÿ]/i.test(a));
      if (!(activeFlow && !looksLikeShortcut)) {
        const handled = await handleShortcut(sock, msg, context, args);
        if (handled) return;
      }

      // ── Flow guidé : réponse de session ──
      const flow = activeFlow;
      if (!flow) {
        await context.reply(
          `🎓 Tape \`${context.prefix}gce\` pour commencer, ou tout en une ligne : \`${context.prefix}gce a bio 2023 2\``
        );
        return;
      }

      const input = args.join(" ").trim();

      if (flow.step === "level") {
        const pendingShortcut: { query: string; paperSel: string | null } | undefined = (flow as any).pendingShortcut;
        const lv: GceLevel | null =
          /^(1|ol|o)$/i.test(input) ? "ol" : /^(2|al|a)$/i.test(input) ? "al" : null;
        if (!lv) {
          await context.reply("❌ Réponds *1* (O/L) ou *2* (A/L).");
          return;
        }
        if (pendingShortcut) {
          // Relancer le raccourci avec le niveau tranché
          const subjects = await getLevelSubjects(lv);
          const m = matchSubject(subjects, pendingShortcut.query);
          if (!m) {
            await context.reply(`❌ « ${pendingShortcut.query} » n'existe pas en ${levelLabel(lv)}.`);
            flows.delete(context.sender);
            return;
          }
          flows.delete(context.sender);
          await proceedSubject(sock, msg, context, m, lv, flow.year ?? null, pendingShortcut.paperSel);
          return;
        }
        flow.level = lv;
        flow.step = "year";
        flow.createdAt = Date.now();
        await context.reply(`⏳ _Chargement du catalogue ${levelLabel(lv)}…_ (quelques secondes la première fois)`);
        const years = await getLevelYears(lv);
        if (years.length === 0) {
          await context.reply("⚠️ Le site GCE ne répond pas bien — réessaie dans un instant.");
          flows.delete(context.sender);
          return;
        }
        await context.reply(
          `📅 *${levelLabel(lv)}* — années disponibles :\n\n` +
          years.map((y, i) => `${i + 1}. ${y}`).join(" · ") +
          `\n\n_Réponds avec le numéro ou l'année (mocks inclus)._`
        );
        return;
      }

      if (flow.step === "year" && flow.level) {
        const years = await getLevelYears(flow.level);
        let year: number | null = null;
        if (/^\d+$/.test(input)) {
          const n = Number(input);
          year = years[n - 1] ?? (/^(19|20)\d{2}$/.test(input) ? n : null);
        }
        if (year === null) {
          await context.reply("❌ Réponds avec un numéro ou une année de la liste.");
          return;
        }
        flow.year = year;
        flow.step = "subject";
        flow.createdAt = Date.now();
        const availability = await getSubjectsForYear(flow.level, year);
        if (availability.length === 0) {
          await context.reply(`⚠️ Aucune matière chargée pour ${year} — réessaie dans un instant.`);
          flows.delete(context.sender);
          return;
        }
        flow.availability = availability;
        const lines: string[] = [];
        for (let i = 0; i < availability.length; i++) {
          lines.push(`${i + 1}. ${availability[i].subject.name}`);
        }
        await context.reply(
          `📚 *Matières disponibles — ${levelLabel(flow.level)} · ${year}*\n\n` +
          lines.join("\n") +
          `\n\n_Réponds avec le numéro ou le nom (ex. bio)._`
        );
        return;
      }

      if (flow.step === "subject" && flow.level && flow.year && flow.availability) {
        let subject: GceSubject | null = null;
        if (/^\d+$/.test(input)) {
          subject = flow.availability[Number(input) - 1]?.subject || null;
        } else {
          subject = matchSubject(flow.availability.map(a => a.subject), input);
        }
        if (!subject) {
          await context.reply("❌ Choisis une matière de la liste (numéro ou nom).");
          return;
        }
        const availability = flow.availability.find(a => a.subject.url === subject!.url)!;
        const flat: FlatPaper[] = [];
        for (const sess of availability.sessions) {
          for (const p of sess.papers) flat.push({ sessionLabel: sess.label, paper: p });
        }
        if (flat.length === 0) {
          await context.reply(`❌ Aucun papier publié pour *${subject.name}* en ${flow.year}.`);
          return;
        }
        flow.subject = subject;
        flow.flatPapers = flat;
        flow.step = "papers";
        flow.createdAt = Date.now();
        await context.reply(
          `📄 *${subject.name} ${levelShort(flow.level)} — ${flow.year}*\n\n` +
          flat.map((fp, i) => `${i + 1}. ${fp.sessionLabel} · ${fp.paper.label} ${fp.paper.articleUrl ? "✅" : "❌ _pas publié_"}`).join("\n") +
          `\n\n_Réponds avec le(s) numéro(s) : 1 · 1,3 · 1-3_`
        );
        return;
      }

      if (flow.step === "papers" && flow.subject && flow.level && flow.year && flow.flatPapers) {
        const idx = parseMultiSelect(input, flow.flatPapers.length);
        if (!idx) {
          await context.reply(`❌ Réponds avec le(s) numéro(s) : 1 · 1,3 · 1-3 (1 à ${flow.flatPapers.length}).`);
          return;
        }
        const chosen = idx.map(i => flow.flatPapers![i - 1]);
        flows.delete(context.sender);
        await sendSelectedPapers(sock, chatId, msg, context, flow.subject, flow.level, flow.year, chosen);
        return;
      }
    } catch (err: any) {
      console.error("[GCE] Fatal:", err?.message || err);
      await context.reply("⚠️ Le site GCE ne répond pas bien — réessaie dans un instant.");
    }
  }
};

export default gceCommand;
