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
#  À la fin, la commande `nebula` est disponible partout (voir: nebula help).
# ============================================================================
set -eu

REPO_URL="https://github.com/JCVERSA/nebula-p"
BRANCH="main"

# ---------------------------------------------------------------------------
# Options (variables d'environnement ou arguments)
#   NEBULA_INSTALL_DIR=/chemin  — dossier d'installation (défaut /root/p ou ~/nebula)
#   NEBULA_SKIP_BUILD=1         — saute npm install + build (tests/CI uniquement)
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) NEBULA_INSTALL_DIR="${2?-}"; shift 2 ;;
    --skip-build) NEBULA_SKIP_BUILD=1; shift ;;
    --help|-h)
      sed -n '2,12p' "$0" 2>/dev/null || echo "See https://github.com/JCVERSA/nebula-p"
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
  [ "$(id -u)" -eq 0 ] || warn "Mode non-root: installation dans ${INSTALL_DIR} et ${BIN_DIR}."
fi
printf '    Dossier cible : %s\n    Commande      : %s/nebula\n' "$INSTALL_DIR" "$BIN_DIR"

command -v curl >/dev/null 2>&1 || fail "curl est introuvable — installe-le d'abord (apt install curl)."
APT=""
command -v apt-get >/dev/null 2>&1 && APT="apt-get"
if ! command -v git >/dev/null 2>&1; then
  [ -n "$APT" ] || fail "git est introuvable et apt-get absent — installe git manuellement."
  [ "$(id -u)" -eq 0 ] || fail "git est introuvable — passe en root (apt install git) puis relance ce script."
  step "· Installation de git"
  DEBIAN_FRONTEND=noninteractive $APT update -qq >/dev/null 2>&1 || true
  DEBIAN_FRONTEND=noninteractive $APT install -y -qq git >/dev/null || fail "Installation de git impossible."
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
    DEBIAN_FRONTEND=noninteractive $APT install -y -qq nodejs >/dev/null || fail "Installation de nodejs impossible."
    NODE_MAJOR="$(node -v | tr -d 'v' | cut -d. -f1)"
  else
    fail "Node.js >= 22 requis (root+apt indisponibles pour l'auto-install). Installe-le: https://nodejs.org puis relance."
  fi
fi
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js $NODE_MAJOR détecté — il faut >= 18."
ok "node $(node -v) / npm $(npm -v)"

# ---------------------------------------------------------------------------
step "3/6 · ffmpeg (requis pour les téléchargements anime)"
# ---------------------------------------------------------------------------
if command -v ffmpeg >/dev/null 2>&1; then
  ok "ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"
elif [ -n "$APT" ] && [ "$(id -u)" -eq 0 ]; then
  DEBIAN_FRONTEND=noninteractive $APT install -y -qq ffmpeg >/dev/null \
    && ok "ffmpeg installé" \
    || warn "Installation ffmpeg impossible — installe-le manuellement plus tard."
else
  warn "ffmpeg absent (pas de root/apt) — les téléchargements vidéo en auront besoin: apt install ffmpeg"
fi

# ---------------------------------------------------------------------------
step "4/6 · Récupération du code"
# ---------------------------------------------------------------------------
if [ -d "$INSTALL_DIR/.git" ]; then
  ok "Dépôt déjà présent — mise à jour (git pull --ff-only)…"
  git -C "$INSTALL_DIR" config pull.ff only
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH" \
    || warn "Pull refusé (modifications locales ?) — on continue avec le code actuel."
else
  mkdir -p "$INSTALL_DIR"
  [ -z "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ] || fail "$INSTALL_DIR n'est pas vide et n'est pas un dépôt git."
  git clone -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR" || fail "Clonage impossible (réseau ?)."
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
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env" 2>/dev/null || : 
  warn "Aucun .env — un .env de départ a été créé."
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
