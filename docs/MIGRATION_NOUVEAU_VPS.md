# Guide de migration — Nouveau VPS/conteneur + tunnel Cloudflare

> Objectif : réinstaller **exactement** le setup actuel (`https://exemple.com`
> sans préfixe) sur une machine neuve, sans se tromper dans le dashboard Cloudflare.
> Durée : ~20 minutes. Document en français, étape par étape.
>
> Setup actuel de référence : conteneur Debian/Ubuntu, dépôt `/root/p`, branche
> `main` (dépôt public `nebula-p`), panneau sur le port **3000**, tunnel **cloudflared** par
> **jeton de connecteur** (Zero Trust), session WhatsApp dans `nebula_auth_info/`.

---

## 0. La question piège du dashboard : « mettre un nom devant le domaine »

Dans **Zero Trust → Networks → Tunnels → Public Hostname → Add a public hostname**,
le formulaire demande :

| Champ | Que mettre |
|---|---|
| **Subdomain** | **RIEN — laisse le champ VIDE** (il est optionnel) |
| **Domain** | `exemple.com` (à sélectionner dans la liste) |
| **Path** | vide |
| **Type** | `HTTP` |
| **URL** | `localhost:3000` |

- Subdomain **vide** + Domain `exemple.com` ⇒ l'hostname public est
  **`https://exemple.com`** (le domaine nu, exactement comme maintenant).
- Si tu tapes `www`, `nebula`, `panel`… dans Subdomain, tu obtiens
  `www.exemple.com` etc. — **ce n'est plus la même URL** que `APP_URL`, et
  le panneau rejettera les requêtes (garde anti Host-header).
- Ne tape **jamais** le domaine complet dans le champ Subdomain (ça donnerait
  `exemple.com.exemple.com`).
- Si Cloudflare signale qu'un **enregistrement DNS existe déjà** à la racine
  (l'ancien CNAME du tunnel précédent), accepte le **remplacement** : c'est
  justement le pointage qu'on veut réécrire.

> Alternative sans passer par le formulaire : onglet **DNS** du domaine →
> ajouter un enregistrement **CNAME**, nom `@` (la racine), cible
> `<ID-du-tunnel>.cfargotunnel.com`, proxy **activé** (nuage orange).
> Cloudflare « aplati » automatiquement le CNAME à la racine (CNAME flattening).

---

## 1. Avant de couper l'ancien VPS — la sauvegarde (5 min)

À récupérer depuis l'ancien conteneur (`scp` ou copier-coller) :

```bash
# Depuis TA machine locale, en adaptant ANCIEN_IP :
scp -r root@ANCIEN_IP:/root/p/.env                 ~/nebula-backup/     # clés (PANEL_TOKEN, APP_URL, GEMINI_API_KEY…)
scp -r root@ANCIEN_IP:/root/p/nebula_auth_info     ~/nebula-backup/     # SESSION WhatsApp (évite de re-scanner le QR)
scp -r root@ANCIEN_IP:/root/p/database             ~/nebula-backup/     # stats/commandes (optionnel)
scp -r root@ANCIEN_IP:/etc/cloudflared             ~/nebula-backup/     # TOKEN du tunnel (si présent)
```

**Le plus important : `nebula_auth_info/`** — sans lui, le bot redémarre mais
demande un nouveau pairing (QR à rescanner depuis le panneau).
**Le token du tunnel** peut aussi être retrouvé dans le dashboard Cloudflare
(voir §4-A), donc le copier est un confort, pas une obligation.

---

## 2. Préparer le nouveau conteneur (5 min)

```bash
# Paquets de base (ffmpeg est INDISPENSABLE pour les téléchargements anime)
apt-get update
apt-get install -y git curl ca-certificates ffmpeg

# Node.js ≥ 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node -v   # doit afficher v20.x (ou plus)
```

---

## 3. Installer l'application (1 commande)

Sur le nouveau conteneur, **tout en un** (git + Node ≥ 22 + ffmpeg + code + build
+ commande `nebula` + assistant `.env`) :

```bash
curl -fsSL "https://raw.githubusercontent.com/JCVERSA/nebula-p/main/scripts/install.sh" | sh
# puis:
nebula env      # si l'assistant n'a pas été lancé à la fin de l'installation
```

Le script est idempotent (le relancer = mise à jour). Équivalent manuel :

```bash
git clone -b main https://github.com/JCVERSA/nebula-p /root/p
cd /root/p
chmod +x manage.sh
./manage.sh setup          # npm install + .env initial + build
```

Restaurer la configuration et la session :

```bash
# Adapter le chemin vers ta sauvegarde
cp -r ~/nebula-backup/.env             /root/p/.env
cp -r ~/nebula_auth_info               /root/p/nebula_auth_info
cp -r ~/nebula-backup/database          /root/p/database        # optionnel
```

Vérifier les 3 clés vitales (`./manage.sh env list`) :

| Clé | Valeur attendue |
|---|---|
| `APP_URL` | `https://exemple.com` — **exactement, sans slash final, sans sous-domaine** |
| `PANEL_TOKEN` | ta clé de connexion au panneau |
| `GEMINI_API_KEY` | ta clé Gemini |

> Si tu repars d'un `.env` neuf : `./manage.sh env` (assistant interactif)
> puis `./manage.sh env set APP_URL https://exemple.com`.

---

## 4. Le tunnel Cloudflare (5 min)

### Cas A — Réutiliser le MÊME tunnel (recommandé : zéro changement DNS)

Le hostname public `exemple.com` reste configuré sur le tunnel existant ;
on installe juste un nouveau connecteur sur la nouvelle machine.

1. Dashboard Cloudflare → **Zero Trust → Networks → Tunnels** → clique sur ton
   tunnel (celui dont le hostname public est `exemple.com` → `HTTP://localhost:3000`).
2. Onglet **Install and run a connector** (ou menu ⋯ → copier la commande) :
   copie le **jeton** affiché (long texte `eyJ…` dans la commande `cloudflared service install … --token …`).
3. Sur le nouveau conteneur :

```bash
# Installer cloudflared (amd64 ; pour ARM : cloudflared-linux-arm64)
curl -L --output /usr/local/bin/cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x /usr/local/bin/cloudflared

# Stocker le jeton puis lancer
mkdir -p /etc/cloudflared
echo -n "COLLE_LE_JETON_ICI" > /etc/cloudflared/token
nohup cloudflared tunnel run --token-file /etc/cloudflared/token > /root/tunnel.log 2>&1 &

sleep 5 && tail -5 /root/tunnel.log   # doit montrer "Registered tunnel connection"
```

L'ancien connecteur (VPS éteint) passe `DOWN` tout seul au bout de quelques
minutes ; le nouveau prend le relais. **Rien à changer côté DNS.**

### Cas B — Créer un NOUVEAU tunnel

1. **Zero Trust → Networks → Tunnels → Create a tunnel** → type *Cloudflared* →
   nom (ex. `nebula-vps2`) → **Save** → copie le jeton du connecteur.
2. Installe et lance `cloudflared` comme en cas A.
3. Onglet **Public Hostname → Add a public hostname** :

| Champ | Valeur |
|---|---|
| Subdomain | **(VIDE)** |
| Domain | `exemple.com` |
| Type | `HTTP` |
| URL | `localhost:3000` |

4. Si Cloudflare indique que l'enregistrement `exemple.com` existe déjà
   (pointant vers l'ancien tunnel), accepte le **remplacement**.
5. Vérifie dans **DNS** que la racine `@` est bien un **CNAME**
   `<id-nouveau-tunnel>.cfargotunnel.com`, proxy activé (orange).

---

## 5. Démarrer et vérifier (2 min)

```bash
cd /root/p
./manage.sh start        # démarre le bot + attend que le panneau réponde
./manage.sh doctor       # diagnostic complet (doit finir sur RIEN DE BLOQUANT)
curl -s https://exemple.com/api/health   # → {"status":"ok",...}
```

Puis ouvre `https://exemple.com` dans le navigateur et connecte-toi avec
`PANEL_TOKEN`.

---

## 6. Auto-démarrage après reboot du conteneur (pas de systemd)

```bash
crontab -e   # ajouter les 3 lignes :
@reboot /usr/local/bin/cloudflared tunnel run --token-file /etc/cloudflared/token >> /root/tunnel.log 2>&1
@reboot sleep 10 && /root/p/manage.sh start >/dev/null 2>&1
*/5 * * * * /root/p/manage.sh start >/dev/null 2>&1      # watchdog : relance si crash

> ℹ️ Le watchdog est **compatible avec `nebula update`** : pendant une mise à jour,
> `manage.sh start` voit le verrou `/tmp/nebula-update.lock` et s'abstient de
> relancer le bot (l'update le redémarre lui-même à la fin). Un verrou de plus de
> 15 min (update planté) est automatiquement nettoyé.
```

---

## 7. Dépannage rapide

| Symptôme | Cause probable | Correction |
|---|---|---|
| `https://exemple.com` injoignable | cloudflared arrêté / mauvais jeton | `tail -20 /root/tunnel.log` ; relancer §4 |
| Tunnel OK mais erreur 400/502 sur le domaine | bot arrêté ou port ≠ 3000 | `./manage.sh status` puis `./manage.sh start` |
| Erreur « Bad Host / requête rejetée » | `APP_URL` ≠ hostname réel (sous-domaine tapé dans le formulaire, slash final…) | `./manage.sh env set APP_URL https://exemple.com` puis `restart` |
| Le panneau n'accepte pas la connexion (cookie) | accès en HTTP nu ou mauvais domaine | passer par `https://exemple.com` (HTTPS obligatoire pour le cookie de session) |
| Bot démarre mais demande un QR WhatsApp | `nebula_auth_info/` non restauré | rescanner via le panneau, ou restaurer le dossier puis `restart` |
| Le dashboard force un sous-domaine | le champ Subdomain a été rempli | vider le champ Subdomain (il est **optionnel**) et re-sélectionner le domaine |

---

## 8. Résumé en une ligne par brique

- **Code** : `git clone -b main https://github.com/JCVERSA/nebula-p … && ./manage.sh setup`
- **Config** : `.env` avec `APP_URL=https://exemple.com` + `PANEL_TOKEN`
- **Session WhatsApp** : dossier `nebula_auth_info/` restauré
- **Tunnel** : `cloudflared tunnel run --token <jeton>` ; hostname public =
  Subdomain **vide** + Domain `exemple.com` → `http://localhost:3000`
- **Vérif** : `./manage.sh doctor` + `curl https://exemple.com/api/health`
