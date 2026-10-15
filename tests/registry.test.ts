import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { BotCommand } from "../src/bot/types.js";

let commandsDir: string;

beforeAll(async () => {
  commandsDir = process.env.NEBULA_COMMANDS_DIR!;

  // Write a self-contained command file to disk that is not a built-in
  const code = `const diskCmd = {
  name: "diskcmd",
  category: "Test",
  description: "Loaded from disk",
  usage: "diskcmd",
  execute: async (_sock, _msg, context) => {
    await context.reply("Disk command executed!");
  }
};

export default diskCmd;
`;
  fs.mkdirSync(commandsDir, { recursive: true });
  fs.writeFileSync(path.join(commandsDir, "diskcmd.ts"), code, "utf-8");
});

afterAll(() => {
  try {
    fs.rmSync(commandsDir, { recursive: true, force: true });
  } catch {}
});

describe("Command registry (disk loading)", () => {
  it("loads commands from disk and registers them", async () => {
    const { initRegistry, getCommand } = await import("../src/bot/commandRegistry.js");
    await initRegistry();

    const diskCmd = getCommand("diskcmd");
    expect(diskCmd).toBeDefined();
    expect(diskCmd!.name).toBe("diskcmd");
  });

  it("never returns duplicate entries for aliased commands", async () => {
    const { getCommands } = await import("../src/bot/commandRegistry.js");
    const commands = getCommands();
    const names = commands.map((c: BotCommand) => c.name);
    expect(new Set(names).size).toBe(names.length);
    // help is aliased (h, info) but must appear exactly once
    expect(names.filter((n) => n === "help").length).toBe(1);
  });
});

describe("9.18hh — registry : skip de commande ACTIONNABLE (retour terrain tts.ts)", () => {
  it("le message dit la cause et le remède npm install (source-lock)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/bot/commandRegistry.ts"), "utf-8");
    expect(src).toContain("Commande non chargée");
    expect(src).toContain("Dépendance manquante");
    expect(src).toContain("Mettre à jour");
    expect(src).toContain("npm install");
    expect(src).toContain("Cannot find module");
  });
});
