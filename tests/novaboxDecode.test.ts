import { describe, it, expect } from "vitest";
import { decodeJsStringLiteral, decodeJsArrayLiteral } from "../src/bot/commands/novabox.js";

describe("novabox eval-free decoders", () => {
  it("decodes simple escaped string literals", () => {
    expect(decodeJsStringLiteral("'sources:[{file:\"https://x/y.m3u8\"}]'")).toBe('sources:[{file:"https://x/y.m3u8"}]');
    expect(decodeJsStringLiteral('"it\\x27s"')).toBe("it's");
    expect(decodeJsStringLiteral("'\\x68\\x74\\x74\\x70'")).toBe("http");
    expect(decodeJsStringLiteral("'\\u0068i'")).toBe("hi");
    expect(decodeJsStringLiteral("'a\\nb'")).toBe("a\nb");
    expect(decodeJsStringLiteral("'c:\\\\d'")).toBe("c:\\d");
  });

  it("parses flat array literals used by packed scripts", () => {
    expect(decodeJsArrayLiteral("['a','b','c']")).toEqual(["a", "b", "c"]);
    expect(decodeJsArrayLiteral("['\\x61','b c']")).toEqual(["a", "b c"]);
    expect(decodeJsArrayLiteral("[1,2]")).toEqual(["1", "2"]);
    expect(decodeJsArrayLiteral("[]")).toEqual([]);
    expect(decodeJsArrayLiteral("not an array")).toEqual([]);
  });

  it("unpacks a representative packed payload without executing it", async () => {
    // Classic Dean Edwards payload shape: p holds escaped source, k holds words.
    const p = "'file:\"https\\x3a\\x2f\\x2fcdn.example\\x2fvideo.m3u8\"'";
    expect(decodeJsStringLiteral(p)).toContain("file:");
  });
});
