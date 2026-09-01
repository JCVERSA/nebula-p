import { afterAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { database } from "../src/bot/database.js";

/**
 * Warnings cache bounds (audit 8.32): addWarning evicts FIFO beyond
 * WARNINGS_CACHE_MAX (2000) and replaceAllWarnings bounds its input even
 * without the route-level guard.
 */

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "warn-test-"));
process.env.NEBULA_DATA_DIR = DATA_DIR;
afterAll(() => {
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
});

describe("warnings cache bounds", () => {
  it("addWarning evicts the oldest entry beyond the cap", () => {
    for (let i = 0; i < 2010; i++) {
      database.addWarning("g1@g.us", "user" + i + "@s.whatsapp.net", "r" + i);
    }
    const all = database.getAllWarnings();
    const keys = Object.keys(all);
    expect(keys.length).toBeLessThanOrEqual(2000);
    expect(all["g1@g.us_user0@s.whatsapp.net"]).toBeUndefined(); // oldest evicted
    expect(all["g1@g.us_user2009@s.whatsapp.net"]).toBeDefined(); // newest kept
  });

  it("replaceAllWarnings bounds its input (defense in depth)", () => {
    const flood: Record<string, { count: number; reasons: string[] }> = {};
    for (let i = 0; i < 2500; i++) flood["g@g.us_u" + i] = { count: 1, reasons: ["x"] };
    const n = database.replaceAllWarnings(flood as any);
    expect(n).toBe(2000);
  });
});
