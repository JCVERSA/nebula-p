import { describe, it, expect, beforeAll } from "vitest";
import { buildAdapterContext } from "../src/utils/adapter.js";
import { updateConfig } from "../src/bot/config.js";

function makeMsg(sender: string, text = ".menu", fromMe = false) {
  return {
    key: { remoteJid: sender, participant: sender, fromMe },
    pushName: "Tester",
    message: { conversation: text },
  };
}

describe("Adapter ownership (H7)", () => {
  beforeAll(() => {
    updateConfig({ ownerNumber: "10000000001" });
  });

  it("does not treat arbitrary UK/French number prefixes as owner", () => {
    const ctx = buildAdapterContext({} as any, makeMsg("447700900123@s.whatsapp.net"));
    expect(ctx.isOwner).toBe(false);
    const fr = buildAdapterContext({} as any, makeMsg("33612345678@s.whatsapp.net"));
    expect(fr.isOwner).toBe(false);
  });

  it("treats the configured owner number as owner", () => {
    const ctx = buildAdapterContext({} as any, makeMsg("10000000001@s.whatsapp.net"));
    expect(ctx.isOwner).toBe(true);
  });

  it("treats self-sent messages as owner", () => {
    const ctx = buildAdapterContext({} as any, makeMsg("10000000001@s.whatsapp.net", ".menu", true));
    expect(ctx.isOwner).toBe(true);
  });

  it("uses the configured prefix", () => {
    updateConfig({ prefix: "!" });
    const ctx = buildAdapterContext({} as any, makeMsg("10000000001@s.whatsapp.net", "!menu"));
    expect(ctx.prefix).toBe("!");
    expect(ctx.commandName).toBe("menu");
    updateConfig({ prefix: "." });
  });
});
