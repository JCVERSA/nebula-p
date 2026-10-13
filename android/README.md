# NOVA — Panneau de contrôle Android pour Nebula

Application Android native (Kotlin + Jetpack Compose + Material 3) qui pilote
le bot **Nebula** depuis un téléphone : statut WhatsApp en direct, démarrage /
arrêt des moteurs, QR d'appairage, télémétrie réelle du déploiement, actions
système (mise à jour, redémarrage, arrêt).

L'interface et les animations **SwiftSlate** (squircle, dock magnétique,
spinners multi-phases, toggles fluides, shimmer) ont été conçues par le
propriétaire dans [JCVERSA/thisui](https://github.com/JCVERSA/thisui)
(généré via Google AI Studio) puis transplantées ici — la couche données
(Retrofit + Bearer) parle directement à l'API du panneau.

## Connexion

L'app demande deux choses au premier lancement :

- **URL du panneau** — le tunnel Cloudflare (ex. `https://dash…`)
- **Clé du panneau** — le `PANEL_TOKEN` du dashboard web

Chaque requête porte `Authorization: Bearer <PANEL_TOKEN>`, accepté par
toutes les routes `/api/*` du panneau (`panelAuth.validBearer`). Aucun
cookie, aucun état serveur dédié, aucune donnée qui transite ailleurs que
entre le téléphone et ton VPS.

## Onglets (v1)

| Onglet | Contenu |
|---|---|
| **Home** | Statut WhatsApp, squircle démarrer/arrêter, QR d'appairage hors ligne, télémétrie (uptime panneau, latence mesurée, commandes, utilisateurs), commit du déploiement |
| **Bots** | Moteurs du panneau (multi-bots) : statut WhatsApp, port, actions démarrer / arrêter / redémarrer |
| **Settings** | Connexion (URL + clé), actions système (mise à jour / redémarrage / arrêt — avec avertissements), déconnexion, à propos |

## Récupérer l'APK

À chaque push touchant `android/`, le workflow **Android (Nova)**
(`.github/workflows/android.yml`) compile l'APK et le publie en **artifact**
`nova-debug-apk` — téléchargeable depuis l'onglet Actions du dépôt.

Le keystore debug est mis en cache entre les runs pour que les APK
successifs s'installent l'un par-dessus l'autre. Pour une signature stable
de production : ajouter les secrets `NOVA_KEYSTORE_BASE64`,
`NOVA_STORE_PASSWORD`, `NOVA_KEY_PASSWORD` et une buildType release.

## Structure

```
android/
├── app/src/main/java/com/example/
│   ├── MainActivity.kt          — porte : session → login ou shell
│   ├── data/                    — NovaSession, NebulaApi (Retrofit), NovaRepository (polling 5 s)
│   ├── model/BotModels.kt       — BotStatus, BotSelection, BotTelemetry (réels)
│   ├── viewmodel/NovaViewModel.kt
│   └── ui/
│       ├── MainScreen.kt        — shell + dialogues (diagnostic, à propos)
│       ├── screens/             — Login, Home, Bots, Settings
│       └── components/          — SwiftSlate (propriétaire) + cartes adaptées
└── gradle/libs.versions.toml    — AGP 9.1.1, Kotlin 2.2.10, Compose BOM
```

## Roadmap (v1.x)

- Utilisateurs : liste complète, ban/mute/quotas (API 9.18 déjà prête)
- Annonces + simulateur, logs en direct
- Notifications push (FCM) — architecture prévue sans push en v1
- Stockage chiffré de la clé (EncryptedSharedPreferences / Keystore)
