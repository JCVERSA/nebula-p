import { execSync } from "child_process";
import { createRequire } from "module";

/**
 * Shared ffmpeg resolution (audit 8.29, 2026-09-01).
 *
 * The ffmpeg-static npm dependency was REMOVED: its postinstall downloads a
 * ~70 MB binary from GitHub releases on every fresh install — the dominant
 * cause of 20-30 min `nebula update` runs on slow GitHub routes — while the
 * system binary (installed by scripts/install.sh via apt) was always
 * preferred anyway. Resolution order:
 *   1. FFMPEG_BIN env (explicit operator override)
 *   2. system ffmpeg on the PATH ("ffmpeg")
 *   3. best-effort require("ffmpeg-static") for dev boxes that still have it
 *   4. plain "ffmpeg" (fails loudly at spawn time if truly absent)
 */

// Works in both ESM (vitest/tsx) and the CJS production bundle — same pattern
// as importedBridge.ts.
const require = createRequire(
  typeof __filename !== "undefined" ? __filename : import.meta.url
);

function resolveFfmpegPath(): string {
  const override = process.env.FFMPEG_BIN;
  if (override && override.trim()) return override.trim();
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return "ffmpeg";
  } catch {
    // no system ffmpeg — try a locally installed ffmpeg-static (dev only)
    try {
      const p = require("ffmpeg-static") as string | null;
      if (p) return p;
    } catch {
      // not installed (expected in production since audit 8.29)
    }
  }
  return "ffmpeg";
}

export const resolvedFfmpegPath: string = resolveFfmpegPath();
