import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import renewYouTubeCommand, { loadLegacyEconomy } from "../src/bot/commands/renewYouTube.js";

/**
 * `.rnyt` (2026-09-01): credits +3000 coins into the LEGACY economy ledger so
 * `.ytvideo` (150) / `.song` (50) can be used. The critical property: the
 * command and the legacy commands must share the SAME module singleton and
 * the same sender key, otherwise credits would land in a parallel ledger.
 */

const DB_PATH = path.join(process.cwd(), "src/bot/imported/utils/economy_db.json");
const ECONOMY_PATH = path.join(process.cwd(), "src/bot/imported/utils/economy.js");
const SENDER = "10000000002@s.whatsapp.net";

let dbBackup: string;

function purgeEconomyCache() {
  const req = createRequire(import.meta.url);
  delete req.cache[ECONOMY_PATH];
}

beforeEach(() => {
  dbBackup = fs.readFileSync(DB_PATH, "utf-8");
  process.env.NEBULA_ENABLE_LEGACY = "true";
});

afterEach(() => {
  fs.writeFileSync(DB_PATH, dbBackup);
  delete process.env.NEBULA_ENABLE_LEGACY;
  purgeEconomyCache();
});

function fakeContext() {
  const replies: string[] = [];
  return {
    replies,
    ctx: {
      sender: SENDER,
      senderName: "Tester",
      reply: async (text: string) => void replies.push(text),
      react: async () => {},
    } as any,
  };
}

describe(".rnyt — economy bridge", () => {
  it("shares the exact module singleton the legacy .ytvideo command debits", () => {
    const viaCommand = loadLegacyEconomy()!;
    // Exactly how src/bot/imported/commands/media/video.js resolves it:
    // require('../../utils/economy') relative to the legacy file.
    const legacyRequire = createRequire(path.join(process.cwd(), "src/bot/imported/commands/media/video.js"));
    const viaLegacy = legacyRequire("../../utils/economy");
    expect(viaLegacy).toBe(viaCommand); // same instance from Node's require cache
  });

  it("credits +3000 to the sender, visible on disk AND to the legacy side", async () => {
    const eco = loadLegacyEconomy()!;
    const before = eco.getUser(SENDER).coins;

    const { ctx, replies } = fakeContext();
    await renewYouTubeCommand.execute({} as any, {} as any, ctx);

    expect(eco.getUser(SENDER).coins).toBe(before + 3000);
    // persisted for the next restart
    const onDisk = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
    expect(onDisk[SENDER].coins).toBe(before + 3000);
    // friendly confirmation (locale-safe: strip all space flavours)
    expect(replies[0].replace(/[\s\u00a0\u202f]/g, "")).toContain("+3000");
  });

  it("is repeatable — a second .rnyt adds 3000 more", async () => {
    const eco = loadLegacyEconomy()!;
    const before = eco.getUser(SENDER).coins;
    const a = fakeContext();
    const b = fakeContext();
    await renewYouTubeCommand.execute({} as any, {} as any, a.ctx);
    await renewYouTubeCommand.execute({} as any, {} as any, b.ctx);
    expect(eco.getUser(SENDER).coins).toBe(before + 6000);
  });

  it("explains the quarantine instead of crediting a useless ledger when legacy is off", async () => {
    delete process.env.NEBULA_ENABLE_LEGACY;
    const { ctx, replies } = fakeContext();
    await renewYouTubeCommand.execute({} as any, {} as any, ctx);
    expect(replies[0]).toContain("quarantaine");
    expect(replies[0]).toContain(".youtube");
    // no coins created in quarantine mode
    expect(fs.readFileSync(DB_PATH, "utf-8")).toBe(dbBackup);
  });

  it("registers under the expected name and aliases", () => {
    expect(renewYouTubeCommand.name).toBe("rnyt");
    expect(renewYouTubeCommand.aliases).toContain("renewyoutube");
  });
});
