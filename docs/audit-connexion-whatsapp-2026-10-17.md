# Audit connexion WhatsApp — 17/10/2026

Demande : « Nebula a du mal à se connecter à WhatsApp depuis un bout de temps — audit très
complet du projet, trouve les preuves. »

Méthode : lecture croisée du log du 17/10 (fourni) + du code du moteur (botEngine, dispatch,
superviseur, manage.sh) + du code exact des dépendances npm utilisées en prod
(`@whiskeysockets/baileys@7.0.0-rc14`, `libsignal@6.0.0` — tarballs npm vérifiés fichier par
fichier) + du dépôt amont Baileys (état au 17/10/2026).

---

## Verdict en une page

Nebula **ne perd pas la connexion** — il s'en sort bien (chaque coupure du 17/10 a été
récupérée en 1 à 9 secondes). Ce qui donne l'impression d'un bot qui « a du mal », c'est
l'addition de **5 problèmes réels**, tous prouvés dans le code :

| # | Problème | Gravité | Preuve principale |
|---|----------|---------|-------------------|
| 1 | **Les réponses des commandes partent sur un socket mort** après une reconnexion — un téléchargement de 30 min qui traverse une coupure perd sa livraison, sans retry | 🔴 majeure | `commandDispatch.ts:99-148` |
| 2 | **Seuil d'auto-coupure à 15 s** (`keepAliveIntervalMs: 10_000` au lieu du défaut 30 000) : 15 s de silence reçu → le client se déclare lui-même « 408 Connection was lost ». Sur 1 cœur, une pause GC/CPU devient une coupure | 🔴 majeure | `botEngine.ts:592` + `socket.js:539` |
| 3 | **5 échecs consécutifs = bot arrêté définitif en silence** (plus personne ne le relance : le process vit, le health-check répond 200) | 🔴 majeure | `botEngine.ts:781-786` |
| 4 | **Le filtre anti-« Bad MAC » (9.18b) ne peut jamais fonctionner** : égalité stricte sur `args[0]` alors que libsignal concatène — le flot inonde le log et les messages concernés sont perdus | 🟠 majeure (diagnostic + messages perdus) | `suppressLibsignalNoise.ts:76` vs `session_cipher.js:159` |
| 5 | **Les rappels ⏰ ne partent jamais** : le « socket lu à chaque tick » (9.18bb) lit `getBotState().socket`… qui n'existe pas dans l'objet retourné → toujours `undefined` | 🟠 bug bonus trouvé pendant l'audit | `engine.ts:120`, `server.ts:132`, `botEngine.ts:148` |

Plus un **facteur aggravant structurel** : le cgroup de ~954 Mo (OOM déjà constaté — c'est
écrit noir sur blanc dans `manage.sh:196`) avec panel 256 Mo + moteur 192 Mo + ffmpeg/yt-dlp
non plafonnés. Tout gros média rapproche de la limite → swap → pauses > 15 s → déclenche le
problème #2. La coupure de 5:31:34 tombe **2 min 10 s après le début du téléchargement du
film de 1 091,8 Mo**.

Les 515 de 16:42, 21:39 et 22:02, eux, sont des rafraîchissements de flux **normaux** côté
serveurs WhatsApp (récupérés en 1-2 s) — ce n'est pas de la instability, même si 3/jour est
un peu élevé (pattern connu de Baileys 7.x, voir §6).

---

## 1. Chronologie du 17/10 décryptée

| Heure | Événement (log) | Lecture prouvée |
|-------|-----------------|------------------|
| ~5:02 | Moteur relancé (sync eee) | `cmd_update` → `cmd_stop` (panel 10 s → SIGKILL, puis moteurs 8 s → SIGKILL) : arrêt propre, pas de double moteur |
| ~5:0x–5:28 | Flot `Session error: Bad MAC` (sans horodatage — brut libsignal) | Messages reçus autour du redémarrage indéchiffrables (cause connue et documentée dans leur propre commentaire 9.18b : « messages hors-ordre/rejoués après une reconnexion, ~15 fois par incident »). **Ces messages sont perdus silencieusement.** Et le filtre censé les avaler ne marche pas (§4) |
| 5:28:57 | `[p]` Dark Neon | dispatch sur socket-1 |
| 5:29:24 | `voir-anime search: 4 result(s) "shiboyugi"` | le flux anime démarre sur socket-1 |
| ~5:31 | choix du film → téléchargement 1 091,8 Mo | |
| 5:31:34 | ❌ `408 Connection was lost` → reconnect (1/5) | **15 s de silence reçu** (§2) pendant que le cœur unique gère le téléchargement → Baileys se coupe lui-même. Récupéré en 9 s |
| 5:31:36 | `Error sending message: Connection Closed` | la réponse d'étape du flux anime part sur socket-1 en train de mourir (§1) |
| 5:31:43 | ✅ CONNECTED (socket-2) | |
| 5:41:34 | `[Presence] Failed` + `Error sending message: Connection Closed` | le flux anime (déclenché à 5:29, téléchargement ~10 min) livre via **socket-1 mort depuis 10 min** (§1). L'utilisateur n'a rien reçu — pas de retry, l'erreur est avalée |
| 6:03:13 | Message Ange reçu et traité (IG) | **preuve que socket-2 vivait et recevait** — les échecs de 5:41 viennent donc bien de la référence périmée, pas d'une panne |
| ~6:06 | Film livré + offre ⚖️ | le flux est repassé par un message neuf → dispatch sur socket-2 vivant |
| 16:42 / 21:39 / 22:02 | 3× `515 stream refresh` → reconnect en 1,2 s | rafraîchissement normal côté serveurs WhatsApp, récupération quasi instantanée. Chaque fois, l'owner reçoit en plus un « is online and connected! » (§7) |

---

## 2. Preuve #2 — le 408 est (souvent) une auto-coupure à 15 secondes

**Notre config** (`src/bot/botEngine.ts:592`) :

```ts
keepAliveIntervalMs: 10_000,   // défaut Baileys : 30_000 (lib/Defaults/index.js:53)
```

**Ce que fait Baileys** (`@whiskeysockets/baileys@7.0.0-rc14`, `lib/Socket/socket.js:530-541`) :

```js
const startKeepAliveRequest = () => (keepAliveReq = setInterval(() => {
    const diff = Date.now() - lastDateRecv.getTime();   // dernier trafic REÇU
    if (diff > keepAliveIntervalMs + 5000) {            // 10 s + 5 s = 15 s
        void end(new Boom('Connection was lost', { statusCode: DisconnectReason.connectionLost })); // ← le 408
    } else if (ws.isOpen) { /* envoyer un ping */ }
}, keepAliveIntervalMs));
```

Le `408 Connection was lost` du log n'est **pas** WhatsApp qui nous jette : c'est notre client
qui se déclare mort après **15 s sans aucun octet reçu**. Deux façons d'y arriver :

1. **Le réseau/le serveur** se tait 15 s (rarisshe sur une WS saine qui répond aux pings) ;
2. **Notre event loop est bloquée > 15 s** — l'intervalle lui-même tourne dessus. Quand il
   redémarre après le blocage, `diff` est déjà énorme → 408 immédiat.

Sur un VPS 1 cœur / 954 Mo de cgroup avec un téléchargement de 1 Go + remux + GC sur un heap
plafonné à 192 Mo, des pauses de cet ordre sont réalistes — et le choix `10_000` a abaissé la
tolérance de 35 s (défaut) à 15 s, soit **2,3× plus fragile**. Le 408 de 5:31:34, 2 min 10 s
après le début du téléchargement du film, colle exactement à ce scénario.

Contexte amont : issue **WhiskeySockets/Baileys #2192** (ouverte depuis déc. 2025) : *« since
the beginning of version 7, this error "408 Connection was lost" has increased
significantly »* — le pattern existe chez tous les utilisateurs de la v7 ; notre réglage
aggrave.

---

## 3. Preuve #1 — les réponses vivent et meurent avec le socket qui les a vues naître

`src/bot/commandDispatch.ts:99-148` — le `replyHandler` (et le `reactHandler`) ferment sur le
`sock` **capturé à l'arrivée du message** :

```ts
export async function dispatchBotCommand(sock, msg, info, ...) {   // sock du moment T
  const replyHandler = async (textStr, mediaUrl?) => {
    ...
    await sock.sendPresenceUpdate("composing", senderJid);          // socket T
    ...
    return await sock.sendMessage(senderJid, { text: textStr }, ...); // socket T
    ...
    catch (e) { addLog(`Error sending message: ${e.message}`); }    // avalé, JAMAIS retenté
  };
```

`src/bot/commands/novabox.ts` envoie **tout** par ce chemin (`context.reply(...)` lignes
378, 391, 393, 406, 408, 415, 421, 425, 636) — listes, accusés, **livraison finale**,
**offre ⚖️**. Un flux de 30 min qui traverse une reconnexion (exactement le film de 5:29 →
5:41) livre donc dans un socket fermé : `Connection Closed`, erreur avalée, **l'utilisateur
ne reçoit rien et le bot croit avoir livré**.

La preuve que le problème est connu et résolu *ailleurs* dans le projet : les veilles, le
digest, les annonces et les rappels réinjectent le socket vivant à chaque (re)connexion
(`botEngine.ts:705` `setWatchSender`, `setDigestSender`, `setAnnounceSender`), et
`reminderService.ts:264` relit le socket à chaque tick. **Seul le chemin des réponses de
commandes — le plus important — a été oublié.** (Et le cas des rappels est même cassé, §5.)

---

## 4. Preuve #4 — le filtre anti « Bad MAC » ne peut rien attraper

Le flot du 17/10 (une vingtaine de lignes + piles) était censé être avalé depuis 9.18b.

**Ce que libsignal 6.0.0 imprime réellement** (`libsignal/src/session_cipher.js:159`,
tarball npm vérifié) :

```js
console.error("Session error:" + e, e.stack);   // ← 1er argument CONCATÉNÉ
```

**Ce que le filtre teste** (`src/bot/suppressLibsignalNoise.ts:76-80`) :

```ts
if (args.length > 1 && args[0] === SUPPRESSED_ERR_PREFIX) {   // égalité STRICTE avec "Session error:"
  const text = String(second instanceof Error ? second.message : ...);
  if (text.includes("Bad MAC")) return;                       // on ne regarde que args[1]
}
```

`args[0]` vaut `"Session error:Error: Bad MAC Error: Bad MAC"` (concaténé, sans espace —
visible tel quel dans le log) ≠ `"Session error:"` → le test échoue **à tous les coups**.
Correctif : tester `typeof args[0] === "string" && args[0].startsWith("Session error:")` et
chercher `Bad MAC` **dans `args[0]`** (et garder args[1] en secours).

À savoir : ces messages qui échouent au déchiffrement sont **perdus** (Baileys abandonne) —
le bruit n'est que la partie visible ; la 9.18b l'avait déjà constaté (« ~15 fois par
incident »). C'est un phénomène post-reconnexion connu, pas une attaque ni une corruption.

---

## 5. Preuve #5 (bonus) — les rappels ⏰ ne sont jamais livrés

- `src/bot/botEngine.ts:148-158` : `getBotState()` retourne `{status, qrCode, pairingCode,
  pairingNumber, pairingExpiresAt, connectionMode, logs}` — **pas de `socket`**.
- `engine.ts:120` et `server.ts:132` : `startReminderScheduler(() => (getBotState() as
  { socket?: any }).socket)` → le getter renvoie **toujours `undefined`**.
- `src/bot/services/reminderService.ts:264-265` : `if (!sock || ...) return;` → chaque tick
  de 30 s saute la livraison en silence, pour toujours.

Le jour où un utilisateur programme `.remind`, il ne recevra jamais rien. (La télécommande
Nova, elle, lit `botState.socket` en direct dans botEngine — `runAsOwnerCommand` — donc elle
n'est pas touchée.)

---

## 6. Politique de reconnexion : les trois états du moteur

`src/bot/botEngine.ts:745-800`, comportement prouvé :

| Code reçu | Traitement | Risque |
|-----------|------------|--------|
| **515 / 428** (stream refresh) | reconnect illimité en 1,2 s, sans compter | aucun — comportement correct (16:42, 21:39, 22:02 ✓) |
| **408 et autres** | 5 tentatives espacées de 5 s (compteur remis à 0 à chaque `open`) | après 5 échecs **consécutifs** : « 🚫 Reconnection failure limit reached. Bot stopped. » → plus AUCUNE reconnexion |
| **401 / 403 / conflit** | `isBadSession` → **effacement complet du dossier de session** (`fs.rmSync(authDir)`) → rescan QR obligatoire | voulu (anti-boucle), mais à connaître : si un jour le bot réclame un QR, c'est cette branche |

Le cas « Bot stopped » est le pire scénario silencieux : le process vit, `/api/health`
répond 200, le superviseur (`botSupervisor.ts`) ne voit qu'un enfant sain — **personne ne
relance jamais**. Une rafale de 408 (ex. tempête de swap pendant un gros média, §2) peut
l'atteindre. Le log du 17/10 ne le montre pas (4 reconnect max), mais c'est LA panne
« bot éteint pour de bon » qui correspond au « depuis un bout de temps » si elle s'est déjà
produite — à vérifier côté VPS (§8).

À noter aussi : l'anti-orphelin du moteur (`engine.ts:133-140`, surveille `ppid` toutes les
5 s) et le cycle update (`cmd_stop` de `manage.sh:241-280` : panel 10 s → SIGKILL, balayage
moteurs 8 s → SIGKILL) sont **propres** — pas de double moteur à l'update. Seule entaille :
le balayage ne tue que les `engine.cjs`, **pas leurs petits-fils ffmpeg/yt-dlp** — si le
moteur est SIGKILLé pendant un encodage, l'orphelin continue de consommer le cœur unique
pendant le redémarrage.

---

## 7. Facteur aggravant : le budget mémoire, et observations mineures

**Mémoire** (documenté dans le projet lui-même) :
- `manage.sh:196-199` : « glibc arena fragmentation balloons RSS under Buffer churn in the
  **~954 MB cgroup (OOM kill mid-batch)** » — l'OOM a déjà tué le bot en plein batch
  (historique 8.50 / anti-OOM aaa).
- Budget : panel `--max-old-space-size=256` (`manage.sh:227`, réglable
  `NEBULA_PANEL_MEMORY_MB`) + moteur 192 Mo (`botsConfig.ts:81`, réglable `maxOldSpaceMb`)
  + **ffmpeg/yt-dlp sans plafond** + tunnel. Un média de 1 Go fait frôler la limite →
  swap → pauses → §2.

**Observations mineures** :
- `botEngine.ts:699` : à CHAQUE `open` (donc chaque 515), l'owner reçoit « 🌌 Nebula is
  online and connected! » — 4 messages aujourd'hui. Ça alimente l'impression d'instabilité
  plus que ça n'informe.
- Version WA Web : `fetchLatestBaileysVersion()` (rc14) lit `src/Defaults/index.ts` **du
  dépôt GitHub Baileys** (bumpé le 26/07/2026) — pas la version réelle de web.whatsapp.com.
  Aujourd'hui elle est égale au repli local `[2, 3000, 1043857760]` : aucun impact
  fonctionnel, mais ~3 mois de retard structurel, commun à tout l'écosystème Baileys.
- Baileys **7.0.0-rc14** : une release candidate en prod depuis des mois ; `rc14` est
  toujours la dernière publication npm (pas de stable 7.x sortie). Les 408/515 fréquents
  sont un sujet ouvert amont (#2192, #2060).

---

## 8. Preuves à confirmer côté VPS (SSH, une commande par ligne)

Ces commandes tranchent les derniers doutes (fréquences réelles, arrêts définitifs déjà
survenus, orphelins, budget mémoire) :

```
grep -c "Status Code: 408" /root/bot.log
grep -c "Status Code: 515" /root/bot.log
grep -n "Reconnection failure limit reached" /root/bot.log | tail -5
grep -n "Clearing stored credentials" /root/bot.log | tail -5
grep -c "Session error" /root/bot.log
grep -n "CHUTE" /root/bot.log | tail -5
ps aux | grep -E "engine.cjs|ffmpeg|yt-dlp" | grep -v grep
free -m
cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes
ls -lh /root/bot.log
```

- `Reconnection failure limit reached` présent → le §6 s'est déjà produit (panne silencieuse).
- `Clearing stored credentials` présent → le bot a déjà demandé un rescan QR (branche 401/403).
- `ffmpeg`/`yt-dlp` visibles sans `engine.cjs` parent → orphelins réels.

---

## 9. Plan correctif proposé (9.18ggg) — par priorité

| P | Correctif | Fichier(s) | Effort |
|---|-----------|-----------|--------|
| 1 | Filtre Bad MAC : `startsWith("Session error:")` + recherche de `Bad MAC` dans `args[0]` (et `args[1]` en secours) | suppressLibsignalNoise.ts | 3 lignes + test |
| 2 | **Socket vivant pour les réponses** : exporter `getLiveSocket()` de botEngine (retourne `botState.socket`) ; dans `replyHandler`/`reactHandler`/`mediaDownloader`, envoyer via `getLiveSocket() ?? sock` évalué **au moment de l'envoi** (l'import botEngine existe déjà dans commandDispatch — cycle OK). Même traitement agentVoice/agentRunner | botEngine.ts, commandDispatch.ts | modéré + tests |
| 3 | Rappels : passer `() => getLiveSocket()` aux deux call sites (remplace le cast cassé) | engine.ts, server.ts, botEngine.ts | 5 lignes + test |
| 4 | `keepAliveIntervalMs: 30_000` (retour au défaut Baileys, seuil 35 s) — éventuellement réglable `NEBULA_KEEPALIVE_MS` | botEngine.ts | 1 ligne |
| 5 | Budget reconnect : plus jamais d'arrêt définitif — au 5e échec, **pause longue (5 min) puis nouveau budget** (backoff), journalisée ; le superviseur reste juge de la mortalité du process | botEngine.ts | ~15 lignes + tests |
| 6 | Notification owner : seulement après une vraie chute (`downtime.notify` existe déjà) — supprimer le « online » inconditionnel à chaque `open` | botEngine.ts | 3 lignes |
| 7 (option) | À l'arrêt du moteur, tuer les enfants ffmpeg/yt-dlp en cours (registre des spawns actifs dans mediaToolkit/hlsDownloader, kill au shutdown) | mediaToolkit.ts, hlsDownloader.ts, engine.ts | plus délicat, peut attendre |
| 8 (option, décision owner) | `maxOldSpaceMb` 192 → 256/320 si le cgroup le permet (vérifier `free -m` après un gros média) | bots.json (VPS) | 1 ligne côté VPS |

Aucun de ces correctifs ne touche le cœur chiffrement/session — pas de risque de rescan QR.
Le upgrade Baileys (quand une stable 7.x sortira) est à garder pour plus tard, séparément.

---

## 10. Pièces jointes de l'audit (extraits vérifiés)

- `botEngine.ts` : 579 (makeWASocket), 588-593 (config keepAlive), 657-800 (close handler),
  699 (spam online), 746 (isBadSession/403), 764 (effacement session), 781-786 (limite 5).
- `commandDispatch.ts` : 99-148 (replyHandler closure + erreurs avalées).
- `suppressLibsignalNoise.ts` : 76-80 (égalité stricte).
- `engine.ts` : 120 (getter cassé), 133-140 (garde orpheline), 111-127 (SIGTERM propre).
- `server.ts` : 132 (getter cassé), 143-148 (shutdown propre du panneau).
- `botSupervisor.ts` : stopBot (SIGTERM 8 s → SIGKILL), sweep santé 60 s.
- `manage.sh` : 196-199 (cgroup 954 Mo), 227 (panel 256 Mo), 241-280 (stop complet).
- `botsConfig.ts` : 81 (moteur 192 Mo).
- `reminderService.ts` : 264-265 (skip silencieux).
- npm `@whiskeysockets/baileys@7.0.0-rc14` : `lib/Socket/socket.js:530-541` (auto-408),
  `lib/Utils/generics.js` (version GitHub), `lib/Defaults/index.js:53` (défaut 30 s).
- npm `libsignal@6.0.0` : `src/session_cipher.js:159` (concaténation), `session_builder.js:74`
  (« Closing open session in favor of incoming prekey bundle » — ligne visible dans le log,
  récupération Signal normale).
- Amont : WhiskeySockets/Baileys #2192 (408 v7, ouvert), #2060 ; version WA bumpée 26/07/2026.
