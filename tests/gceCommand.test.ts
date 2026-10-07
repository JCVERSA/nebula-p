import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * 8.91 — commande .gce : flow guidé owner + raccourci + pacing + suppression
 * des fichiers du VPS. Le client est MOCKÉ (aucun réseau) ; le téléchargement
 * écrit un VRAI fichier temporaire pour prouver sa suppression après envoi.
 */
vi.mock("../src/bot/services/gcerevisionClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bot/services/gcerevisionClient.js")>();
  return {
    ...actual,
    getLevelSubjects: vi.fn(),
    getLevelYears: vi.fn(),
    getSubjectsForYear: vi.fn(),
    getSubjectSessions: vi.fn(),
    resolvePaper: vi.fn(),
    downloadPaperPdf: vi.fn()
  };
});

import gceCommand, { __setPaceForTests, parseMultiSelect } from "../src/bot/commands/gce.js";
import {
  getLevelSubjects,
  getLevelYears,
  getSubjectsForYear,
  getSubjectSessions,
  resolvePaper,
  downloadPaperPdf
} from "../src/bot/services/gcerevisionClient.js";

const m = {
  getLevelSubjects: vi.mocked(getLevelSubjects),
  getLevelYears: vi.mocked(getLevelYears),
  getSubjectsForYear: vi.mocked(getSubjectsForYear),
  getSubjectSessions: vi.mocked(getSubjectSessions),
  resolvePaper: vi.mocked(resolvePaper),
  downloadPaperPdf: vi.mocked(downloadPaperPdf)
};

const SENDER = "237640143760@s.whatsapp.net";
const mkCtx = (args: string[]) => ({
  sender: SENDER,
  senderName: "Tester",
  isOwner: true,
  isAdmin: false,
  prefix: ".",
  commandName: "gce",
  args,
  fullMessage: "",
  reply: vi.fn(async (t: string) => t),
  react: vi.fn()
}) as any;

const mkSockMsg = () => {
  const sent: any[] = [];
  const sock = {
    sendMessage: vi.fn(async (_to: string, payload: any) => {
      sent.push(payload);
      return {};
    })
  };
  return { sock: sock as any, msg: { key: { remoteJid: "chat@g.us" } } as any, sent };
};

const SUBJECT = { name: "Biology", url: "https://cameroongcerevision.com/a-level/june-biology-a-level/", level: "al" as const };

function mkTmpPdf(): string {
  const p = path.join(os.tmpdir(), `gce_test_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(p, Buffer.alloc(4096));
  return p;
}

beforeEach(() => {
  vi.clearAllMocks();
  __setPaceForTests(20, 10_000); // défauts
});

afterEach(() => {
  __setPaceForTests(20, 10_000);
});

describe("8.91 — parseMultiSelect", () => {
  it("simple, liste, plage, mélange — et rejet des hors-limites", () => {
    expect(parseMultiSelect("1", 5)).toEqual([1]);
    expect(parseMultiSelect("1,3", 5)).toEqual([1, 3]);
    expect(parseMultiSelect("1-3", 5)).toEqual([1, 2, 3]);
    expect(parseMultiSelect("1-2,5", 5)).toEqual([1, 2, 5]);
    expect(parseMultiSelect("0", 5)).toBeNull();
    expect(parseMultiSelect("6", 5)).toBeNull();
    expect(parseMultiSelect("abc", 5)).toBeNull();
    expect(parseMultiSelect("5-1", 5)).toBeNull();
  });
});

describe("8.91 — flow guidé (owner)", () => {
  it("étape par étape : niveau → année → matière → papiers → envoi + suppression du fichier", async () => {
    // .gce → menu niveau
    let ctx = mkCtx([]);
    await gceCommand.execute(mkSockMsg().sock, mkSockMsg().msg, ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain("Ordinary Level");

    // .gce 2 → années
    m.getLevelYears.mockResolvedValue([2026, 2025, 2023]);
    ctx = mkCtx(["2"]);
    await gceCommand.execute(mkSockMsg().sock, mkSockMsg().msg, ctx);
    expect(m.getLevelYears).toHaveBeenCalledWith("al");
    expect(ctx.reply.mock.calls.at(-1)![0]).toContain("2026");

    // .gce 2023 → matières
    m.getSubjectsForYear.mockResolvedValue([
      { subject: SUBJECT, sessions: [{ label: "juin 2023", year: 2023, kind: "june", papers: [{ label: "Paper 1", articleUrl: "https://x/bio-1/" }, { label: "Paper 2", articleUrl: "https://x/bio-2/" }, { label: "Paper 3", articleUrl: null }] }] }
    ]);
    ctx = mkCtx(["2023"]);
    await gceCommand.execute(mkSockMsg().sock, mkSockMsg().msg, ctx);
    expect(ctx.reply.mock.calls.at(-1)![0]).toContain("Biology");

    // .gce bio → papiers (Paper 3 ❌ visible)
    ctx = mkCtx(["bio"]);
    await gceCommand.execute(mkSockMsg().sock, mkSockMsg().msg, ctx);
    const papersList = ctx.reply.mock.calls.at(-1)![0];
    expect(papersList).toContain("Paper 1 ✅");
    expect(papersList).toContain("Paper 3 ❌");

    // .gce 1,3 → envoi : Paper 1 PDF envoyé + supprimé, Paper 3 indisponible
    const tmp = mkTmpPdf();
    m.resolvePaper.mockResolvedValue({ kind: "pdf", pdfUrl: "https://x/p.pdf", filename: "bio.pdf" });
    m.downloadPaperPdf.mockResolvedValue(tmp);
    const { sock, msg, sent } = mkSockMsg();
    ctx = mkCtx(["1,3"]);
    await gceCommand.execute(sock, msg, ctx);
    expect(sent).toHaveLength(1); // Paper 1 seulement — Paper 3 sans articleUrl
    expect(sent[0].mimetype).toBe("application/pdf");
    expect(sent[0].fileName).toBe("GCE_A-Level_Biology_2023_Paper_1.pdf");
    expect(fs.existsSync(tmp)).toBe(false); // décision owner : rien ne reste sur le VPS
    expect(ctx.reply.mock.calls.at(-1)![0]).toContain("1 PDF envoyé");
    expect(ctx.reply.mock.calls.at(-1)![0]).toContain("1 indisponible");
  });

  it(".gce 2 à froid démarre le flow au niveau demandé (pas « matière introuvable »)", async () => {
    m.getLevelYears.mockResolvedValue([2026, 2023]);
    const ctx = mkCtx(["2"]);
    await gceCommand.execute(mkSockMsg().sock, mkSockMsg().msg, ctx);
    expect(m.getLevelYears).toHaveBeenCalledWith("al"); // « 2 » = A/L, pas une matière
    expect(ctx.reply.mock.calls.at(-1)![0]).toContain("2026");
  });

  it("une session active absorbe .gce 3 (réponse d'étape), jamais un raccourci", async () => {
    m.getLevelYears.mockResolvedValue([2026, 2023]);
    // Session ouverte à l'étape année (A/L)
    await gceCommand.execute(mkSockMsg().sock, mkSockMsg().msg, mkCtx(["2"]));
    // .gce 2 à l'étape année = 2ᵉ année de la liste (2023), PAS une matière
    m.getSubjectsForYear.mockResolvedValue([]);
    await gceCommand.execute(mkSockMsg().sock, mkSockMsg().msg, mkCtx(["2"]));
    expect(m.getSubjectsForYear).toHaveBeenCalledWith("al", 2023);
    // Un vrai raccourci traverse la session sans la consommer
    m.getLevelYears.mockClear();
    m.getLevelSubjects.mockResolvedValue([SUBJECT]);
    m.getSubjectSessions.mockResolvedValue([
      { label: "juin 2023", year: 2023, kind: "june", papers: [{ label: "Paper 1", articleUrl: "https://x/1/" }] }
    ]);
    const tmp = mkTmpPdf();
    m.resolvePaper.mockResolvedValue({ kind: "pdf", pdfUrl: "https://x/p.pdf", filename: "p.pdf" });
    m.downloadPaperPdf.mockResolvedValue(tmp);
    const { sock, msg, sent } = mkSockMsg();
    await gceCommand.execute(sock, msg, mkCtx(["a", "bio", "2023", "1"]));
    expect(m.getLevelSubjects).toHaveBeenCalledWith("al"); // chemin raccourci
    expect(sent).toHaveLength(1);
    expect(fs.existsSync(tmp)).toBe(false);
  });
});

describe("8.91 — raccourci une ligne", () => {
  it(".gce a bio 2023 2 → envoi direct sans questions", async () => {
    m.getLevelSubjects.mockResolvedValue([SUBJECT]);
    m.getSubjectSessions.mockResolvedValue([
      { label: "juin 2023", year: 2023, kind: "june", papers: [{ label: "Paper 1", articleUrl: "https://x/1/" }, { label: "Paper 2", articleUrl: "https://x/2/" }] }
    ]);
    const tmp = mkTmpPdf();
    m.resolvePaper.mockResolvedValue({ kind: "pdf", pdfUrl: "https://x/p.pdf", filename: "p.pdf" });
    m.downloadPaperPdf.mockResolvedValue(tmp);
    const { sock, msg, sent } = mkSockMsg();
    const ctx = mkCtx(["a", "bio", "2023", "2"]);
    await gceCommand.execute(sock, msg, ctx);
    expect(sent).toHaveLength(1);
    expect(sent[0].fileName).toBe("GCE_A-Level_Biology_2023_Paper_2.pdf");
    expect(fs.existsSync(tmp)).toBe(false);
  });

  it("matière inconnue → message honnête + suggestion du flow guidé", async () => {
    m.getLevelSubjects.mockResolvedValue([SUBJECT]);
    const ctx = mkCtx(["a", "zoulou", "2023", "1"]);
    await gceCommand.execute(mkSockMsg().sock, mkSockMsg().msg, ctx);
    expect(ctx.reply.mock.calls.at(-1)![0]).toContain("introuvable");
  });
});

describe("8.91 — fallback texte (PDF non publié)", () => {
  it("article sans PDF → texte officiel en UN message, étiqueté", async () => {
    m.getLevelSubjects.mockResolvedValue([SUBJECT]);
    m.getSubjectSessions.mockResolvedValue([
      { label: "juin 2026", year: 2026, kind: "june", papers: [{ label: "Paper 2", articleUrl: "https://x/food-2026/" }] }
    ]);
    m.resolvePaper.mockResolvedValue({ kind: "text", title: "Food Science 2026", text: "Section A\n1. (a) Describe steaming and frying…".repeat(3) });
    const { sock, msg, sent } = mkSockMsg();
    const ctx = mkCtx(["a", "bio", "2026", "1"]);
    await gceCommand.execute(sock, msg, ctx);
    expect(sent).toHaveLength(0); // aucun document
    const textReply = ctx.reply.mock.calls.map((c: any[]) => c[0]).find((t: string) => t.includes("PDF pas encore publié"));
    expect(textReply).toBeTruthy();
    expect(textReply).toContain("Section A");
  });
});

describe("8.91 — pacing owner : libre ≤ 20/heure puis 10 s", () => {
  it("au-delà du quota, le 2ᵉ papier attend le gap (espacement réel, gap court en test)", async () => {
    __setPaceForTests(1, 400); // 1 envoi libre, puis 400 ms d'espacement (rapide en test)
    m.getLevelSubjects.mockResolvedValue([SUBJECT]);
    m.getSubjectSessions.mockResolvedValue([
      { label: "juin 2023", year: 2023, kind: "june", papers: [{ label: "Paper 1", articleUrl: "https://x/1/" }, { label: "Paper 2", articleUrl: "https://x/2/" }] }
    ]);
    const tmp = mkTmpPdf();
    m.resolvePaper.mockResolvedValue({ kind: "pdf", pdfUrl: "https://x/p.pdf", filename: "p.pdf" });
    m.downloadPaperPdf.mockResolvedValue(tmp);
    const { sock, msg, sent } = mkSockMsg();
    const ctx = mkCtx(["a", "bio", "2023", "1-2"]);
    const t0 = Date.now();
    await gceCommand.execute(sock, msg, ctx);
    const elapsed = Date.now() - t0;
    expect(sent).toHaveLength(2); // le 2ᵉ papier passe AUSSI, juste espacé
    expect(elapsed).toBeGreaterThanOrEqual(300); // …mais pas avant le gap
    expect(fs.existsSync(tmp)).toBe(false);
  }, 15_000);
});
