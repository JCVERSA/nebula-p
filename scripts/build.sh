#!/usr/bin/env bash
# 9.18oo — build conditionnel (retour terrain 16/10 : « le build prend trop
# de temps » — 9+ min d'écran figé pour un sync de 2 fichiers).
#
# Le build complet = panel React (vite — la partie lourde : rollup + minify,
# plusieurs minutes sur un VPS 1 cœur/1 Go) + 3 bundles esbuild (secondes).
# Or la quasi-totalité des mises à jour ne touchent QUE le code serveur
# (src/bot/**) : le panel rebuildé était BIT-POUR-BIT identique.
#
# Ce script saute le panel quand l'empreinte de ses sources est inchangée
# depuis le dernier build réussi (dist/.nebula-panel-hash) :
#   - update bot-only → ~20 s (3 esbuild) au lieu de 9+ min ;
#   - panel touché OU premier build OU hash absent → panel reconstruit ;
#   - échappatoire : NEBULA_FORCE_PANEL_BUILD=1 force toujours le panel.
#
# Sources panel suivies : entrée client (index.html, main.tsx, App.tsx,
# index.css), configs (vite.config.ts, package*.json — versions des
# dépendances), et tout ce que le client peut importer (components, lib,
# utils, types, panel, public). src/bot est EXCLU : le client ne l'importe
# jamais (vérifié — adapter.ts, seul importateur, n'est pas dans le graphe
# client) et il vit dans les bundles esbuild, toujours reconstruits.
#
# Sortie en direct, étape par étape : plus jamais de silence « tail -30 »
# qui faisait croire à un gel.
set -euo pipefail
cd "$(dirname "$0")/.."

HASH_FILE="dist/.nebula-panel-hash"

panel_inputs_hash() {
  {
    cat index.html vite.config.ts package.json package-lock.json \
        src/main.tsx src/App.tsx src/index.css 2>/dev/null || true
    find src/components src/lib src/utils src/types src/panel public \
        -type f -print0 2>/dev/null | LC_ALL=C sort -z | xargs -0 -r cat 2>/dev/null || true
  } | sha256sum | cut -d' ' -f1
}

current_hash="$(panel_inputs_hash)"
if [ "${NEBULA_FORCE_PANEL_BUILD:-0}" != "1" ] \
   && [ -f "${HASH_FILE}" ] \
   && [ "$(cat "${HASH_FILE}" 2>/dev/null)" = "${current_hash}" ] \
   && [ -f dist/index.html ] \
   && [ -d dist/assets ] \
   && [ -n "$(ls -A dist/assets 2>/dev/null || true)" ]; then
  echo "[build] Panel (vite) : sources inchangées — sauté."
else
  echo "[build] Panel (vite) : construction… (c'est l'étape longue : 1-6 min sur un petit VPS, ça travaille)"
  ./node_modules/.bin/vite build
  mkdir -p dist
  printf '%s\n' "${current_hash}" > "${HASH_FILE}"
fi

echo "[build] Serveur (esbuild) : dist/server.cjs…"
./node_modules/.bin/esbuild server.ts --bundle --platform=node --format=cjs \
  --packages=external --sourcemap --outfile=dist/server.cjs

echo "[build] Moteur (esbuild) : dist/engine.cjs…"
./node_modules/.bin/esbuild engine.ts --bundle --platform=node --format=cjs \
  --packages=external --sourcemap --outfile=dist/engine.cjs

echo "[build] Outil replay (esbuild) : dist/agent-replay.cjs…"
./node_modules/.bin/esbuild scripts/agent-replay.ts --bundle --platform=node --format=cjs \
  --packages=external --sourcemap --outfile=dist/agent-replay.cjs

echo "[build] ✔ terminé."
