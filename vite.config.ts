import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig(() => {
  return {
    test: {
      // 9.13c : le test UI « navigates through every tab » prend 3-4 s en
      // local ; sur un runner chargé il frôlait le timeout vitest PAR DÉFAUT
      // (5 s) — deux flocons CI observés (runs push 2edc626 / 6a37243 rouges
      // alors que le run PR du MÊME commit était vert). Marge honnête : les
      // assertions restent identiques, seuls les tests lents gagnent de la
      // place — un vrai hang échoue toujours (20 s).
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== "true",
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === "true" ? null : {},
      // Allow the app to be served from arbitrary hosts (AI Studio / sandbox preview
      // domains, custom Cloud Run domains). Dev middleware only; production serves
      // static files via Express and is unaffected.
      allowedHosts: true as const,
    },
  };
});
