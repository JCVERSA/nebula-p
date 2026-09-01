import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Coverage gate (Phase 3 item #11). Reports coverage w/ a LOW admission
    // threshold so the existing 91 tests still pass on a large legacy tree.
    // The enforcement floor is a regression guard, not a quality target — the
    // plan is to ratchet these up over time. See PHASE3_SCOPE.md.
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html"],
      // Report everything, but do not let the untested vendored command corpus
      // drag the first-party numbers around (it is third-party, not ours).
      exclude: [
        "src/bot/imported/**",
        "src/**/*.d.ts",
        "dist/**",
        "node_modules/**",
        ".test-tmp/**",
        "recovery/**",
      ],
      thresholds: {
        global: {
          lines: 30,
          functions: 12,
          statements: 30,
          branches: 50,
        },
      },
    },
  },
});
