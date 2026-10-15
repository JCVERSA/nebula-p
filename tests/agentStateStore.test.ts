/**
 * 9.18w — persistance disque de l'état volatil de l'agent (audit 9.18) :
 * les confirmations en attente (réponse « OK ») et le budget horaire
 * d'exécutions survivent aux redémarrages du bot. Fail-closed : fichier
 * corrompu → null (départ propre), échec disque → l'agent continue en RAM.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  __resetAgentStateStoreForTests,
  initAgentStatePersistence,
  loadPersistedAgentState,
  persistAgentState
} from "../src/bot/services/agentStateStore.js";
import {
  __resetAgentStateForTests,
  peekPendingConfirmation,
  setPendingConfirmation
} from "../src/bot/services/agentBrain.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-state-"));
  process.env.NEBULA_DATA_DIR = dir;
  __resetAgentStateForTests();
  __resetAgentStateStoreForTests();
});

afterEach(() => {
  __resetAgentStateForTests();
  delete process.env.NEBULA_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("9.18w — agentStateStore (JSON atomique)", () => {
  it("round-trip persist → load", () => {
    persistAgentState({
      pending: [["u", { command: "anime", args: ["naruto", "s1"], expiresAt: 123456 }]],
      execLog: [["u", [1, 2, 3]]]
    });
    const loaded = loadPersistedAgentState()!;
    expect(loaded).not.toBeNull();
    expect(loaded.pending).toEqual([["u", { command: "anime", args: ["naruto", "s1"], expiresAt: 123456 }]]);
    expect(loaded.execLog).toEqual([["u", [1, 2, 3]]]);
  });

  it("fichier absent → null", () => {
    expect(loadPersistedAgentState()).toBeNull();
  });

  it("fichier corrompu → null (départ propre, pas de crash)", () => {
    writeFileSync(join(dir, "agent_state.json"), "{pas du json");
    expect(loadPersistedAgentState()).toBeNull();
  });

  it("entrées de formes invalides ignorées au chargement", () => {
    writeFileSync(
      join(dir, "agent_state.json"),
      JSON.stringify({ v: 1, pending: [["u", { command: "x" }], "pasUnePaire"], execLog: [[42, [1]]] })
    );
    const loaded = loadPersistedAgentState()!;
    expect(loaded).not.toBeNull();
    expect(loaded.pending).toEqual([]);
    expect(loaded.execLog).toEqual([]);
  });

  it("init restaure l'état puis branche le sink (mutations écrites)", () => {
    const expiresAt = Date.now() + 60000;
    persistAgentState({ pending: [["u", { command: "song", args: ["x"], expiresAt }]], execLog: [] });
    initAgentStatePersistence();
    expect(peekPendingConfirmation("u")?.command).toBe("song");
    // le sink est branché : une nouvelle mutation atterrit sur disque
    setPendingConfirmation("v", { command: "trad", args: ["en", "hello"] });
    const onDisk = JSON.parse(readFileSync(join(dir, "agent_state.json"), "utf-8"));
    expect(onDisk.pending.some((e: unknown[]) => e[0] === "v")).toBe(true);
  });

  it("init est idempotent (double appel = un seul câblage)", () => {
    initAgentStatePersistence();
    initAgentStatePersistence();
  });
});
