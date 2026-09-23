# Multi-bots (8.75)

Un seul déploiement Nebula, plusieurs bots WhatsApp — chacun dans son propre
process, avec sa session, ses données et sa personnalité.

## Comment ça marche

```
nebula start / watchdog
        │
        ▼
┌───────────────────────┐     proxifie /api/bot/* …      ┌────────────────┐
│  PANNEAU (server.cjs) │ ──────────────────────────────▶ │ MOTEUR nebula  │ 127.0.0.1:4001
│  superviseur          │        ?bot=<id>                │ (engine.cjs)   │ nebula_auth_info/ + database/
│  (sans Baileys)       │                                 └────────────────┘
└───────────────────────┘                                 ┌────────────────┐
        │ lance / surveille / relance                    │ MOTEUR bot2    │ 127.0.0.1:4002
        ▼                                                │ (engine.cjs)   │ bots/bot2/auth + bots/bot2/data
  crash d'un moteur                                      └────────────────┘
  = les autres restent debout
```

- **Le panneau** ne contient plus de moteur WhatsApp : il authentifie, affiche
  l'état de chaque bot et transmet les requêtes au moteur concerné.
- **Chaque moteur** est un process complet (mêmes commandes, même panneau
  interne) lié à `127.0.0.1` uniquement, avec `NEBULA_AUTH_DIR` (session
  Baileys) et `NEBULA_DATA_DIR` (config, groupes, stats, quota IA, mémoire IA,
  commandes du panneau) qui lui appartiennent.
- **Crash isolé** : un moteur qui meurt est relancé automatiquement
  (5 s → 10 → 20 → 40 → 60 s de délai si ça casse en boucle ; compteur remis à
  zéro après 10 min de stabilité).
- **Orphelins impossibles** : si le panneau disparaît, chaque moteur
  s'auto-arrête (garde du processus parent) ; le watchdog relance le panneau,
  qui relance les moteurs.

## Configuration : `bots.json`

À la racine du déploiement (à côté de `.env`). **Sans ce fichier, un seul bot
« nebula » tourne sur les chemins historiques** — le comportement d'avant
8.75, ta session et tes données actuelles ne bougent pas.

Copie le modèle puis adapte :

```bash
cp bots.example.json bots.json
nano bots.json
./manage.sh restart
```

```json
{
  "bots": [
    { "id": "nebula", "name": "Nebula", "enabled": true, "enginePort": 4001 },
    { "id": "bot2", "name": "Bot Deux", "enabled": true, "enginePort": 4002,
      "persona": "Tu es Bot Deux, sobre et direct." }
  ]
}
```

| Champ           | Rôle                                                        | Défaut                     |
| --------------- | ----------------------------------------------------------- | -------------------------- |
| `id`            | slug CLI/API (`pair`, `bot`, `?bot=`)                       | obligatoire                |
| `name`          | libellé affiché                                             | = `id`                     |
| `enabled`       | `false` = configuré mais pas lancé                          | `true`                     |
| `authDir`       | dossier de session WhatsApp                                 | `nebula_auth_info` (défaut) / `bots/<id>/auth` |
| `dataDir`       | dossier de données                                          | `database` (défaut) / `bots/<id>/data` |
| `enginePort`    | port local du moteur (unique, 127.0.0.1)                    | 4001, 4002, 4003…          |
| `maxOldSpaceMb` | plafond heap Node du moteur (Mo)                            | 192                        |
| `persona`       | remplace la persona IA de base (vide = persona du projet)   | vide                       |
| `autoStart`     | reconnexion auto au démarrage si session appairée           | `true`                     |

Règles de sécurité appliquées par le validateur : ids / ports / dossiers
d'auth / dossiers de données uniques (deux bots ne doivent JAMAIS partager
une session — refus au démarrage), 8 bots maximum. Un `bots.json` invalide
arrête TOUT le monde avec un message clair (`./manage.sh bots`) : échec sûr.

Le nom WhatsApp affiché dans le menu (`.menu`) et le numéro propriétaire
restent dans la config **de chaque bot** (panneau → onglet Configuration, ou
`<dataDir>/config.json`) : chaque bot a le sien.

## Ajouter un bot (exemple bot2)

```bash
cp bots.example.json bots.json          # si pas déjà fait
nano bots.json                          # passe "bot2" à enabled: true
./manage.sh restart
./manage.sh bots                        # bot2 doit être « lancé »
./manage.sh pair bot2 237690000000      # connecte le numéro de bot2
```

Le premier bot existant n'a rien à faire : il garde sa session actuelle.

## Commandes

| Commande                                  | Rôle                                                |
| ----------------------------------------- | --------------------------------------------------- |
| `nebula bots`                             | liste : état process + WhatsApp + PID de chaque bot |
| `nebula bot <id> <start\|stop\|restart\|status>` | contrôle un bot précis (process)             |
| `nebula pair [bot] <numéro>`              | code d'appariement (bot par défaut si omis)         |
| `nebula start / stop / restart / status`  | inchangé — s'applique à TOUT le déploiement         |
| `nebula update`                           | inchangé — coupe tous les bots, build, relance      |

Le panneau web continue de piloter le **bot par défaut** sans changement ;
l'API accepte `?bot=<id>` (ou l'en-tête `x-nebula-bot`) sur toutes les routes
par-bot. `GET /api/bots` donne la vue complète (à consommer par le frontend
multi-bots, session suivante).

## Vigilances (VPS ~954 Mo RAM, ~3 Go disque restants)

- **Mémoire** : panneau 256 Mo (réglable dans `.env` via `NEBULA_PANEL_MEMORY_MB`, 8.76) + chaque
  moteur 192 Mo (réglable `maxOldSpaceMb`). 3 bots = ~830 Mo de plafonds
  heap : OK au quotidien, mais évite 3 gros batchs anime **simultanés** —
  l'OOM killer viserait le plus gros process (un moteur : le superviseur le
  relance, le panneau survit).
- **Disque** : le plafond par batch (2048 Mo) est par bot. Trois bots qui
  batchent en même temps peuvent dépasser l'espace libre — un garde-fou
  global inter-bots est prévu dans la session suivante. En attendant : un
  gros batch à la fois.
- **Même IP pour tous** : 3 sessions WhatsApp depuis une seule IP VPS —
  risque de ban corrélé si comportement agressif. Reste sur des envois
  espacés (déjà le cas : batchs ~26 s).
- **`nebula update` coupe tout** : les 3 bots se déconnectent pendant
  l'update (~1-2 min), puis se reconnectent seuls (sessions conservées).
- **Secrets partagés** : les clés (`.env`) sont communes aux bots. Un
  changement de clé via le panneau s'applique immédiatement au bot dont tu
  viens de l'onglet — relance les autres (`nebula bot <id> restart`) pour
  qu'ils la prennent.

## Dépannage

- **Un moteur boucle sur « relance planifiée »** → `nebula logs` : les lignes
  `[bot:<id>]` donnent la cause (port occupé → change `enginePort` ; dossier
  illisible → vérifie les droits).
- **`bots.json invalide — AUCUN bot lancé`** → le message dit exactement quoi
  corriger ; corrige puis `./manage.sh restart`.
- **Un moteur tourne mais WhatsApp reste `disconnected`** →
  `nebula bot <id> status` pour voir ses logs, ou re-paire :
  `nebula pair <id> <numéro>`.
