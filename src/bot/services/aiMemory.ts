import fs from "fs";
import path from "path";
import crypto from "crypto";
import { generateTextWithFallback } from "../geminiClient.js";

/**
 * Per-conversation persistent AI memory (audit 8.38, 2026-09-01).
 *
 * Owner decisions: keyed PER CHAT, SLIDING TTL (default 10 h — the counter
 * restarts on every message; memory empties only after 10 h of silence),
 * storage = recent RAW turns + ROLLING SUMMARY of older ones (supermemory-
 * inspired compaction, amortized ~1 internal summarization call per 8
 * exchanges), full user controls (`.ai forget`, write-time secret filter,
 * hard bounds). Zero new dependencies: JSON with atomic writes, like the
 * other stores.
 *
 * Env: NEBULA_AI_MEMORY_TTL_HOURS (default 10, "0" disables memory),
 * NEBULA_AI_MEMORY_MAX_TURNS (default 20 raw turns kept).
 */

export interface MemoryTurn {
  role: "user" | "assistant";
  text: string;
  ts: number;
}

export interface ChatMemory {
  turns: MemoryTurn[];
  summary: string;
  lastTs: number;
}

type MemoryStore = Record<string, ChatMemory>;

const DEFAULT_TTL_HOURS = 10;
const RAW_TURNS_TARGET = 12; // after compaction, keep this many raw turns
const ABSOLUTE_TURN_CAP = 40; // never let turns grow beyond this, even if
// summarization keeps failing (oldest dropped, logged)
const MAX_TURN_CHARS = 1500;
const MAX_SUMMARY_CHARS = 2000;
const MAX_STORED_CHATS = 500;
const MAX_BLOCK_CHARS = 4000; // injection block budget

const SECRET_HINT_RE =
  /(mot\s*de\s*passe|password|passwd|pin\b|code\s*(card|carte)|cvv|cvc|secret|api[\s_-]*key|token)\s*[:=]/i;

function dataDir(): string {
  return process.env.NEBULA_DATA_DIR || path.join(process.cwd(), "database");
}

function storePath(): string {
  return path.join(dataDir(), "ai_memory.json");
}

export function getMemoryTtlMs(): number {
  const raw = Number(process.env.NEBULA_AI_MEMORY_TTL_HOURS);
  const hours = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_TTL_HOURS;
  return hours * 60 * 60 * 1000;
}

export function isMemoryEnabled(): boolean {
  return getMemoryTtlMs() > 0;
}

function maxTurns(): number {
  const raw = Number(process.env.NEBULA_AI_MEMORY_MAX_TURNS);
  return Number.isFinite(raw) && raw >= 4 && raw <= ABSOLUTE_TURN_CAP ? Math.floor(raw) : 20;
}

function loadStore(): MemoryStore {
  try {
    if (fs.existsSync(storePath())) {
      const parsed = JSON.parse(fs.readFileSync(storePath(), "utf-8"));
      if (parsed && typeof parsed === "object") return parsed as MemoryStore;
    }
  } catch (e: any) {
    console.warn(`[AI Memory] Failed to load store (${e?.message}) — starting fresh.`);
  }
  return {};
}

function saveStore(store: MemoryStore): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const tmp = storePath() + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(store), "utf-8");
    fs.renameSync(tmp, storePath());
  } catch (e: any) {
    console.warn(`[AI Memory] Failed to persist store (${e?.message}) — memory stays in this process only.`);
  }
}

function evictIfNeeded(store: MemoryStore): void {
  const keys = Object.keys(store);
  if (keys.length <= MAX_STORED_CHATS) return;
  keys
    .sort((a, b) => (store[a]?.lastTs || 0) - (store[b]?.lastTs || 0))
    .slice(0, keys.length - MAX_STORED_CHATS)
    .forEach((k) => delete store[k]);
}

/** Sliding TTL: an entry dies only after TTL of silence. */
function isExpired(memory: ChatMemory, now: number): boolean {
  return now - memory.lastTs > getMemoryTtlMs();
}

function pruneTurns(memory: ChatMemory): void {
  const cap = Math.max(ABSOLUTE_TURN_CAP, maxTurns());
  if (memory.turns.length > cap) {
    memory.turns = memory.turns.slice(memory.turns.length - cap);
  }
}

/**
 * Builds the memory injection block for the system prompt, or null when the
 * memory is empty/disabled/expired. Reads are side-effect free except TTL
 * expiry cleanup (sliding TTL — expired entries are dropped on sight).
 */
export function getMemoryContext(chatJid: string, now = Date.now()): string | null {
  if (!isMemoryEnabled()) return null;
  const store = loadStore();
  const memory = store[chatJid];
  if (!memory) return null;
  if (isExpired(memory, now)) {
    delete store[chatJid];
    saveStore(store);
    return null;
  }

  const lines: string[] = ["# Conversation memory (earlier in this chat)"];
  if (memory.summary) {
    lines.push(`Summary of the oldest exchanges: ${memory.summary}`);
  }
  for (const turn of memory.turns) {
    lines.push(`${turn.role === "user" ? "User" : "Nebula"}: ${turn.text}`);
  }
  const block = lines.join("\n").slice(0, MAX_BLOCK_CHARS);
  return block.length > 0 ? block : null;
}

/** Write-time guard: never persist turns that carry obvious secrets. */
export function looksSecret(text: string): boolean {
  return SECRET_HINT_RE.test(text);
}

/**
 * Records one exchange. Secret-bearing user turns are skipped entirely
 * (their answer too — a reply to a secret often echoes context around it).
 */
export function recordExchange(chatJid: string, userText: string, assistantText: string, now = Date.now()): void {
  if (!isMemoryEnabled()) return;
  if (looksSecret(userText) || looksSecret(assistantText)) return;

  const store = loadStore();
  const memory: ChatMemory = store[chatJid] || { turns: [], summary: "", lastTs: now };
  if (isExpired(memory, now)) {
    memory.turns = [];
    memory.summary = "";
  }
  memory.turns.push({ role: "user", text: userText.slice(0, MAX_TURN_CHARS), ts: now });
  memory.turns.push({ role: "assistant", text: assistantText.slice(0, MAX_TURN_CHARS), ts: now });
  memory.lastTs = now;
  pruneTurns(memory);
  store[chatJid] = memory;
  evictIfNeeded(store);
  saveStore(store);
}

/**
 * Compaction (supermemory-style distillation, lazy): when raw turns exceed
 * the configured max, fold the oldest ones into the rolling summary using
 * the injected summarizer (no LLM in tests). When the summarizer fails or is
 * absent, the absolute cap in pruneTurns keeps the file bounded.
 */
export async function compactIfNeeded(
  chatJid: string,
  summarizer: (previousSummary: string, oldTurns: MemoryTurn[]) => Promise<string>,
  now = Date.now()
): Promise<void> {
  if (!isMemoryEnabled()) return;
  const store = loadStore();
  const memory = store[chatJid];
  if (!memory || isExpired(memory, now)) return;

  const limit = maxTurns();
  if (memory.turns.length <= limit) return;

  const overflowCount = memory.turns.length - RAW_TURNS_TARGET;
  const oldTurns = memory.turns.slice(0, overflowCount);
  memory.turns = memory.turns.slice(overflowCount);
  try {
    const merged = await summarizer(memory.summary, oldTurns);
    memory.summary = merged.slice(0, MAX_SUMMARY_CHARS);
  } catch (e: any) {
    // Keep the turns we removed? No — they are gone from the array already;
    // put them back so nothing is lost, pruneTurns will hard-cap if needed.
    memory.turns = [...oldTurns, ...memory.turns];
    pruneTurns(memory);
    console.warn(`[AI Memory] Summarization failed (${e?.message}) — raw turns kept.`);
  }
  memory.lastTs = memory.lastTs || now;
  store[chatJid] = memory;
  saveStore(store);
}

/**
 * Production summarizer for compactIfNeeded: distills old turns into 3-6
 * compact factual bullet lines. Internal maintenance call — does NOT consume
 * the per-user daily AI quota (that quota gates user-facing requests).
 */
export async function defaultMemorySummarizer(previousSummary: string, oldTurns: MemoryTurn[]): Promise<string> {
  const transcript = oldTurns.map((t) => `${t.role === "user" ? "User" : "Nebula"}: ${t.text}`).join("\n");
  const prompt =
    `Previous summary:\n${previousSummary || "(none)"}\n\nOlder conversation turns to merge into it:\n${transcript}\n\n` +
    `Rewrite the summary as 3 to 6 short factual lines (French if the conversation is French). Keep names, decisions, preferences and open questions. No preamble.`;
  return generateTextWithFallback(prompt, "You maintain conversation summaries for a WhatsApp assistant. Output only the merged summary.");
}

/** `.ai forget` — wipes this chat's memory. Returns true when something was erased. */
export function forgetMemory(chatJid: string): boolean {
  const store = loadStore();
  if (!(chatJid in store)) return false;
  delete store[chatJid];
  saveStore(store);
  return true;
}

/** Small status line for support/diagnostics. */
export function memoryStatus(chatJid: string, now = Date.now()): string {
  if (!isMemoryEnabled()) return "disabled (TTL=0)";
  const memory = loadStore()[chatJid];
  if (!memory) return "empty";
  if (isExpired(memory, now)) return "expired (resets on next access)";
  const hoursLeft = Math.max(0, (getMemoryTtlMs() - (now - memory.lastTs)) / 3_600_000);
  return `${memory.turns.length} turns${memory.summary ? " + summary" : ""}, ${hoursLeft.toFixed(1)}h left`;
}
