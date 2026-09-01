import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Audit 8.14 — container OOM hardening.
 *
 * The VPS container is capped at ~954 MB (cgroup v2 memory.max = 999997440)
 * while Node sizes its V8 heap from HOST RAM (330 GB), so without an explicit
 * --max-old-space-size V8 defers major GC indefinitely and a sequential
 * 12-episode batch gets OOM-killed around episode 9. These flags in the start
 * script are load-bearing: this test fails if they are removed.
 */
describe("npm start container memory flags (audit 8.14)", () => {
  const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
  const startScript: string = pkg.scripts?.start ?? "";

  it("caps V8 old space well below the ~954 MB cgroup limit", () => {
    expect(startScript).toContain("--max-old-space-size=");
    const match = startScript.match(/--max-old-space-size=(\d+)/);
    expect(match).not.toBeNull();
    const mb = Number(match![1]);
    // 954 MB cgroup cap: heap must leave room for external buffers,
    // ffmpeg children and the runtime itself.
    expect(mb).toBeGreaterThan(0);
    expect(mb).toBeLessThanOrEqual(512);
  });

  it("exposes gc so the batch loop can collect between episodes", () => {
    expect(startScript).toContain("--expose-gc");
  });

  it("still starts the built server bundle in production mode", () => {
    expect(startScript).toContain("NODE_ENV=production");
    expect(startScript).toContain("dist/server.cjs");
  });
});
