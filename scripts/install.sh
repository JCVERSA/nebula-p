#!/bin/sh
# ============================================================================
#  NEBULA BOT — Script d'installation en une ligne
#
#  Usage (depuis n'importe quel VPS/conteneur Debian/Ubuntu) :
#    curl -fsSL "https://raw.githubusercontent.com/JCVERSA/nebula-p/main/scripts/install.sh" | sh
#
#  Ou en interactif (recommandé — permet de configurer le .env à la fin) :
#    sh -c "$(curl -fsSL https://raw.githubusercontent.com/JCVERSA/nebula-p/main/scripts/install.sh)"
#
#  Le script est idempotent : le relancer met à jour l'installation.
#  Un dossier existant cloné depuis une ancienne URL (ex. JCVERSA/p) est
#  automatiquement re-lié vers le dépôt courant (audit 8.34).
#  À la fin, la commande `nebula` est disponible partout (voir: nebula help).
# ============================================================================
set -eu

REPO_URL="https://github.com/JCVERSA/nebula-p"
BRANCH="main"

# Locale UTF-8 si disponible — évite les accents cassés sur les VPS fraîchement
# installés (locale "C" par défaut). Best-effort : sans effet si absent.
export LC_ALL=C.UTF-8 LANG=C.UTF-8

# ---------------------------------------------------------------------------
# Options (variables d'environnement ou arguments)
#   NEBULA_INSTALL_DIR=/chemin  — dossier d'installation (défaut /root/p ou ~/nebula)
#   NEBULA_SKIP_BUILD=1         — saute npm install + build (tests/CI uniquement)
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) [ $# -ge 2 ] || { printf 'ERREUR: --dir nécessite un chemin\n' >&2; exit 1; }
           NEBULA_INSTALL_DIR="$2"; shift 2 ;;
    --skip-build) NEBULA_SKIP_BUILD=1; shift ;;
    --help|-h)
      sed -n '2,14p' "$0" 2>/dev/null || echo "See https://github.com/JCVERSA/nebula-p"
      exit 0 ;;
    *) printf 'Unknown option: %s (try --help)\n' "$1" >&2; exit 1 ;;
  esac
done

step()   { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
ok()     { printf '\033[1;32mOK\033[0m %s\n' "$1"; }
warn()   { printf '\033[1;33m!!\033[0m %s\n' "$1"; }
fail()   { printf '\033[1;31mERREUR:\033[0m %s\n' "$1" >&2; exit 1; }

# Interactive ONLY when a controlling TTY exists — `curl | sh` stays non-interactive.
have_tty() { [ -t 0 ] || [ -t 1 ]; }
ask_yes_no() { # $1 question, défaut non
  have_tty || return 1
  printf '%s [y/N] ' "$1"
  IFS= read -r answer < /dev/tty || return 1
  case "$answer" in [Yy]|[Yy][Ee][Ss]) return 0 ;; *) return 1 ;; esac
}

# Installation apt avec index mis à jour une seule fois, puis retry détaillé
# si l'install silencieuse échoue (les vraies erreurs restent visibles).
APT=""
APT_UPDATED=0
apt_install() { # $@ = paquets ; return 1 si échec
  [ -n "$APT" ] || return 1
  if [ "$APT_UPDATED" -eq 0 ]; then
    DEBIAN_FRONTEND=noninteractive $APT update -qq >/dev/null 2>&1 \
      || warn "apt update a échoué — on tente l'installation quand même."
    APT_UPDATED=1
  fi
  DEBIAN_FRONTEND=noninteractive $APT install -y -qq "$@" >/dev/null 2>&1 && return 0
  warn "Installation silencieuse de '$*' échouée — retry en mode détaillé…"
  DEBIAN_FRONTEND=noninteractive $APT install -y "$@" || return 1
}

# ---------------------------------------------------------------------------
step "1/6 · Vérifications de base"
# ---------------------------------------------------------------------------
[ "$(uname -s)" = "Linux" ] || fail "Ce script cible Linux (detected: $(uname -s))."
case "$(uname -m)" in
  x86_64|aarch64|arm64) ok "Architecture: $(uname -m)" ;;
  *) warn "Architecture non testée: $(uname -m) — on continue, sans garantie." ;;
esac

if [ "$(id -u)" -eq 0 ]; then
  INSTALL_DIR="${NEBULA_INSTALL_DIR:-/root/p}"
  BIN_DIR="/usr/local/bin"
else
  INSTALL_DIR="${NEBULA_INSTALL_DIR:-$HOME/nebula}"
  BIN_DIR="$HOME/.local/bin"
  warn "Mode non-root: installation dans ${INSTALL_DIR} et ${BIN_DIR}."
fi
printf '    Dossier cible : %s\n    Commande      : %s/nebula\n' "$INSTALL_DIR" "$BIN_DIR"

# Espace disque : le dépôt + node_modules + ffmpeg demandent ~1 Go minimum.
avail_mb="$(df -Pm "${INSTALL_DIR%/*}" 2>/dev/null | awk 'NR==2{print $4}')"
case "$avail_mb" in
  ''|*[!0-9]*) ;;  # df indisponible — on continue
  *)
    [ "$avail_mb" -ge 1000 ] || fail "Espace disque insuffisant (${avail_mb} Mo libres sur ${INSTALL_DIR%/*} — il faut ~1 Go)."
    [ "$avail_mb" -ge 2000 ] || warn "Espace disque juste (${avail_mb} Mo libres — ~2 Go recommandés)."
    ;;
esac

command -v curl >/dev/null 2>&1 || fail "curl est introuvable — installe-le d'abord (apt install curl)."
command -v apt-get >/dev/null 2>&1 && APT="apt-get"
if ! command -v git >/dev/null 2>&1; then
  [ -n "$APT" ] || fail "git est introuvable et apt-get absent — installe git manuellement."
  [ "$(id -u)" -eq 0 ] || fail "git est introuvable — passe en root (apt install git) puis relance ce script."
  step "· Installation de git"
  apt_install git || fail "Installation de git impossible (voir le log apt ci-dessus)."
fi
ok "git $(git --version 2>/dev/null | awk '{print $3}')"

# ---------------------------------------------------------------------------
step "2/6 · Node.js (>= 22)"
# ---------------------------------------------------------------------------
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | tr -d 'v' | cut -d. -f1)"
fi

if [ "$NODE_MAJOR" -lt 22 ]; then
  if [ -n "$APT" ] && [ "$(id -u)" -eq 0 ]; then
    warn "Node.js absent ou trop ancien (${NODE_MAJOR:-aucun}) — installation via NodeSource 22.x…"
    curl -fsSL https://deb.nodesource.com/setup_22.x | sh - >/dev/null || fail "Échec du setup NodeSource."
    apt_install nodejs || fail "Installation de nodejs impossible."
    NODE_MAJOR="$(node -v | tr -d 'v' | cut -d. -f1)"
  else
    fail "Node.js >= 22 requis (root+apt indisponibles pour l'auto-install). Installe-le: https://nodejs.org puis relance."
  fi
fi
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js ${NODE_MAJOR} détecté — il faut >= 22 (comme la CI et le README)."
ok "node $(node -v) / npm $(npm -v)"

# ---------------------------------------------------------------------------
step "3/6 · ffmpeg (requis pour les téléchargements anime)"
# ---------------------------------------------------------------------------
if command -v ffmpeg >/dev/null 2>&1; then
  ok "ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"
elif [ -n "$APT" ] && [ "$(id -u)" -eq 0 ]; then
  apt_install ffmpeg && ok "ffmpeg installé" \
    || warn "Installation ffmpeg impossible — installe-le manuellement plus tard."
else
  warn "ffmpeg absent (pas de root/apt) — les téléchargements vidéo en auront besoin: apt install ffmpeg"
fi

# ---------------------------------------------------------------------------
step "4/6 · Récupération du code"
# ---------------------------------------------------------------------------
if [ -d "$INSTALL_DIR/.git" ]; then
  CUR_REMOTE="$(git -C "$INSTALL_DIR" remote get-url origin 2>/dev/null || true)"
  case "$CUR_REMOTE" in
    "$REPO_URL"|"$REPO_URL.git"|'')
      # Même dépôt — simple mise à jour.
      ok "Dépôt déjà présent — mise à jour (git pull --ff-only)…"
      git -C "$INSTALL_DIR" config pull.ff only
      git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH" \
        || warn "Pull refusé (modifications locales ?) — on continue avec le code actuel."
      ;;
    *)
      # Ancienne URL (ex. JCVERSA/p avant le passage à nebula-p) — re-liaison.
      warn "Dépôt existant lié à $CUR_REMOTE — re-liaison vers $REPO_URL (branche $BRANCH)…"
      git -C "$INSTALL_DIR" remote set-url origin "$REPO_URL.git" || fail "Impossible de changer l'origin."
      git -C "$INSTALL_DIR" fetch origin "$BRANCH" || fail "Fetch impossible depuis $REPO_URL."
      if [ -z "$(git -C "$INSTALL_DIR" status --porcelain 2>/dev/null)" ]; then
        git -C "$INSTALL_DIR" checkout -B "$BRANCH" "origin/$BRANCH" >/dev/null 2>&1 \
          || git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH" >/dev/null 2>&1 \
          || warn "Alignement sur origin/$BRANCH impossible — code actuel conservé."
        ok "Installation migrée vers $REPO_URL ($(git -C "$INSTALL_DIR" log -1 --format='%h'))."
      else
        warn "Arbre local modifié — PAS de reset automatique."
        warn "Résous (git stash, ou nebula update) puis relance ce script pour finir la migration."
      fi
      ;;
  esac
else
  mkdir -p "$INSTALL_DIR"
  [ -z "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ] || fail "$INSTALL_DIR n'est pas vide et n'est pas un dépôt git."
  # Clone superficiel : l'historique complet ne sert pas à l'exécution, et
  # `nebula update` (git pull) approfondit seul si besoin.
  git clone --depth 1 --single-branch -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR" || fail "Clonage impossible (réseau ?)."
  git -C "$INSTALL_DIR" config pull.ff only
  ok "Dépôt cloné ($(git -C "$INSTALL_DIR" log -1 --format='%h'))."
fi

# ---------------------------------------------------------------------------
step "5/6 · Commande 'nebula' + dépendances + build"
# ---------------------------------------------------------------------------
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/manage.sh" "$BIN_DIR/nebula"
chmod +x "$INSTALL_DIR/manage.sh"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    # BIN_DIR pas dans le PATH → l'ajouter au profil (best-effort)
    for prof in "$HOME/.profile" "$HOME/.bashrc"; do
      [ -f "$prof" ] && ! grep -q "PATH=\"$BIN_DIR" "$prof" 2>/dev/null && \
        printf '\n# Added by Nebula installer\nPATH="%s:$PATH"\n' "$BIN_DIR" >> "$prof" && break || true
    done
    PATH="$BIN_DIR:$PATH"
    warn "$BIN_DIR ajouté au PATH (recharge ta session ou: source ~/.profile)."
    ;;
esac
ok "Commande \`nebula\` installée → $BIN_DIR/nebula"

if [ "${NEBULA_SKIP_BUILD:-0}" = "1" ]; then
  warn "NEBULA_SKIP_BUILD=1 — npm install + build sautés (mode test)."
else
  bash "$INSTALL_DIR/manage.sh" setup || fail "Échec de setup (npm install / build). Consulte les messages ci-dessus."
  ok "Dépendances installées + build produit (dist/server.cjs)."
fi

# ---------------------------------------------------------------------------
step "6/6 · Configuration"
# ---------------------------------------------------------------------------
if [ ! -f "$INSTALL_DIR/.env" ]; then
  if cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env" 2>/dev/null; then
    ok ".env de départ créé depuis l'exemple (pré-rempli avec les défauts)."
  else
    warn "Impossible de créer le .env — crée-le: cp .env.example .env"
  fi
  if ask_yes_no "Configurer le .env maintenant (assistant interactif) ?"; then
    bash "$INSTALL_DIR/manage.sh" env || warn "Assistant interrompu — relance: nebula env"
  else
    printf '    Plus tard : \033[1mnebula env\033[0m\n'
  fi
else
  ok ".env déjà présent (conservé — aucune modification)."
fi

printf '\n'
printf '\033[1;36m=====================================================\033[0m\n'
printf '\033[1m  NEBULA BOT installé avec succès 🎉\033[0m\n'
printf '\033[1;36m=====================================================\033[0m\n'
printf '  Dossier      : %s\n' "$INSTALL_DIR"
printf '  Version      : %s (%s)\n' "$(git -C "$INSTALL_DIR" log -1 --format='%h')" "$BRANCH"
printf '  Commande     : nebula  (essaye: nebula help)\n'
printf '\n'
printf '  Prochaines étapes :\n'
printf '   1. \033[1mnebula env\033[0m        — APP_URL, PANEL_TOKEN, GEMINI_API_KEY…\n'
printf '   2. \033[1mnebula start\033[0m      — démarre le bot + vérifie le panneau\n'
printf '   3. \033[1mnebula doctor\033[0m     — diagnostic complet\n'
printf '\n'
printf '  Mises à jour futures : \033[1mnebula update\033[0m\n'
printf '  Tunnel Cloudflare    : docs/MIGRATION_NOUVEAU_VPS.md (dans le dépôt)\n'
printf '\n'
