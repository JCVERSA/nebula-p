import { describe, expect, it } from "vitest";
import { commandMatchesCategory } from "../src/utils/commandCategory.js";

/** 8.56 P3 — the predicate that used to be duplicated across five App.tsx blocks. */
describe("commandMatchesCategory", () => {
  const cmd = { category: "Novabox", parentCategory: "Anime" };

  it("matches the parent (top-level) category, case-insensitively", () => {
    expect(commandMatchesCategory(cmd, "Anime")).toBe(true);
    expect(commandMatchesCategory(cmd, "anime")).toBe(true);
  });

  it("matches the command's own category when no parent matches", () => {
    expect(commandMatchesCategory(cmd, "Novabox")).toBe(true);
  });

  it("does not match unrelated categories", () => {
    expect(commandMatchesCategory(cmd, "Media")).toBe(false);
  });

  it("falls back to category when parentCategory is absent", () => {
    expect(commandMatchesCategory({ category: "General" }, "general")).toBe(true);
  });
});
