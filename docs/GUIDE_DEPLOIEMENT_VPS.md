# Guide de déploiement VPS — Nebula Bot (repo `JCVERSA/nebula-p`, branche `main`)

Guide **pas-à-pas, copier-coller**, validé sur un conteneur Debian 11 sans systemd.
Il couvre : installation depuis zéro, configuration, tunnel Cloudflare **avec ou sans
domaine**, scripts de démarrage, connexion WhatsApp, test du système anime,
exploitation quotidienne et dépannage.

> Compléments : [`README.md`](../README.md) (présentation générale),
> [`ANIME_DOWNLOAD_AUDIT.md`](../ANIME_DOWNLOAD_AUDIT.md) (audit complet du système
> anime + historique des correctifs),
> [`CLOUDFLARE_TUNNEL_DEPLOYMENT.md`](./CLOUDFLARE_TUNNEL_DEPLOYMENT.md)
> (ancien guide anglais d'une installation PM2 du repo précédent — les principes
> du tunnel y restent valables).

---

## Sommaire

1. [Architecture et prérequis](#1-architecture-et-prérequis)
2. [Installation depuis zéro (~10 min)](#2-installation-depuis-zéro-10-min)
3. [Premier démarrage + diagnostic](#3-premier-démarrage--diagnostic)
4. [Tunnel Cloudflare — SANS domaine (rapide, 2 min)](#4-tunnel-cloudflare--sans-domaine-rapide-2-min)
5. [Tunnel Cloudflare — AVEC votre domaine (URL fixe)](#5-tunnel-cloudflare--avec-votre-domaine-url-fixe)
6. [Le script de démarrage universel + auto-start](#6-le-script-de-démarrage-universel--auto-start)
7. [Connexion WhatsApp + test final anime](#7-connexion-whatsapp--test-final-anime)
8. [Exploitation quotidienne](#8-exploitation-quotidienne)
9. [Dépannage (erreurs connues)](#9-dépannage-erreurs-connues)
10. [Annexe : variables d'environnement du système anime](#10-annexe-variables-denvironnement-du-système-anime)

---

## 1. Architecture et prérequis

```
[ Navigateur / WhatsApp ]
        │
        │ https://<votre-url>  (HTTPS géré par Cloudflare)
        ▼
┌─ Réseau Cloudflare ──────────────┐
│  Tunnel cloudflared (chiffré)    │
└────────────┬─────────────────────┘
             ▼
┌─ Conteneur / VPS Debian ────────────────────────────────┐
│  cloudflared ──► http://localhost:3000                  │
│  Nebula Bot (node dist/server.cjs)                      │
│   ├─ Panneau web (token PANEL_TOKEN)                    │
│   ├─ WhatsApp (Baileys, session dans ./nebula_session)  │
│   └─ Commande anime : anime-sama ──403──► nakanime.tv   │
│       (fallback automatique, aucune config requise)     │
└─────────────────────────────────────────────────────────┘
```

**Prérequis**

| Élément | Valeur |
|---|---|
| OS | Debian 11/12 ou Ubuntu 20.04+ (conteneur Docker ou VPS, les deux marchent) |
| Node.js | **22.x obligatoire** (`node -v` → v22) |
| ffmpeg | système (`apt install ffmpeg`) — requis pour les vidéos |
| RAM | 1 Go minimum (2 Go conseillé pour les batchs) |
| Disque | 5 Go libres (épisodes temporaires) |
| Accès sortant | HTTPS vers \*.cloudflare.com, web.whatsapp.com, nakanime.tv |

> **Pourquoi un tunnel ?** Le panneau écoute sur `localhost:3000`. Le tunnel
> Cloudflare le publie en HTTPS sans ouvrir de port, protège l'IP du VPS, et
> fournit une URL propre pour `APP_URL` (utilisée pour les liens de téléchargement
> envoyés dans WhatsApp quand le fichier dépasse 100 Mo).

---

## 2. Installation depuis zéro (~10 min)

Tout en `root` (ou avec `sudo` devant chaque commande).

### 2.1 Paquets de base + ffmpeg

```bash
apt update
apt install -y curl git ffmpeg ca-certificates gnupg openssl
ffmpeg -version | head -1     # doit afficher une version
```

### 2.2 Node.js 22 (NodeSource)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/node22.sh
bash /tmp/node22.sh
apt install -y nodejs
node -v && npm -v             # v22.x.x
```

### 2.3 Récupérer le code

```bash
cd /root
git clone -b main https://github.com/JCVERSA/nebula-p.git
cd p
```

> La branche `main` du dépôt public `nebula-p` contient tous les correctifs récents (système anime,
> fallback nakanime, proxy, mode production). Adaptez si vous déployez une autre branche.

### 2.4 Dépendances

```bash
npm install --ignore-scripts
```

> `--ignore-scripts` évite l'échec du postinstall `ffmpeg-static` (qui télécharge un
> binaire depuis GitHub Releases, souvent bloqué). **Le bot utilise ffmpeg système
> automatiquement** — rien d'autre à faire.

### 2.5 Fichier `.env`

```bash
PANEL_TOKEN=$(openssl rand -hex 32)
cat > .env <<EOF
PANEL_TOKEN=$PANEL_TOKEN
EOF
echo "Votre token panneau : $PANEL_TOKEN   (gardez-le secret !)"
```

> `APP_URL` sera ajouté automatiquement plus tard selon le mode de tunnel choisi
> (étapes 4 ou 5). Il n'y a **pas** de `NODE_ENV` à mettre dans `.env`
> (`npm start` s'en charge ; et il ferait râler le build Vite).

### 2.6 Build de production

```bash
npm run build
# Résultat attendu : dist/server.cjs (+ dist/assets/*) et "Done in Xms"
# Le warning "import.meta is not available with cjs" est normal et sans effet.
```

---

## 3. Premier démarrage + diagnostic

```bash
nohup npm start > /root/bot.log 2>&1 &
sleep 4 && tail -5 /root/bot.log
# Attendu : "[Registry] Ready: 152 commands registered."
#           "Nebula Controller Panel is live on http://localhost:3000"
```

### Le « doctor » : santé du système anime

```bash
npx tsx scripts/anime-doctor.ts            # rapide (~30 s)
npx tsx scripts/anime-doctor.ts --full     # + vrai téléchargement de test (~90 s)
```

Lecture des résultats :

| Ligne | Signification |
|---|---|
| `[PASS] [0] ffmpeg available` | ffmpeg détecté — obligatoire pour les vidéos |
| `[FAIL]/[WARN] [0] APP_URL` | normal à ce stade, sera réglé par le tunnel |
| `[FAIL] [1] HTTPS anime-sama.*` → 403 | **fréquent et non bloquant** : beaucoup d'IP d'hébergeurs sont filtrées par Cloudflare |
| `[PASS] [1] nakanime.tv (auto-fallback source)` | **la ligne qui compte** : le bot basculera automatiquement sur ce miroir |
| `[PASS] [2..6]` | si anime-sama n'est pas bloqué chez vous, tout est vert |

> Le doctor accepte aussi : `--proxy http://user:pass@host:port` ou
> `--proxy socks5://127.0.0.1:1080`, et `NEBULA_ANIME_DOMAIN=anime-sama.si` pour
> tester un autre domaine du site.

---

## 4. Tunnel Cloudflare — SANS domaine (rapide, 2 min)

Mode « quick tunnel » : URL aléatoire `https://xxxx.trycloudflare.com`, valable
jusqu'au redémarrage du tunnel. Parfait pour tester, ou pour un usage ponctuel.

### 4.1 Installer cloudflared

```bash
which cloudflared || {
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
  apt update && apt install -y cloudflared
}
cloudflared --version
```

> Si le dépôt apt échoue (réseau filtré), binaire direct :
> ```bash
> wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /usr/local/bin/cloudflared
> chmod +x /usr/local/bin/cloudflared
> ```

### 4.2 Lancer le tunnel rapide

```bash
nohup cloudflared tunnel --url http://localhost:3000 > /root/tunnel.log 2>&1 &
sleep 8
TUNNEL_URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /root/tunnel.log | head -1)
echo "PANEL : $TUNNEL_URL"
```

### 4.3 Déclarer l'URL dans le bot (important)

Le panneau refuse les requêtes dont le `Host` ne correspond pas à `APP_URL`
(protection anti host-poisoning). Sans cette étape vous auriez
`400 Invalid Host header` :

```bash
cd /root/p
sed -i "s#^APP_URL=.*#APP_URL=$TUNNEL_URL#" .env
grep APP_URL .env || echo "APP_URL=$TUNNEL_URL" >> .env
pkill -f dist/server.cjs; sleep 1
nohup npm start > /root/bot.log 2>&1 &
```

Ouvrez `TUNNEL_URL` dans votre navigateur → entrez le `PANEL_TOKEN`.

> ⚠️ Inconvénient du mode rapide : l'URL **change à chaque redémarrage** du tunnel.
> Le script de l'étape 6 automatise la mise à jour. Pour une URL fixe, passez à l'étape 5.

---

## 5. Tunnel Cloudflare — AVEC votre domaine (URL fixe)

Exemple utilisé ici : `exemple.com` (sous-domaine gratuit, zone déjà gérée
dans un compte Cloudflare). Remplacez par votre domaine. Résultat final :
`https://nebula.exemple.com` (ou la racine du domaine, au choix).

### 5.0 Prérequis : le domaine doit être une zone Cloudflare Active

1. Créez un compte sur <https://dash.cloudflare.com> (gratuit).
2. **Add a domain** → votre domaine (ex. `exemple.com`) → plan **Free**.
3. Cloudflare affiche **2 nameservers** (ex. `ada.ns.cloudflare.com`).
4. Chez votre registrar (votre registrar), remplacez
   les nameservers par ceux de Cloudflare.
5. Attendez le statut **Active** dans le dashboard (quelques minutes à quelques heures).

> Si votre registrar ne permet pas de changer les NS, ce mode ne fonctionne pas —
> utilisez le mode sans domaine (étape 4).

Deux méthodes ensuite : **A (dashboard, la plus simple)** ou **B (CLI)**.

### 5.A Méthode dashboard — tunnel « géré à distance » (recommandée)

1. Dashboard Cloudflare → **Zero Trust** → **Networks** → **Tunnels** → *Create a tunnel* → **Cloudflared**.
2. Nommez-le (ex. `nebula`) → **Save**. Cloudflare affiche une commande avec un
   **token** du genre :
   ```
   cloudflared service install eyJhIjoi...
   ```
   Copiez uniquement le long token.
3. Sur le VPS, lancez le connecteur avec ce token (pas besoin de `service install`
   qui requiert systemd — on le lance en arrière-plan) :
   ```bash
   TOKEN=eyJhIjoi...   # collez votre token ici
   nohup cloudflared tunnel run --token "$TOKEN" > /root/tunnel.log 2>&1 &
   sleep 5 && grep -i "Registered tunnel connection" /root/tunnel.log | head -2
   ```
4. Dans le dashboard, onglet **Public hostname** du tunnel → *Add a public hostname* :
   - Subdomain : `nebula` (ou vide pour la racine) — Domain : `exemple.com`
   - Service : `HTTP` → `localhost:3000`
   - Save. Attendez ~30 s (DNS + certificat).
5. Déclarez l'URL dans le bot :
   ```bash
   cd /root/p
   sed -i "s#^APP_URL=.*#APP_URL=https://nebula.exemple.com#" .env
   grep APP_URL .env || echo "APP_URL=https://nebula.exemple.com" >> .env
   pkill -f dist/server.cjs; sleep 1
   nohup npm start > /root/bot.log 2>&1 &
   ```

Ouvrez `https://nebula.exemple.com` → token panneau. **L'URL est fixe pour
toujours** — le script de démarrage (étape 6) n'a plus rien à mettre à jour.

### 5.B Méthode CLI — tunnel nommé local

```bash
# 1. Authentification (une fois) : copiez le lien affiché, ouvrez-le sur votre
#    téléphone/PC, connectez-vous et autorisez la zone exemple.com
cloudflared tunnel login

# 2. Créer le tunnel + son entrée DNS
cloudflared tunnel create nebula
cloudflared tunnel route dns nebula exemple.com

# 3. Configuration locale (le chemin du .json est affiché par "tunnel create")
TUNNEL_JSON=$(ls /root/.cloudflared/*.json | grep -v cert | head -1)
cat > /root/.cloudflared/config.yml <<EOF
tunnel: nebula
credentials-file: $TUNNEL_JSON
ingress:
  - hostname: exemple.com
    service: http://localhost:3000
  - service: http_status:404
EOF

# 4. Lancer
nohup cloudflared tunnel run nebula > /root/tunnel.log 2>&1 &

# 5. APP_URL (comme en 5.A.5)
cd /root/p
sed -i "s#^APP_URL=.*#APP_URL=https://exemple.com#" .env
grep APP_URL .env || echo "APP_URL=https://exemple.com" >> .env
pkill -f dist/server.cjs; sleep 1
nohup npm start > /root/bot.log 2>&1 &
```

---

## 6. Le script de démarrage universel + auto-start

Un seul script gère les deux modes : il détecte automatiquement si un tunnel
nommé (méthode 5.B) existe, sinon il lance un quick tunnel et met `APP_URL` à jour.

```bash
cat > /root/start.sh <<'EOF'
#!/bin/bash
# ============================================================
#  Nebula Bot - demarrage complet (bot + tunnel cloudflared)
#  Mode auto :
#   - si /root/.cloudflared/config.yml existe  -> tunnel nomme (URL fixe)
#   - sinon                                   -> quick tunnel (URL temporaire,
#     APP_URL mis a jour automatiquement dans /root/p/.env)
# ============================================================
set -u
APP_DIR="/root/p"
cd "$APP_DIR" || { echo "Repo introuvable dans $APP_DIR"; exit 1; }

# 1. Arreter l'existant
pkill -f "dist/server.cjs" 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
sleep 1

# 2. Tunnel
if [ -f /root/.cloudflared/config.yml ]; then
  echo "[start] tunnel nomme detecte -> cloudflared tunnel run"
  nohup cloudflared tunnel run nebula > /root/tunnel.log 2>&1 &
  sleep 3
  PANEL_URL=$(grep -oE "hostname: .*" /root/.cloudflared/config.yml | head -1 | sed 's/hostname: //')
  PANEL_URL="https://${PANEL_URL}"
else
  echo "[start] quick tunnel trycloudflare..."
  nohup cloudflared tunnel --url http://localhost:3000 > /root/tunnel.log 2>&1 &
  sleep 8
  PANEL_URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /root/tunnel.log | head -1)
fi

if [ -n "${PANEL_URL:-}" ] && [ "$PANEL_URL" != "https://" ]; then
  echo "[start] PANEL : $PANEL_URL"
  if grep -q "^APP_URL=" .env 2>/dev/null; then
    sed -i "s#^APP_URL=.*#APP_URL=$PANEL_URL#" .env
  else
    echo "APP_URL=$PANEL_URL" >> .env
  fi
else
  echo "[start] ATTENTION : tunnel sans URL (voir /root/tunnel.log) - APP_URL inchangé"
fi

# 3. Bot
nohup npm start > /root/bot.log 2>&1 &
sleep 4
echo "[start] --- bot ---"
tail -3 /root/bot.log
EOF
chmod +x /root/start.sh
/root/start.sh
```

> Si vous utilisez la **méthode 5.A (token dashboard)**, remplacez la ligne
> `cloudflared tunnel run nebula` par `cloudflared tunnel run --token "$CLOUDFLARED_TOKEN"`
> (avec le token écrit dans le script, ou exporté depuis `/root/.cloudflared_token`).

### Démarrage automatique au reboot du conteneur

Les conteneurs n'ont pas systemd → on utilise cron :

```bash
apt install -y cron   # si absent
(crontab -l 2>/dev/null | grep -v start.sh; echo "@reboot /root/start.sh >> /root/boot.log 2>&1") | crontab -
crontab -l            # vérifie la ligne @reboot
```

> Sur un **vrai VPS avec systemd**, préférez deux services
> (`systemctl enable nebula-bot` + `cloudflared.service` installé par le paquet) :
> demandez le détail à l'agent, ou voir l'ancien guide
> [`CLOUDFLARE_TUNNEL_DEPLOYMENT.md`](./CLOUDFLARE_TUNNEL_DEPLOYMENT.md).

### Vérification express après démarrage

```bash
curl -s http://localhost:3000/api/health        # depuis le VPS
curl -s https://VOTRE_URL/api/health            # via le tunnel
tail -f /root/bot.log                           # logs en direct (Ctrl+C pour sortir)
```

---

## 7. Connexion WhatsApp + test final anime

1. Ouvrez votre URL (`https://…`) dans un navigateur (téléphone ou PC).
2. Collez le `PANEL_TOKEN` (valeur dans `/root/p/.env`). Le serveur pose un cookie
   de session (12 h glissantes) ; le token ne redemande pas à chaque fois.
3. **Bot → Démarrer**, puis choisissez **Code d'appairage (8 chiffres)** et entrez
   votre numéro au format international (ex. `+2376XXXXXXXX`).
4. Sur WhatsApp (téléphone) : **Paramètres → Appareils connectés → Connecter un
   appareil → Utiliser un numéro de téléphone** → tapez le code à 8 chiffres.
5. Le log doit afficher `Nebula Bot is officially CONNECTED to WhatsApp!`

### Test du système anime (dans WhatsApp)

```
.a code geass s1 ep1 r1
```

Déroulé attendu : recherche anime-sama → (403) → **bascule automatique nakanime** →
saison 1, épisode 1 → choix/téléchargement → la vidéo arrive dans le chat
(≤ 60 Mo en vidéo lisible, sinon en document, > 100 Mo en lien `APP_URL`).

Autres formes utiles :

| Commande | Effet |
|---|---|
| `.a <nom>` | recherche interactive (anime → saison → épisode → qualité) |
| `.a jjk s3 ep6 r2` | épisode 6 de la saison 3, qualité r2 |
| `.a jjk s3 1-12 r1` | plage d'épisodes 1 à 12 (liens directs) |
| `.a jjk s3 all r1` | saison complète en ZIP |

---

## 8. Exploitation quotidienne

| Action | Commande |
|---|---|
| Redémarrer tout (bot + tunnel) | `/root/start.sh` |
| Logs du bot | `tail -f /root/bot.log` |
| Logs du tunnel | `tail -f /root/tunnel.log` |
| Santé anime | `npx tsx scripts/anime-doctor.ts` (depuis `/root/p`) |
| État du bot | `curl -s localhost:3000/api/health` |
| Espace disque | `df -h /` et `du -sh /tmp/nebula_temp_downloads` |

### Mettre à jour le bot (nouveau code)

```bash
cd /root/p
pkill -f dist/server.cjs; sleep 1
git pull origin main
npm install --ignore-scripts
npm run build
nohup npm start > /root/bot.log 2>&1 &
```
(ou simplement : `git pull && npm install --ignore-scripts && npm run build && /root/start.sh`)

### Changer le token du panneau

```bash
cd /root/p
sed -i "s/^PANEL_TOKEN=.*/PANEL_TOKEN=$(openssl rand -hex 32)/" .env
/root/start.sh
```

### Sauvegardes (à copier hors du VPS)

```bash
tar czf /root/nebula-backup-$(date +%F).tar.gz \
    /root/p/.env /root/p/database /root/p/nebula_auth_info 2>/dev/null
```
- `.env` : secrets ; `database/` : config/stats ; `nebula_auth_info/` : session
  WhatsApp (si perdue → re-pairage nécessaire).

---

## 9. Dépannage (erreurs connues)

| Symptôme | Cause | Solution |
|---|---|---|
| Le panneau affiche `400 Invalid Host header` | `APP_URL` ≠ hostname utilisé | Mettre `APP_URL` à l'URL exacte du tunnel (étapes 4.3 / 5.A.5) puis `/root/start.sh` |
| `502 Bad Gateway` via le tunnel, mais panel OK en local | bot arrêté | `/root/start.sh` ; vérifier `tail -50 /root/bot.log` |
| Tunnel absent au reboot | cron absent ou `@reboot` non exécuté | refaire l'étape 6 « auto-start » ; voir `/root/boot.log` |
| `npm install` échoue sur `ffmpeg-static` | GitHub Releases bloqué | utiliser `npm install --ignore-scripts` + ffmpeg système |
| `(0, import_baileys.default) is not a function` | ancien build sans le correctif | `git pull && npm run build && /root/start.sh` |
| Recherche anime → « Site inaccessible (HTTP 403 Cloudflare) » | IP du VPS bloquée par anime-sama | **normal sur beaucoup d'hébergeurs** — le fallback nakanime prend le relais automatiquement ; sinon configurer `NEBULA_ANIME_PROXY` |
| `[FAIL] nakanime.tv` dans le doctor | les deux sources bloquées | changer de réseau/sortie (proxy SOCKS via SSH : `ssh -D`), voir audit R3 |
| Téléchargement lent / échecs aléatoires de segments | DNS instable | déjà atténué (cache de validation 5 min) ; vérifier `cat /etc/resolv.conf` |
| `fatal error: all goroutines are asleep - deadlock!` (esbuild) | mode **dev** uniquement (`npm run dev`) | utiliser `npm run build && npm start` ; en dev : relancer, `rm -rf node_modules/.vite` |
| WhatsApp se déconnecte souvent | session corrompue | panneau → Stop → **Effacer la session** → re-pairage |
| Disque plein | vidéos temporaires | `rm -rf /tmp/nebula_temp_downloads/* /tmp/cat_catch_*` (les TTL nettoient normalement seuls) |
| URL trycloudflare invalide après reboot | quick tunnel = URL temporaire | `/root/start.sh` la régénère ; pour une URL fixe → étape 5 |

---

## 10. Annexe : variables d'environnement du système anime

| Variable | Défaut | Rôle |
|---|---|---|
| `NEBULA_ANIME_PROXY` | (vide) | Proxy de sortie pour tout le pipeline anime. `http://user:pass@host:port` ou `socks5://127.0.0.1:1080` (WARP proxy-mode, tunnel SSH `-D`, proxy résidentiel). **Laisser vide** si le fallback nakanime suffit. |
| `NEBULA_ANIME_DOMAIN` | `anime-sama.to` | Domaine alternatif du site (`anime-sama.si`, …) — le doctor le teste aussi. |
| `NEBULA_NOVABOX_MAX_EPISODES` | 12 | Nombre max d'épisodes par commande batch. |
| `NEBULA_NOVABOX_MAX_BATCH_MB` | 2048 | Plafond de taille par batch. |
| `NEBULA_TEMP_MAX_BYTES` | 4 GiB | Plafond du stockage temporaire des téléchargements. |
| `APP_URL` | (vide) | URL publique du panneau — **utilisée pour les liens > 100 Mo envoyés dans WhatsApp**. Doit correspondre au hostname du tunnel. |
| `DEBUG_MEDIA` | (vide) | `true` = logs détaillés extraction/téléchargement anime. |

---

*Guide généré le 2026-08-31 — toute la procédure a été vérifiée sur un conteneur
Debian 11 (Node 22.23, ffmpeg 4.3.9) avec la branche `main`.*
