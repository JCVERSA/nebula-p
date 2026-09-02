import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Per-conversation AI memory (audit 8.38): sliding TTL (default 10 h of
 * silence), raw turns + rolling summary (supermemory-inspired compaction
 * with an injected summarizer — no LLM here), per-chat isolation, secret
 * write-filter, `.ai forget`, hard bounds.
 */

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aimem-"));
process.env.NEBULA_DATA_DIR = DATA_DIR;
process.env.NEBULA_AI_MEMORY_TTL_HOURS = "10";
delete process.env.NEBULA_AI_MEMORY_MAX_TURNS;

// The concrete summarizer imports geminiClient — stub the module so no
// AI SDK is even loaded for these unit tests.
vi.mock("../src/bot/geminiClient.js", () => ({
  generateTextWithFallback: vi.fn(async () => "merged summary"),
  isAIConfigured: () => true
}));

import {
  getMemoryContext,
  recordExchange,
  compactIfNeeded,
  forgetMemory,
  memoryStatus,
  looksSecret,
  type MemoryTurn
} from "../src/bot/services/aiMemory.js";

const CHAT = "10000000001@s.whatsapp.net";
const OTHER = "20000000002@s.whatsapp.net";

function storePath(): string {
  return path.join(DATA_DIR, "ai_memory.json");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
  fs.rmSync(storePath(), { force: true });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
  delete process.env.NEBULA_DATA_DIR;
  delete process.env.NEBULA_AI_MEMORY_TTL_HOURS;
});


describe("aiMemory — record & inject", () => {
  it("returns null for a chat without memory, a block once recorded", () => {
    expect(getMemoryContext(CHAT)).toBeNull();
    recordExchange(CHAT, "J'adore Dune", "Je note !");
    const block = getMemoryContext(CHAT)!;
    expect(block).toContain("# Conversation memory");
    expect(block).toContain("User: J'adore Dune");
    expect(block).toContain("Nebula: Je note !");
  });

  it("chats are isolated from each other", () => {
    recordExchange(CHAT, "sujet A", "réponse A");
    recordExchange(OTHER, "sujet B", "réponse B");
    expect(getMemoryContext(CHAT)).not.toContain("sujet B");
    expect(getMemoryContext(OTHER)).not.toContain("sujet A");
  });
});

describe("aiMemory — sliding TTL", () => {
  it("keeps the memory while the conversation stays active (counter restarts)", () => {
    recordExchange(CHAT, "msg 1", "rep 1");
    vi.setSystemTime(Date.now() + 9.5 * 3600_000);
    recordExchange(CHAT, "msg 2", "rep 2"); // counter restarts here
    vi.setSystemTime(Date.now() + 9.5 * 3600_000); // 9.5h after LAST message
    expect(getMemoryContext(CHAT)).not.toBeNull();
  });

  it("expires after 10h of silence and wipes the entry", () => {
    recordExchange(CHAT, "msg", "rep");
    vi.setSystemTime(Date.now() + 10 * 3600_000 + 1000);
    expect(getMemoryContext(CHAT)).toBeNull();
    expect(fs.existsSync(storePath()) ? fs.readFileSync(storePath(), "utf-8") : "{}").not.toContain("msg");
  });

  it("TTL=0 disables memory entirely", () => {
    process.env.NEBULA_AI_MEMORY_TTL_HOURS = "0";
    recordExchange(CHAT, "nothing", "stored");
    expect(getMemoryContext(CHAT)).toBeNull();
    process.env.NEBULA_AI_MEMORY_TTL_HOURS = "10";
  });
});

describe("aiMemory — secret filter", () => {
  it("never stores exchanges that carry obvious secrets", () => {
    expect(looksSecret("mon mot de passe: hunter2")).toBe(true);
    expect(looksSecret("api_key=abc123")).toBe(true);
    expect(looksSecret("quel temps fait-il ?")).toBe(false);
    recordExchange(CHAT, "mon mot de passe: hunter2", "ok");
    expect(getMemoryContext(CHAT)).toBeNull();
  });
});

describe("aiMemory — compaction (rolling summary)", () => {
  it("folds overflow turns into the summary via the injected summarizer", async () => {
    process.env.NEBULA_AI_MEMORY_MAX_TURNS = "6";
    for (let i = 1; i <= 8; i++) recordExchange(CHAT, `q${i}`, `r${i}`); // 16 turns
    const seen: MemoryTurn[][] = [];
    let previous = "";
    await compactIfNeeded(
      CHAT,
      async (prev, old) => {
        previous = prev;
        seen.push(old);
        return "SUMMARY-" + old.length;
      }
    );
    expect(seen).toHaveLength(1); // one batch of old turns
    expect(previous).toBe(""); // no previous summary yet
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf-8"));
    expect(raw[CHAT].turns.length).toBe(12); // RAW_TURNS_TARGET
    expect(raw[CHAT].summary).toBe("SUMMARY-" + seen[0]!.length);
    // injection contains both the summary and the recent turns
    const block = getMemoryContext(CHAT)!;
    expect(block).toContain("SUMMARY-");
    expect(block).toContain("q8");
    process.env.NEBULA_AI_MEMORY_MAX_TURNS = undefined as any;
    delete process.env.NEBULA_AI_MEMORY_MAX_TURNS;
  });

  it("keeps raw turns (hard-capped) when the summarizer fails", async () => {
    process.env.NEBULA_AI_MEMORY_MAX_TURNS = "6";
    for (let i = 1; i <= 8; i++) recordExchange(CHAT, `q${i}`, `r${i}`);
    await compactIfNeeded(CHAT, async () => {
      throw new Error("LLM down");
    });
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf-8"));
    expect(raw[CHAT].turns.length).toBeGreaterThan(6); // nothing lost
    expect(raw[CHAT].summary).toBe("");
    delete process.env.NEBULA_AI_MEMORY_MAX_TURNS;
  });
});

describe("aiMemory — forget & status", () => {
  it(".ai forget wipes exactly this chat", () => {
    recordExchange(CHAT, "a", "b");
    recordExchange(OTHER, "c", "d");
    expect(forgetMemory(CHAT)).toBe(true);
    expect(getMemoryContext(CHAT)).toBeNull();
    expect(getMemoryContext(OTHER)).not.toBeNull();
    expect(forgetMemory(CHAT)).toBe(false);
  });

  it("status reports turns and remaining hours", () => {
    recordExchange(CHAT, "x", "y");
    const s = memoryStatus(CHAT);
    expect(s).toContain("2 turns");
    expect(s).toContain("h left");
  });
});
