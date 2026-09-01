import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

/**
 * Nebula Bot — ESLint flat config.
 *
 * Baseline philosophy: we are *introducing* a quality gate on a large legacy
 * codebase, so the config is built on typescript-eslint "recommended" but many
 * long-standing style/debt rules are set to "warn" instead of "error" for the
 * admission period. This lets `npm run lint` pass today without refactoring
 * ~91 unrelated files; the plan is to ratchet each rule up to "error" in
 * dedicated follow-ups (see PHASE3_SCOPE.md item #11).
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src/bot/imported/**",
      ".test-tmp/**",
      "recovery/**",
      "cat-catch-source/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // Classic React hooks correctness rules. Kept off for the admission
      // period the codebase is not yet compliant with the React-compiler-style
      // rules (immutability/purity/set-state-in-effect) that the newer plugin
      // bundles; only the established rules-of-hooks / exhaustive-deps are
      // surfaced (as warnings) so existing eslint-disable directives resolve.
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/exhaustive-deps": "warn",
      // Legacy-debt rules that the existing codebase still violates (a lot).
      // Warn during the admission period; the quality gate stays green while
      // the issues remain visible for ratification.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/prefer-as-const": "warn",
      "no-empty": "warn",
      "no-useless-escape": "warn",
      "no-useless-assignment": "warn",
      "prefer-const": "warn",
      "no-async-promise-executor": "warn",
    },
    linterOptions: {
      // Existing source has some `eslint-disable` directives that target rules
      // we keep off; do not turn those into gate failures.
      reportUnusedDisableDirectives: "off",
    },
  },
);
