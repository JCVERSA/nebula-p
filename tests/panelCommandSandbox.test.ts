import { describe, it, expect } from "vitest";
import {
  analyzePanelCommandSource,
  compilePanelCommandSource,
  executePanelCommandCode,
} from "../src/bot/panelCommandSandbox.js";

const BENIGN = `import { BotCommand } from "../types.js";

const cmd: BotCommand = {
  name: "hello",
  category: "Utility",
  description: "Says hello",
  execute: async (_sock, _msg, context) => {
    await context.reply("Hello " + context.senderName + "!");
  },
};
export default cmd;
`;

describe("Panel command sandbox (C4)", () => {
  it("accepts a benign command template", () => {
    const analysis = analyzePanelCommandSource(BENIGN);
    expect(analysis.ok).toBe(true);
  });

  it("rejects node built-in imports", () => {
    expect(analyzePanelCommandSource(`import fs from "fs"; export default {};`).ok).toBe(false);
    expect(analyzePanelCommandSource(`import { exec } from "child_process"; export default {};`).ok).toBe(false);
    expect(analyzePanelCommandSource(`import http from "node:https"; export default {};`).ok).toBe(false);
    expect(analyzePanelCommandSource(`const x = require("net"); export default {};`).ok).toBe(false);
  });

  it("rejects dangerous globals and constructs", () => {
    expect(analyzePanelCommandSource(`export default {}; console.log(process.env);`).ok).toBe(false);
    expect(analyzePanelCommandSource(`export default {}; console.log(globalThis);`).ok).toBe(false);
    expect(analyzePanelCommandSource(`export default {}; eval("1");`).ok).toBe(false);
    expect(analyzePanelCommandSource(`export default {}; new Function("return 1")();`).ok).toBe(false);
    expect(analyzePanelCommandSource(`export default {}; await fetch("https://evil");`).ok).toBe(false);
    expect(analyzePanelCommandSource(`export default {}; Buffer.from("x");`).ok).toBe(false);
  });

  it("ignores suspicious words in comments", () => {
    expect(analyzePanelCommandSource(`// uses process and fs for docs only\nexport default {};`).ok).toBe(true);
  });

  it("ignores suspicious words in string literals", () => {
    // Strings are intentionally checked (safe direction), so this stays denied.
    expect(analyzePanelCommandSource(`export default {}; const label = "process";`).ok).toBe(false);
  });

  it("compiles and executes a command that replies", async () => {
    const compiled = compilePanelCommandSource(BENIGN, "hello");
    const mod = executePanelCommandCode(compiled, "hello");
    expect(mod.name).toBe("hello");

    let replied = "";
    const fakeCtx: any = {
      senderName: "Sam",
      reply: async (text: string) => {
        replied = text;
      },
    };
    await mod.execute(null as any, {}, fakeCtx);
    expect(replied).toBe("Hello Sam!");
  });

  it("provides no process/fetch access and only a restricted require inside the sandbox", async () => {
    const src = `
      const cmd = {
        name: "probe",
        category: "Utility",
        execute: async (_s, _m, context) => {
          let probe = "";
          probe += typeof process + "|";
          probe += typeof fetch + "|";
          let requireResult = "allowed";
          try { require("fs"); requireResult = "ESCAPED"; } catch { requireResult = "blocked"; }
          await context.reply(probe + "|" + requireResult);
        },
      };
      export default cmd;
    `;
    const mod = executePanelCommandCode(compilePanelCommandSource(src, "probe"), "probe");
    let reply = "";
    await mod.execute(null as any, {}, { reply: async (t: string) => (reply = t) });
    expect(reply).toBe("undefined|undefined||blocked");
  });

  it("throws on sandbox require of forbidden modules", () => {
    const src = `
      const fs = require("fs");
      export default {};
    `;
    // Static analysis rejects the import up front.
    expect(analyzePanelCommandSource(src).ok).toBe(false);
    // And even a compiled module cannot resolve it at runtime.
    expect(() => executePanelCommandCode(compilePanelCommandSource(src, "x"), "x")).toThrow(/cannot import/);
  });

  it("throws a helpful error when execute is missing", () => {
    const src = `export default { name: "noop", category: "Utility" };`;
    expect(() => executePanelCommandCode(compilePanelCommandSource(src, "noop"), "noop")).toThrow(/execute/);
  });

  it("rejects oversized sources", () => {
    expect(analyzePanelCommandSource("x".repeat(50_001)).ok).toBe(false);
  });
});
