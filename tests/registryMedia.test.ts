import { describe, expect, it } from "vitest";
import { initRegistry, getCommand } from "../src/bot/commandRegistry.js";

/**
 * Regression guard (audit 8.49 fix, 2026-09-02): a command that only exists
 * as a source file is NOT registered in production — the static built-in
 * list (defaultCommands) is what the bundled server registers. `.m` was
 * shipped once without being in that list: the VPS logged
 * `[Registry] Skipped unloadable command file: media.ts` and `.m` stayed
 * unknown. This test pins BOTH the registration and the alias.
 */
describe("media command registration (8.49 fix)", () => {
  it("is registered as a built-in with its .m alias", async () => {
    await initRegistry();
    const cmd = getCommand("media");
    expect(cmd).toBeTruthy();
    expect(cmd!.name).toBe("media");
    expect(cmd!.aliases).toContain("m");
    expect(getCommand("m")).toBeTruthy();
  });
});
