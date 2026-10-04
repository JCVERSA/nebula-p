import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

/**
 * 8.88 — commande `.purge` / `.p` (owner) : planificateur pur + gate owner.
 *
 * Le module services/diskPlp... (diskPurge) est partiellement mocké : le
 * PLANIFICATEUR (fonctions pures) reste réel, seul l'EXÉCUTEUR disque est
 * remplacé — aucun accès disque dans ce fichier.
 */
vi.mock("../src/bot/services/diskPurge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bot/services/diskPurge.js")>();
  return { ...actual, executeDiskPurge: vi.fn() };
});

import purgeCommand from "../src/bot/commands/purge.js";
import { executeDiskPurge, planDiskPurge, PURGE_GRACE_MS } from "../src/bot/services/diskPurge.js";

const mockedExec = vi.mocked(executeDiskPurge);

const mkContext = (isOwner: boolean) => ({ isOwner, reply: vi.fn(), react: vi.fn(), args: [] }) as any;
const mkSock = () => ({}) as any;
const mkMsg = () => ({ key: { remoteJid: "x@s.whatsapp.net" } }) as any;

// ── Planificateur pur : les règles de protection (décisions owner) ─────────
describe("8.88 — planificateur pur : règles de protection", () => {
  const now = 1_000_000_000_000;
  const OLD = now - 60 * 60 * 1000; // 1 h : au-delà de toute grâce/fenêtre

  it("aucun claim vivant → tout est purgé (records suivis, non suivis, staging)", () => {
    const plan = planDiskPurge({
      now,
      liveClaims: [],
      delivered: [
        { token: "t1", name: "/a", mtimeMs: OLD, sizeBytes: 1 },
        { token: null, name: "/b", mtimeMs: OLD, sizeBytes: 1 }
      ],
      staging: [{ name: "/tmp/cat_catch_x", mtimeMs: OLD }]
    });
    expect(plan.tokensToDelete).toEqual(["t1"]);
    expect(plan.untrackedFilesToDelete).toEqual(["/b"]);
    expect(plan.stagingDirsToDelete).toEqual(["/tmp/cat_catch_x"]);
    expect(plan.sparedDelivered).toBe(0);
    expect(plan.sparedStaging).toBe(0);
    expect(plan.activeBatches).toBe(0);
  });

  it("claim vivant → le record de CE job est épargné (règle jobId)", () => {
    const claim = { jobId: "job-live", createdAt: now - 10 * 60 * 1000 };
    const plan = planDiskPurge({
      now,
      liveClaims: [claim],
      delivered: [
        { token: "t-live", name: "/live", mtimeMs: now - 5 * 60 * 1000, sizeBytes: 1, jobId: "job-live" },
        { token: "t-old", name: "/old", mtimeMs: claim.createdAt - 60 * 60 * 1000, sizeBytes: 1, jobId: "job-fini" }
      ],
      staging: []
    });
    expect(plan.tokensToDelete).toEqual(["t-old"]);
    expect(plan.sparedDelivered).toBe(1);
    expect(plan.activeBatches).toBe(1);
  });

  it("claim vivant → fichiers créés PENDANT la fenêtre du batch épargnés (même non suivis)", () => {
    const claim = { jobId: "job-live", createdAt: now - 30 * 60 * 1000 };
    const plan = planDiskPurge({
      now,
      liveClaims: [claim],
      delivered: [
        { token: null, name: "/pendant", mtimeMs: now - 20 * 60 * 1000, sizeBytes: 1 },
        { token: null, name: "/avant", mtimeMs: now - 45 * 60 * 1000, sizeBytes: 1 }
      ],
      staging: [
        { name: "/tmp/cat_catch_pendant", mtimeMs: now - 20 * 60 * 1000 },
        { name: "/tmp/batch_zip_avant", mtimeMs: now - 45 * 60 * 1000 }
      ]
    });
    expect(plan.untrackedFilesToDelete).toEqual(["/avant"]);
    expect(plan.stagingDirsToDelete).toEqual(["/tmp/batch_zip_avant"]);
    expect(plan.sparedDelivered).toBe(1);
    expect(plan.sparedStaging).toBe(1);
  });

  it("grâce 5 min : un fichier récent sans claim est épargné (envoi single en cours, autre moteur)", () => {
    const plan = planDiskPurge({
      now,
      liveClaims: [],
      delivered: [{ token: null, name: "/frais", mtimeMs: now - (PURGE_GRACE_MS - 1000), sizeBytes: 1 }],
      staging: [{ name: "/tmp/cat_catch_frais", mtimeMs: now - 60 * 1000 }]
    });
    expect(plan.tokensToDelete).toEqual([]);
    expect(plan.untrackedFilesToDelete).toEqual([]);
    expect(plan.stagingDirsToDelete).toEqual([]);
    expect(plan.sparedDelivered).toBe(1);
    expect(plan.sparedStaging).toBe(1);
  });
});

// ── Commande : gate owner + bilan ──────────────────────────────────────────
describe("8.88 — commande .purge : gate owner + bilan", () => {
  beforeEach(() => {
    mockedExec.mockReset();
  });

  it("non-owner → refus bref, AUCUNE purge exécutée", async () => {
    const ctx = mkContext(false);
    await purgeCommand.execute(mkSock(), mkMsg(), ctx);
    expect(mockedExec).not.toHaveBeenCalled();
    expect(ctx.reply.mock.calls[0][0]).toContain("réservée à l'owner");
  });

  it("owner → purge exécutée une fois, bilan complet (fichiers, Go, épargne, espace)", async () => {
    mockedExec.mockResolvedValue({
      deletedFiles: 14,
      deletedDirs: 2,
      freedBytes: 1.62 * 1024 ** 3,
      sparedDelivered: 3,
      sparedStaging: 1,
      activeBatches: 1,
      freeBytesBefore: 1.1 * 1024 ** 3,
      freeBytesAfter: 2.7 * 1024 ** 3,
      errors: 0
    });
    const ctx = mkContext(true);
    await purgeCommand.execute(mkSock(), mkMsg(), ctx);
    expect(mockedExec).toHaveBeenCalledTimes(1);
    const text = ctx.reply.mock.calls[0][0];
    expect(text).toContain("Purge terminée");
    expect(text).toContain("14");
    expect(text).toContain("1.62 Go");
    expect(text).toContain("épargné");
    expect(text).toContain("Débris");
    expect(ctx.react).toHaveBeenCalledWith("🧹");
  });

  it("owner, rien à purger → bilan propre, pas de ligne batch", async () => {
    mockedExec.mockResolvedValue({
      deletedFiles: 0,
      deletedDirs: 0,
      freedBytes: 0,
      sparedDelivered: 0,
      sparedStaging: 0,
      activeBatches: 0,
      freeBytesBefore: 123 * 1024 * 1024,
      freeBytesAfter: 123 * 1024 * 1024,
      errors: 0
    });
    const ctx = mkContext(true);
    await purgeCommand.execute(mkSock(), mkMsg(), ctx);
    const text = ctx.reply.mock.calls[0][0];
    expect(text).toContain("Purge terminée");
    expect(text).not.toContain("épargné");
    expect(text).not.toContain("Débris");
  });

  it("échec de la purge → message d'échec honnête", async () => {
    mockedExec.mockRejectedValue(new Error("boom"));
    const ctx = mkContext(true);
    await purgeCommand.execute(mkSock(), mkMsg(), ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain("échoué");
  });
});

// ── Intégration structurelle (style audit 8.84) ───────────────────────────
describe("8.88 — intégration structurelle", () => {
  const readSrc = (f: string): string =>
    fs.readFileSync(path.resolve(process.cwd(), "src", f), "utf8");

  it("novabox : la suggestion .purge est GATED owner (context.isOwner)", () => {
    const src = readSrc("bot/commands/novabox.ts");
    const gatePos = src.indexOf("context.isOwner\n          ? \"🧹");
    expect(gatePos).toBeGreaterThan(0);
    expect(src.slice(gatePos, gatePos + 400)).toContain(".purge");
  });

  it("tempDownloadManager : jobId sur le record + purgeTempRecords exporté", () => {
    const src = readSrc("bot/tempDownloadManager.ts");
    expect(src).toContain("jobId?: string;");
    expect(src).toContain("export function purgeTempRecords");
    expect(src).toContain("export function listTempRecords");
    expect(src).toContain("export function getTempDownloadDir");
  });

  it("inventaire verrouillé : purge/p présent (décision owner 8.88)", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "tests/commandInventory.test.ts"), "utf8");
    expect(src).toContain('{ name: "purge", aliases: ["p"] }');
  });
});
