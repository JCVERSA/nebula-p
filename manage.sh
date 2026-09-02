#!/usr/bin/env bash
# ============================================================================
#  NEBULA BOT — Script de gestion VPS
#  Dépôt   : https://github.com/JCVERSA/nebula-p (branche main)
#  Usage   : ./manage.sh <commande>   (voir: ./manage.sh help)
#
#  Commandes : start | stop | restart | status | update | setup | clone
#              env [list|set|get|unset|edit] | logs [filtre] | clean
#              doctor | version
# ============================================================================
set -uo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
REPO_URL="https://github.com/JCVERSA/nebula-p"
BRANCH="main"
# Resolve the real script location THROUGH symlinks: the installer exposes
# manage.sh as the `nebula` command (/usr/local/bin/nebula), so dirname of
# BASH_SOURCE alone would point at the symlink's directory, not the repo.
NEBULA_SRC="${BASH_SOURCE[0]}"
while [ -L "${NEBULA_SRC}" ]; do
  NEBULA_DIR="$(cd "$(dirname "${NEBULA_SRC}")" && pwd)"
  NEBULA_SRC="$(readlink "${NEBULA_SRC}")"
  case "${NEBULA_SRC}" in /*) ;; *) NEBULA_SRC="${NEBULA_DIR}/${NEBULA_SRC}" ;; esac
done
APP_DIR="$(cd "$(dirname "${NEBULA_SRC}")" && pwd)"   # le script vit dans le dépôt
ENV_FILE="${APP_DIR}/.env"
LOG_FILE="${LOG_FILE:-/root/bot.log}"
TUNNEL_LOG="${TUNNEL_LOG:-/root/tunnel.log}"
PORT="${PORT:-3000}"
NODE_PATTERN="dist/server[.]cjs"
AGE_STAGING_MIN=60      # débris cat_catch_*/batch_zip_* plus vieux que ça → purge
AGE_TEMP_H=3            # fichiers nebula_temp_downloads plus vieux que ça → purge

# ---------------------------------------------------------------------------
# Couleurs (désactivées hors TTY, ex: cron)
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  C_GREEN=$'\033[1;32m'; C_RED=$'\033[1;31m'; C_YELLOW=$'\033[1;33m'
  C_CYAN=$'\033[1;36m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
else
  C_GREEN=""; C_RED=""; C_YELLOW=""; C_CYAN=""; C_BOLD=""; C_DIM=""; C_RESET=""
fi
ok()   { echo "${C_GREEN}✔${C_RESET} $*"; }
ko()   { echo "${C_RED}✘${C_RESET} $*"; }
warn() { echo "${C_YELLOW}⚠${C_RESET} $*"; }
info() { echo "${C_CYAN}ℹ${C_RESET} $*"; }
hdr()  { echo; echo "${C_BOLD}${C_CYAN}═══ $* ═══${C_RESET}"; }
die()  { ko "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
bot_pids() { pgrep -f "${NODE_PATTERN}" 2>/dev/null || true; }

is_running() { [ -n "$(bot_pids)" ]; }

# --- Verrou de mise à jour (audit 8.30) -------------------------------------
# Un watchdog cron (*/5 * * * * manage.sh start, voir docs/MIGRATION_NOUVEAU_VPS.md)
# ne doit PAS relancer le bot pendant `nebula update` (install/build) : cela
# réintroduirait la contention mémoire que l'update est justement censé éviter.
UPDATE_LOCK_DIR="${TMPDIR:-/tmp}/nebula-update.lock"
UPDATE_LOCK_STALE_MIN=15    # au-delà: verrou considéré comme débris (update planté)

update_lock_held() {        # 0 = un update FRAIS est en cours
  [ -d "${UPDATE_LOCK_DIR}" ] || return 1
  local age=$(( ( $(date +%s) - $(stat -c %Y "${UPDATE_LOCK_DIR}" 2>/dev/null || echo 0) ) / 60 ))
  if [ "${age}" -ge "${UPDATE_LOCK_STALE_MIN}" ]; then
    warn "Verrou d'update >${UPDATE_LOCK_STALE_MIN} min (update interrompu ?) — nettoyé."
    rm -rf "${UPDATE_LOCK_DIR}"
    return 1
  fi
  return 0
}

update_lock_acquire() {
  if update_lock_held; then
    die "Une mise à jour est déjà en cours (PID $(cat "${UPDATE_LOCK_DIR}/pid" 2>/dev/null || echo '?')) — réessaie dans quelques minutes."
  fi
  mkdir -p "${UPDATE_LOCK_DIR}" 2>/dev/null || die "Impossible de créer le verrou (${UPDATE_LOCK_DIR})."
  echo "$$" > "${UPDATE_LOCK_DIR}/pid"
  date -Is > "${UPDATE_LOCK_DIR}/since"
}

update_lock_release() { rm -rf "${UPDATE_LOCK_DIR}" 2>/dev/null || true; }

# Valeur par défaut documentée dans .env.example (pour l'affichage du menu env)
env_example_default() {
  grep -E "^${1}=" "${APP_DIR}/.env.example" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/^"//; s/"$//'
}

require_repo() {
  [ -d "${APP_DIR}/.git" ] || die "Ce script doit vivre dans le dépôt git (${APP_DIR}). Utilise: ./manage.sh clone"
  command -v git >/dev/null 2>&1 || die "git est introuvable (apt install git)"
}

env_value() { # $1 = clé → valeur brute ou vide
  [ -f "${ENV_FILE}" ] || return 0
  grep -E "^${1}=" "${ENV_FILE}" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/^"//; s/"$//'
}

env_masked() { # $1 = clé → valeur masquée si secrète
  local v; v="$(env_value "$1")"
  [ -z "${v}" ] && echo "${C_DIM}(non défini)${C_RESET}" && return 0
  case "$1" in
    *TOKEN*|*KEY*|*SECRET*|*PASSWORD*)
      if [ "${#v}" -le 6 ]; then echo "***"
      else echo "${v:0:3}…${v: -2} (${#v} car.)"; fi
      ;;
    *) echo "${v}" ;;
  esac
}

public_url() { env_value APP_URL | sed 's:/*$::'; }

cgroup_max_mb() {
  local v=""
  if [ -r /sys/fs/cgroup/memory.max ]; then
    v="$(cat /sys/fs/cgroup/memory.max)"
    [ "${v}" = "max" ] && v=""
  elif [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
    v="$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)"
  fi
  [ -n "${v}" ] && echo $(( v / 1048576 )) || echo ""
}

http_code() { # $1 = URL, timeout 5s → code HTTP ou "000"
  local c
  c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$1" 2>/dev/null)"
  echo "${c:-000}"
}

wait_http() { # $1 = URL, $2 = timeout s → 0 si répondu
  local deadline=$(( $(date +%s) + $2 ))
  while [ "$(date +%s)" -lt "${deadline}" ]; do
    [ "$(http_code "$1")" != "000" ] && return 0
    sleep 2
  done
  return 1
}

# ---------------------------------------------------------------------------
# START / STOP / RESTART
# ---------------------------------------------------------------------------
cmd_start() {
  require_repo
  # Ne pas relancer le bot pendant une mise à jour (verrou posé par cmd_update).
  # Exit 0 pour que le watchdog cron reste silencieux. Le flag interne
  # UPDATE_IN_PROGRESS autorise les redémarrages de récupération de cmd_update.
  if [ "${UPDATE_IN_PROGRESS:-0}" != "1" ] && update_lock_held; then
    warn "Mise à jour en cours — démarrage différé (le bot redémarrera à la fin de l'update)."
    exit 0
  fi
  if is_running; then
    warn "Le bot tourne déjà (PID: $(bot_pids | tr '\n' ' ')). Utilise ./manage.sh restart."
    exit 0
  fi
  [ -f "${APP_DIR}/dist/server.cjs" ] || die "dist/server.cjs absent — lance d'abord ./manage.sh update (ou setup)"
  command -v npm >/dev/null 2>&1 || die "npm est introuvable"
  [ -f "${ENV_FILE}" ] || warn "Aucun .env trouvé — ./manage.sh env pour le configurer"

  hdr "Démarrage du bot"
  ( cd "${APP_DIR}" && nohup npm start >"${LOG_FILE}" 2>&1 & )
  info "Process lancé, log: ${LOG_FILE}"

  info "Attente du panneau sur le port ${PORT} (45 s max)…"
  if wait_http "http://127.0.0.1:${PORT}/" 45; then
    ok "Bot en ligne (HTTP $(http_code "http://127.0.0.1:${PORT}/")). PID: $(bot_pids | tr '\n' ' ')"
  else
    ko "Le panneau ne répond pas après 45 s. Dernières lignes du log :"
    tail -n 30 "${LOG_FILE}" 2>/dev/null | sed 's/^/    /'
    warn "Inspecte avec: ./manage.sh logs"
    exit 1
  fi
}

cmd_stop() {
  hdr "Arrêt du bot"
  local pids; pids="$(bot_pids)"
  if [ -z "${pids}" ]; then
    info "Le bot n'était pas en cours d'exécution."
    return 0
  fi
  info "PID(s): $(echo "${pids}" | tr '\n' ' ') — SIGTERM…"
  kill ${pids} 2>/dev/null || true
  local deadline=$(( $(date +%s) + 10 ))
  while [ -n "$(bot_pids)" ] && [ "$(date +%s)" -lt "${deadline}" ]; do sleep 1; done
  pids="$(bot_pids)"
  if [ -n "${pids}" ]; then
    warn "Ne s'est pas arrêté en 10 s — SIGKILL."
    kill -9 ${pids} 2>/dev/null || true
    sleep 1
  fi
  if [ -n "$(bot_pids)" ]; then ko "Échec de l'arrêt (PID: $(bot_pids | tr '\n' ' '))"; exit 1; fi
  ok "Bot arrêté proprement."
}

cmd_restart() { cmd_stop; cmd_start; }

# ---------------------------------------------------------------------------
# STATUS
# ---------------------------------------------------------------------------
cmd_status() {
  require_repo
  hdr "STATUT — $(date '+%d/%m/%Y %H:%M:%S')"

  # Code
  local rev="" branch=""
  branch="$(git -C "${APP_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  rev="$(git -C "${APP_DIR}" log -1 --format='%h %ad %s' --date=format:'%d/%m %H:%M' 2>/dev/null || echo '?')"
  echo " ${C_BOLD}Dépôt${C_RESET}  : ${APP_DIR}"
  echo " ${C_BOLD}Branche${C_RESET}: ${branch}   ${C_BOLD}Révision${C_RESET}: ${rev}"
  local dirty; dirty="$(git -C "${APP_DIR}" status --porcelain 2>/dev/null | wc -l)"
  [ "${dirty}" -gt 0 ] && warn "${dirty} fichier(s) local(aux) modifié(s) — ./manage.sh update fera un pull --ff-only" \
                        || ok "Arborescence git propre"

  # Process
  echo
  local pids; pids="$(bot_pids)"
  if [ -n "${pids}" ]; then
    for pid in ${pids}; do
      local rss kb etime cmd
      read -r rss etime <<<"$(ps -o rss=,etime= -p "${pid}" 2>/dev/null || echo '0 ?')"
      rss=$((rss / 1024)); kb="$(cgroup_max_mb)"
      local mem_note=""
      [ -n "${kb}" ] && mem_note=" / ${kb} Mo cgroup ($(( rss * 100 / kb )) %)"
      ok "Process ${pid} — RSS ${rss} Mo${mem_note} — uptime ${etime}"
    done
  else
    ko "Bot ARRÊTÉ (aucun process node sur ${NODE_PATTERN})"
  fi

  # Réseau
  echo
  local code
  code="$(http_code "http://127.0.0.1:${PORT}/")"
  [ "${code}" != "000" ] && ok "Panneau local  :${PORT} → HTTP ${code}" || ko "Panneau local  :${PORT} → aucun réponse"
  local pub; pub="$(public_url)"
  if [ -n "${pub}" ]; then
    code="$(http_code "${pub}/")"
    [ "${code}" != "000" ] && ok "URL publique   : ${pub} → HTTP ${code}" || warn "URL publique   : ${pub} → injoignable (tunnel lancé ?)"
  else
    warn "URL publique   : APP_URL non défini dans .env"
  fi

  # Stockage
  echo
  local tmp="${TMPDIR:-/tmp}"
  du -sh "${tmp}/nebula_temp_downloads" 2>/dev/null | awk '{print " 📦 Téléch. temporaires : " $1 " (" $2 ")"}' || info "📦 Téléch. temporaires : vide"
  local n_staging; n_staging="$(find "${tmp}" -maxdepth 1 -name 'cat_catch_*' -o -maxdepth 1 -name 'batch_zip_*' 2>/dev/null | wc -l)"
  [ "${n_staging}" -gt 0 ] && warn "🧹 ${n_staging} dossier(s) de staging orphelin(s) — ./manage.sh clean" \
                           || ok "Aucun débris de staging"
  command -v df >/dev/null && echo " 💾 Disque : $(df -h / | awk 'NR==2{print $4 " libres sur " $2}')"

  # Logs
  echo
  [ -f "${LOG_FILE}" ] && echo " ${C_BOLD}Log${C_RESET}: ${LOG_FILE} ($(du -h "${LOG_FILE}" | cut -f1)) — ./manage.sh logs" \
                       || info "Log absent (${LOG_FILE})"
  [ -f "${TUNNEL_LOG}" ] && echo " ${C_BOLD}Log tunnel${C_RESET}: ${TUNNEL_LOG}"
  echo
}

# ---------------------------------------------------------------------------
# UPDATE / SETUP / CLONE
# ---------------------------------------------------------------------------
cmd_update() {
  require_repo
  update_lock_acquire
  trap update_lock_release EXIT   # libéré même en cas de die()
  UPDATE_IN_PROGRESS=1            # autorise cmd_start/cmd_restart internes
  hdr "Mise à jour du dépôt"
  local was_running="no"; is_running && was_running="yes"
  local old_rev; old_rev="$(git -C "${APP_DIR}" rev-parse --short HEAD 2>/dev/null || echo '?')"

  git -C "${APP_DIR}" config pull.ff only   # supprime le hint de divergence
  info "git pull --ff-only origin ${BRANCH}…"
  if ! ( cd "${APP_DIR}" && git pull --ff-only origin "${BRANCH}" 2>&1 | sed 's/^/    /' ); then
    die "Pull refusé (commits locaux ou divergence) — résous avec git status/git stash puis relance."
  fi
  local new_rev; new_rev="$(git -C "${APP_DIR}" rev-parse --short HEAD)"
  if [ "${old_rev}" = "${new_rev}" ]; then
    ok "Déjà à jour (${new_rev})."
    [ "${was_running}" = "yes" ] && info "Le bot tourne — pas de redémarrage nécessaire."
    return 0
  fi
  ok "Code: ${old_rev} → ${new_rev}"
  ( cd "${APP_DIR}" && git log --oneline "${old_rev}..${new_rev}" 2>/dev/null | sed 's/^/    /' )

  # Sur un conteneur ~1 Go, npm/vite en parallèle du bot vivant saturent la
  # mémoire du cgroup → throttling → updates de 20-30 min (audit 8.29).
  # On arrête le bot le temps d'installer/construire (~1 min) puis on le
  # relance ; en cas d'échec, l'ancien build est relancé s'il existe encore.
  update_fail() {
    if [ "${was_running}" = "yes" ] && [ -f "${APP_DIR}/dist/server.cjs" ]; then
      warn "Échec de l'étape — relance de l'ancien build…"
      cmd_start >/dev/null 2>&1 || true
    fi
    die "$1"
  }
  if [ "${was_running}" = "yes" ]; then
    info "Arrêt du bot pendant l'installation (redémarrage automatique ensuite)…"
    cmd_stop || true
  fi

  hdr "Dépendances"
  if ( cd "${APP_DIR}" && git diff --name-only "${old_rev}" "${new_rev}" -- package.json package-lock.json | grep -q . ); then
    info "package*.json modifié → npm install…"
    ( cd "${APP_DIR}" && npm install --no-audit --no-fund --prefer-offline 2>&1 | tail -n 2 | sed 's/^/    /' ) || update_fail "npm install a échoué"
  else
    ok "Aucune dépendance modifiée — npm install sauté."
  fi

  hdr "Build"
  ( cd "${APP_DIR}" && npm run build 2>&1 | tail -n 6 | sed 's/^/    /' ) || update_fail "Build échoué"

  hdr "Redémarrage"
  if [ "${was_running}" = "yes" ]; then
    cmd_restart
  else
    info "Le bot était arrêté — relance avec: ./manage.sh start"
  fi
}

cmd_setup() {
  require_repo
  command -v npm >/dev/null 2>&1 || die "npm introuvable — installe Node.js ≥ 18 (https://nodejs.org)"
  hdr "Installation des dépendances"
  # ffmpeg système requis (remux HLS). L'ancienne dépendance npm ffmpeg-static
  # téléchargeait ~70 Mo depuis GitHub à chaque install fraîche (source
  # d'updates de 20-30 min) alors que le binaire système a toujours été
  # préféré — elle a été retirée (audit 8.29).
  command -v ffmpeg >/dev/null 2>&1 || warn "ffmpeg introuvable — apt install ffmpeg (sinon les téléchargements échoueront au remux)"
  ( cd "${APP_DIR}" && npm install --no-audit --no-fund --prefer-offline 2>&1 | tail -n 2 | sed 's/^/    /' ) || die "npm install a échoué"
  hdr "Fichier .env"
  if [ ! -f "${ENV_FILE}" ]; then
    cp "${APP_DIR}/.env.example" "${ENV_FILE}" 2>/dev/null || true
    warn ".env créé depuis l'exemple — configure-le : ./manage.sh env"
  else
    ok ".env déjà présent (clés: $(grep -cE '^[A-Z]' "${ENV_FILE}" 2>/dev/null || echo 0))"
  fi
  hdr "Build"
  ( cd "${APP_DIR}" && npm run build 2>&1 | tail -n 4 | sed 's/^/    /' ) || die "Build échoué"
  ok "Installation terminée — démarre avec: ./manage.sh start"
}

cmd_clone() {
  local dir="${1:-/root/p}"
  [ -e "${dir}" ] && [ -n "$(ls -A "${dir}" 2>/dev/null)" ] && die "Le dossier ${dir} existe déjà et n'est pas vide."
  hdr "Clonage de ${REPO_URL} (branche ${BRANCH}) → ${dir}"
  mkdir -p "${dir}"
  git clone -b "${BRANCH}" "${REPO_URL}" "${dir}" || die "Clonage échoué"
  ok "Dépôt cloné."
  ( cd "${dir}" && git config pull.ff only )
  exec bash "${dir}/manage.sh" setup
}

# ---------------------------------------------------------------------------
# ENV
# ---------------------------------------------------------------------------
ENV_KEYS=(
  "APP_URL|URL publique du panneau (ex: https://bot.exemple.com) — obligatoire pour les liens + validation Host"
  "PANEL_TOKEN|Clé d'accès au panneau (si vide: générée au démarrage et affichée une fois en console)"
  "GEMINI_API_KEY|Clé Gemini pour l'IA (texte/image/transcription)"
  "NVIDIA_NIM_API_KEY|Clé NVIDIA NIM (nvapi-…) — IA de secours si Gemini absent/épuisé (gratuite sur build.nvidia.com)"
  "NEBULA_NIM_MODEL|Modèle NIM (défaut meta/llama-3.3-70b-instruct)"
  "NEBULA_AI_PERSONALITY|Remplace TOUTE la personnalité IA (system prompt) — vide = persona Nebula intégrée"
  "NEBULA_AI_MEMORY_TTL_HOURS|Durée de vie (heures) de la mémoire IA par discussion — glissante, 0 = désactivée (défaut 10)"
  "NEBULA_VOSTFR_FALLBACK|Roue de secours inter-sources : réessaie un épisode sur le catalogue secondaire quand tous les miroirs échouent — 0 = désactivée (défaut activée)"
  "NEBULA_AI_MEMORY_MAX_TURNS|Tours bruts gardés avant compaction en résumé (défaut 20)"
  "OWNER_NUMBER|Numéro WhatsApp propriétaire (indicatif pays + numéro, sans + ni espaces)"
  "PORT|Port du panneau (défaut 3000)"
  "NEBULA_VF_DEFAULT|Mettre 0 pour désactiver la VF par défaut (défaut: VF d'abord)"
  "NEBULA_VOIRANIME_DISABLED|Mettre 1 pour couper la source voir-anime.to"
  "NEBULA_BATCH_CONCURRENCY|Épisodes téléchargés en parallèle (défaut 1 — séquentiel, recommandé: RAM)"
  "NEBULA_BATCH_ZIP|Mettre 1 pour réactiver l'archive ZIP de saison (défaut: liens par épisode)"
  "NEBULA_NOVABOX_MAX_EPISODES|Nb max d'épisodes par batch (défaut 12)"
  "NEBULA_NOVABOX_MAX_BATCH_MB|Plafond Mo par batch (défaut 2048)"
  "NEBULA_TEMP_MAX_BYTES|Plafond du stockage temporaire en octets (défaut 4 GiB)"
  "NEBULA_FRANIME_ENABLED|Mettre 1 pour activer franime (parké, nécessite FlareSolverr)"
  "FLARESOLVERR_URL|URL FlareSolverr (franime)"
  "NEBULA_AI_DAILY_LIMIT|Budget IA/jour/utilisateur (défaut 40)"
  "NEBULA_AI_MAX_CONCURRENT|Requêtes IA simultanées max (défaut 3)"
  "NEBULA_ENABLE_LEGACY|Mettre 1 pour réactiver le corpus legacy de 145 commandes tierces (quarantaine par défaut)",
  "NEBULA_DOWNLOAD_TIMEOUT_MS|Délai max global par téléchargement d'épisode en ms (défaut 600000 = 10 min)",
  "NEBULA_WATCH_CRON|Planification cron de la veille épisodes (défaut toutes les 6 h)",
  "NEBULA_WATCH_QUIET|Heures silencieuses de la veille, format H-H (défaut 23-7, off = désactivé)",
  "NEBULA_WATCH_TZ|Fuseau horaire de la veille (défaut Africa/Douala)",
  "DEBUG_MEDIA|Mettre true pour logs média verbeux"
)

env_upsert() { # $1 clé, $2 valeur
  local k="$1" v="$2"
  [ -z "${k}" ] && die "Clé vide"
  case "${k}" in
    NODE_ENV) die "NODE_ENV ne doit PAS être dans .env (npm start le définit déjà = production).";;
    *[!A-Z0-9_]*) die "Clé invalide: ${k} (A-Z, 0-9, _ uniquement)";;
  esac
  # s'assurer que le fichier finit par un retour ligne avant l'ajout
  [ -f "${ENV_FILE}" ] && [ -s "${ENV_FILE}" ] && [ -n "$(tail -c1 "${ENV_FILE}")" ] && echo >> "${ENV_FILE}"
  local tmp="${ENV_FILE}.tmp"
  { grep -vE "^${k}=" "${ENV_FILE}" 2>/dev/null; echo "${k}=\"${v}\""; } > "${tmp}" && mv "${tmp}" "${ENV_FILE}"
  ok "${k} enregistré."
}

cmd_env() {
  local sub="${1:-menu}"
  case "${sub}" in
    list)
      hdr "Contenu du .env"
      [ -f "${ENV_FILE}" ] || { warn "Aucun .env — ./manage.sh env set CLE valeur"; return 0; }
      for line in "${ENV_KEYS[@]}"; do
        local k desc; k="${line%%|*}"; desc="${line#*|}"
        printf " ${C_BOLD}%-28s${C_RESET} = %s\n    ${C_DIM}%s${C_RESET}\n" "${k}" "$(env_masked "${k}")" "${desc}"
      done
      # clés inconnues présentes dans le fichier
      while IFS='=' read -r k v; do
        case "${k}" in ""|\#*) continue;; esac
        local known=0
        for line in "${ENV_KEYS[@]}"; do [ "${line%%|*}" = "${k}" ] && known=1; done
        [ "${known}" = "0" ] && printf " ${C_BOLD}%-28s${C_RESET} = %s ${C_DIM}(clé avancée)${C_RESET}\n" "${k}" "$(env_masked "${k}")"
      done < <(grep -E '^[A-Z]' "${ENV_FILE}" 2>/dev/null)
      ;;
    set)
      [ $# -ge 3 ] || die "Usage: ./manage.sh env set CLE valeur"
      env_upsert "$2" "${*:3}"
      ;;
    get)
      [ $# -ge 2 ] || die "Usage: ./manage.sh env get CLE"
      env_value "$2"
      ;;
    unset)
      [ $# -ge 2 ] || die "Usage: ./manage.sh env unset CLE"
      local tmp="${ENV_FILE}.tmp"
      grep -vE "^$2=" "${ENV_FILE}" 2>/dev/null > "${tmp}" && mv "${tmp}" "${ENV_FILE}"
      ok "$2 supprimée du .env"
      ;;
    edit)
      [ -f "${ENV_FILE}" ] || cp "${APP_DIR}/.env.example" "${ENV_FILE}" 2>/dev/null || true
      "${EDITOR:-nano}" "${ENV_FILE}"
      ;;
    menu|*)
      hdr "Configuration du .env"
      [ -f "${ENV_FILE}" ] || { cp "${APP_DIR}/.env.example" "${ENV_FILE}" 2>/dev/null || warn "Aucun .env.example — un .env vide sera créé."; }
      while true; do
        echo
        local i=1
        for line in "${ENV_KEYS[@]}"; do
          local k desc dflt; k="${line%%|*}"; desc="${line#*|}"
          if [ -z "$(env_value "${k}")" ] && [ -n "$(env_example_default "${k}")" ]; then
            dflt="$(env_example_default "${k}")"
            printf " ${C_BOLD}%2d)${C_RESET} %-28s ${C_DIM}(défaut: %s)${C_RESET}\n" "${i}" "${k}" "${dflt}"
          else
            printf " ${C_BOLD}%2d)${C_RESET} %-28s %s\n" "${i}" "${k}" "$(env_masked "${k}")"
          fi
          i=$((i+1))
        done
        echo "  0) Terminer"
        echo
        read -r -p "Numéro de la clé à modifier (0=quitter, e=éditeur complet) : " choice
        [ "${choice}" = "0" ] && break
        [ "${choice}" = "e" ] && { "${EDITOR:-nano}" "${ENV_FILE}"; continue; }
        local chosen="" ck
        chosen=""; i=1
        for line in "${ENV_KEYS[@]}"; do
          [ "${i}" = "${choice}" ] && chosen="${line%%|*}"
          i=$((i+1))
        done
        if [ -z "${chosen}" ]; then warn "Choix invalide."; continue; fi
        read -r -p "Valeur pour ${chosen} (vide = supprimer) : " val
        if [ -z "${val}" ]; then
          grep -vE "^${chosen}=" "${ENV_FILE}" 2>/dev/null > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "${ENV_FILE}"
          ok "${chosen} supprimée."
        else
          env_upsert "${chosen}" "${val}"
        fi
      done
      ok "Configuration .env terminée. Pense à ./manage.sh restart si le bot tourne."
      ;;
  esac
}

# ---------------------------------------------------------------------------
# LOGS / CLEAN / DOCTOR / VERSION
# ---------------------------------------------------------------------------
cmd_logs() {
  [ -f "${LOG_FILE}" ] || die "Pas de log (${LOG_FILE}) — le bot a-t-il déjà tourné ?"
  if [ $# -ge 1 ]; then
    info "Filtre: $* (Ctrl+C pour quitter)"
    tail -n 200 -f "${LOG_FILE}" | grep --line-buffered -iE "$*"
  else
    info "Suivi de ${LOG_FILE} (Ctrl+C pour quitter)"
    tail -n 100 -f "${LOG_FILE}"
  fi
}

cmd_clean() {
  hdr "Nettoyage des fichiers temporaires"
  local tmp="${TMPDIR:-/tmp}" freed=0 n=0
  local before after
  before="$(du -sk "${tmp}/cat_catch_"* "${tmp}/batch_zip_"* "${tmp}/nebula_temp_downloads" 2>/dev/null | awk '{s+=$1} END{print s+0}')"
  # staging de téléchargement (cat_catch_*, batch_zip_*) : > 60 min
  while IFS= read -r -d '' p; do
    rm -rf -- "${p}"; n=$((n+1))
  done < <(find "${tmp}" -maxdepth 1 \( -name 'cat_catch_*' -o -name 'batch_zip_*' \) -mmin +${AGE_STAGING_MIN} -print0 2>/dev/null)
  # fichiers servis (nebula_temp_downloads) : > 3 h (liens expirés de toute façon)
  if [ -d "${tmp}/nebula_temp_downloads" ]; then
    while IFS= read -r -d '' p; do
      rm -rf -- "${p}"; n=$((n+1))
    done < <(find "${tmp}/nebula_temp_downloads" -mindepth 1 -mmin +$(( AGE_TEMP_H * 60 )) -print0 2>/dev/null)
  fi
  after="$(du -sk "${tmp}/cat_catch_"* "${tmp}/batch_zip_"* "${tmp}/nebula_temp_downloads" 2>/dev/null | awk '{s+=$1} END{print s+0}')"
  freed=$(( before - after ))
  if [ "${n}" -gt 0 ]; then
    ok "${n} élément(s) purgé(s), $(( freed / 1024 )) Mo libérés."
    warn "Nettoyage récent ignoré (<${AGE_STAGING_MIN} min) pour ne pas casser un téléchargement en cours."
  else
    ok "Rien à purger (les éléments récents sont conservés)."
  fi
}

cmd_doctor() {
  require_repo
  hdr "DIAGNOSTIQUE"
  local fails=0

  # Outils
  command -v node >/dev/null 2>&1 && ok "node $(node -v)" || { ko "node introuvable"; fails=$((fails+1)); }
  command -v npm  >/dev/null 2>&1 && ok "npm $(npm -v 2>/dev/null)" || { ko "npm introuvable"; fails=$((fails+1)); }
  command -v ffmpeg >/dev/null 2>&1 && ok "ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f3)" \
                                        || { ko "ffmpeg introuvable (apt install ffmpeg)"; fails=$((fails+1)); }
  command -v git >/dev/null 2>&1 && ok "git $(git --version | cut -d' ' -f3)" || warn "git introuvable (utile pour update)"

  # Dépôt
  local branch; branch="$(git -C "${APP_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  [ "${branch}" = "${BRANCH}" ] && ok "Branche: ${branch}" \
                                  || warn "Branche: ${branch} (attendue: ${BRANCH})"
  git -C "${APP_DIR}" remote get-url origin >/dev/null 2>&1 && ok "remote origin configuré" || warn "Pas de remote origin"

  # .env
  echo
  if [ -f "${ENV_FILE}" ]; then
    ok ".env présent (${ENV_FILE})"
    [ -n "$(env_value PANEL_TOKEN)" ] && ok "PANEL_TOKEN défini" || warn "PANEL_TOKEN vide — une clé aléatoire sera générée au démarrage (affichée une fois dans le log)"
    [ -n "$(env_value APP_URL)" ] && ok "APP_URL = $(env_value APP_URL)" || warn "APP_URL vide — les liens de téléchargement utiliseront une URL détectée (moins fiable)"
  else
    warn ".env ABSENT — ./manage.sh env"
  fi

  # RAM / disque
  echo
  local cg; cg="$(cgroup_max_mb)"
  if [ -n "${cg}" ]; then
    local mem_note=""
    [ "${cg}" -lt 1500 ] && mem_note=" ${C_YELLOW}(serré — npm start plafonne déjà le tas V8 à 384 Mo)${C_RESET}"
    echo " 🧠 Limite mémoire conteneur : ${cg} Mo${mem_note}"
  else
    info "Pas de limite cgroup détectée"
  fi
  local avail; avail="$(df -Pk / 2>/dev/null | awk 'NR==2{print int($4/1048576)}')"
  [ -n "${avail}" ] && { [ "${avail}" -ge 2 ] && ok "Disque: ${avail} Go libres" || { ko "Disque: ${avail} Go libres (<2 Go) — ./manage.sh clean"; fails=$((fails+1)); }; }

  # Build / process / réseau
  echo
  [ -f "${APP_DIR}/dist/server.cjs" ] && ok "Build présent (dist/server.cjs)" || { ko "Pas de build — ./manage.sh update"; fails=$((fails+1)); }
  is_running && ok "Bot en cours d'exécution (PID $(bot_pids | tr '\n' ' '))" || warn "Bot arrêté — ./manage.sh start"
  local code; code="$(http_code "http://127.0.0.1:${PORT}/")"
  [ "${code}" != "000" ] && ok "Panneau local : HTTP ${code}" || warn "Panneau local : pas de réponse (bot arrêté ?)"
  local pub; pub="$(public_url)"
  [ -n "${pub}" ] && { code="$(http_code "${pub}/")"; [ "${code}" != "000" ] && ok "URL publique ${pub} : HTTP ${code}" || warn "URL publique ${pub} : injoignable — tunnel à relancer ?"; }

  # Débris
  local tmp="${TMPDIR:-/tmp}"
  local n_staging; n_staging="$(find "${tmp}" -maxdepth 1 \( -name 'cat_catch_*' -o -name 'batch_zip_*' \) -mmin +${AGE_STAGING_MIN} 2>/dev/null | wc -l)"
  [ "${n_staging}" -gt 0 ] && warn "${n_staging} dossier(s) de staging orphelin(s) — ./manage.sh clean" || ok "Aucun débris de staging"

  echo
  [ "${fails}" -eq 0 ] && ok "Diagnostic global : RIEN DE BLOQUANT 🎉" || ko "${fails} problème(s) bloquant(s) à corriger."
  [ "${fails}" -gt 0 ] && exit 1
  return 0
}

cmd_version() {
  require_repo
  echo "Nebula manage.sh — $(git -C "${APP_DIR}" log -1 --format='%h (%ad)' --date=format:'%d/%m/%Y %H:%M')"
  echo "Branche: $(git -C "${APP_DIR}" rev-parse --abbrev-ref HEAD)"
}

cmd_help() {
  local self; self="$(basename "$0")"
  cat <<EOF
${C_BOLD}${C_CYAN} ╔═══════════════════════════════════════════════════════════════╗
 ║   NEBULA BOT — Gestion VPS                                      ║
 ╚═══════════════════════════════════════════════════════════════╝${C_RESET}
${C_BOLD}Usage:${C_RESET} ${self} <commande> [arguments]

${C_BOLD}Cycle de vie${C_RESET}
   ${C_BOLD}start${C_RESET}      Démarre le bot (nohup) et vérifie que le panneau répond
   ${C_BOLD}stop${C_RESET}       Arrêt propre (SIGTERM puis SIGKILL si besoin)
   ${C_BOLD}restart${C_RESET}    stop + start
   ${C_BOLD}status${C_RESET}     État complet: process, RAM vs cgroup, panneau, tunnel, disque
   ${C_BOLD}logs${C_RESET} [f]   Suit le log en direct (/root/bot.log); ex: nebula logs NOVABOX

${C_BOLD}Installation / mise à jour${C_RESET}
   ${C_BOLD}update${C_RESET}     git pull --ff-only + npm install (si besoin) + build + restart
   ${C_BOLD}setup${C_RESET}      npm install + .env initial + build (après un clonage)
   ${C_BOLD}clone${C_RESET} [d]  Clone le dépôt (défaut /root/p) puis lance setup

${C_BOLD}Configuration${C_RESET}
   ${C_BOLD}env${C_RESET}        Assistant interactif du .env (listes clés + descriptions)
   ${C_BOLD}env list${C_RESET}   Affiche les clés (valeurs secrètes masquées)
   ${C_BOLD}env set${C_RESET} K V  Définit une clé     ${C_BOLD}env get${C_RESET} K   Lit une valeur brute
   ${C_BOLD}env unset${C_RESET} K  Supprime une clé   ${C_BOLD}env edit${C_RESET}    Ouvre l'éditeur

${C_BOLD}Maintenance${C_RESET}
   ${C_BOLD}clean${C_RESET}      Purge les temporaires orphelins (staging >1h, liens expirés >3h)
   ${C_BOLD}doctor${C_RESET}     Diagnostic complet (node, ffmpeg, .env, RAM, disque, réseau…)
   ${C_BOLD}version${C_RESET}    Révision git du script + de l'app

${C_DIM}Installé via scripts/install.sh → commande « nebula » disponible partout.${C_RESET}
EOF
}

# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------
case "${1:-help}" in
  start)   shift || true; cmd_start "$@" ;;
  stop)    shift || true; cmd_stop "$@" ;;
  restart) shift || true; cmd_restart "$@" ;;
  status)  shift || true; cmd_status "$@" ;;
  update)  shift || true; cmd_update "$@" ;;
  setup)   shift || true; cmd_setup "$@" ;;
  clone)   shift || true; cmd_clone "${1:-}" ;;
  env)     shift || true; cmd_env "$@" ;;
  logs)    shift || true; cmd_logs "$@" ;;
  clean)   shift || true; cmd_clean "$@" ;;
  doctor)  shift || true; cmd_doctor "$@" ;;
  version) shift || true; cmd_version "$@" ;;
  help|--help|-h) cmd_help ;;
  *) ko "Commande inconnue: $1"; echo; cmd_help; exit 1 ;;
esac
