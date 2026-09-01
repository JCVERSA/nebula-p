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
