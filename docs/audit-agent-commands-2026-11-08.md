# Audit agent IA + commandes — 08/11/2026

Demande : « Fait un audit complet de agent et des commands. »

Méthode : lecture intégrale du pipeline agent (`agentRunner.ts` 1 026 l., `agentBrain.ts`,
`agentObservation.ts`, `agentStateStore.ts`, `agentMetrics.ts`, `agentVoice.ts`) et du
dispatch/registre (`commandDispatch.ts`, `commandRegistry.ts`, `commandKnowledge.ts`,
`accessControl.ts`), balayage des 43 fichiers de commandes (53 commandes enregistrées,
10 528 lignes), croisement avec les tests (2 071 verts) et le terrain du 01/11.
Aucune modification de code — rapport d'abord, correctifs au feu vert owner.

---

## Verdict en une page

Le pipeline agent est **sain et remarquablement blindé** : garde-fous réappliqués à chaque
itération, boucles bornées, dégradations honnêtes, zéro contenu privé dans les métriques.
L'audit n'a trouvé **aucun 🔴** (rien qui casse la prod aujourd'hui), mais **2 🟠 réels**
(deux classes de bugs déjà croisées par le passé et corrigées ailleurs — pas ici) et
**4 🟡 / 4 🔵** de consistance.

| # | Problème | Gravité | Preuve principale |
|---|----------|---------|-------------------|
| 1 | **Sessions `.a`/`.f` scopées par CHAT, pas par auteur** : dans un groupe, le `.a 2` d'un membre consomme la recherche d'un autre — la classe de bug B5, corrigée pour `.ytv` (9.12) mais pas pour novabox/novafilm | 🟠 majeure | `novabox.ts:1371,1441` vs `botEngine.ts:1282` |
| 2 | **La boucle `messages.upsert` n'a pas de try/catch par message** : une exception non prévue rejette la promesse du listener → les messages RESTANTS du batch sont perdus, et l'erreur passe par `unhandledRejection` (logué, lissé 5 s — silencieux) | 🟠 majeure | `botEngine.ts:994-999` + `server.ts:59` |
| 3 | **`offerCatalogRetry` envoie sur le socket CAPTURÉ** (pas `resolveLiveSocket`) — la classe exacte du bug §1 de l'audit 17/10, corrigée partout sauf ici | 🟡 moyenne | `agentRunner.ts:946` |
| 4 | **Quota IA consommé AVANT l'appel IA** : une panne fournisseur brûle le quota du message (l'utilisateur paie l'indisponibilité) | 🟡 moyenne | `agentRunner.ts:359` |
| 5 | **`.img` en préfixe contourne RoleGuard** : routé avant l'ACL, une politique de groupe ne peut pas l'interdire ; et ce chemin ne vérifie pas le budget agent (contrairement au chemin IA) | 🟡 moyenne | `commandDispatch.ts:93` |
| 6 | **Délai de frappe sérialisé dans CHAQUE reply** (600 ms–2,5 s avant chaque envoi) : se cumule sur les flux multi-messages (recherche + liste + livraison) et ralentit aussi les captures du chemin agent | 🟡 moyenne | `commandDispatch.ts:148` |
| 7 | **Le tag `ownerOnly` n'est utilisé par AUCUNE commande** : les portes owner sont inline (`agtrace`, `grouplink reset`, suggestion `.purge`) — ça marche, mais le tag documenté dans `types.ts` est mort | 🔵 consistance | `accessControl.ts` + grep commands |
| 8 | **`trace.ts` : `lastCallByUser` jamais élagué** (une entrée/user à vie — minuscule mais non borné) | 🔵 mineure | `trace.ts:70` |
| 9 | **L'agent peut exécuter `.agtrace`** (pas en denylist, pas lourd) — sans effet pour un non-owner (porte inline ⛔), cosmétique pour l'owner | 🔵 mineure | `agentBrain.ts:70` |
| 10 | **`.agent` utilisable en groupe par tout membre via préfixe** (chaque tour IA est débité du quota de CELUI qui l'écrit) — probablement voulu, à confirmer | 🔵 à trancher | `commands/agent.ts` |

---

## 1. Ce qui est solide (vérifié, preuves)

L'architecture défensive décrite dans les en-têtes est **réellement implémentée** :

- **Chaîne de garde-fous réappliquée à CHAQUE itération** de la boucle d'observation :
  lookup registre + denylist (`agent`, `ai`), sanitize des args (cap 200/80/500-URL),
  lourd → confirmation fail-closed TTL 2 min, budget 10/h, signature anti-boucle
  (jamais deux fois la même commande+args), quota IA re-vérifié avant chaque décision.
  `agentRunner.ts:714-770`.
- **Boucles bornées partout** : 3 décisions IA max par message (`MAX_AI_DECISIONS`),
  chaînage search→vidéo UNE fois (9.19g), relance multi-intention UNE fois (9.18cc),
  UN retry guidé JSON, UNE récupération d'erreur — jamais de récursion non bornée.
- **Dégradation honnête en cascade** : JSON invalide → retry guidé → prompt guidage
  classique → fuites tool-call interceptées (`extractToolCallLeak`,
  `extractCommandLineLeak`, `looksLikeRawJson`) — un JSON brut n'est jamais affiché.
- **Vie privée tenue** : métriques sans contenu (`agentMetrics.ts` : action/moteur/
  latence uniquement), état persisté sans texte (`agentStateStore.ts`), logs masqués
  (`maskLogNumber`, `maskLogText`), mémoire filtrée anti-secrets (`looksSecret`).
- **RoleGuard fail-closed** : erreur de politique = refus, jamais « tout permis »
  (`commandDispatch.ts:324-336`). Owner jamais bloqué par une politique de groupe.
  Défense en profondeur réelle sur `grouplink reset` : tag `adminOnly` **ET** porte
  owner inline (`groupSettings.ts:75-77`).
- **Nettoyage des états volatils** : sessions novabox/novafilm avec timer 10 min
  (`sessions.delete`), `lastVaSearches` élagué par cutoff, `pendingYtvChoices` TTL
  10 min, `pendingPicks` borné 200, quotas à fenêtre glissante.
- **9.19j-l (mémoire sociale) correctement câblée aux 5 sites d'appel** de
  `handleAgentMessage` (DM, groupe, vocal, télécommande, `.agent`) — pins de test.
- **Kill-switchs 9.19m compatibles agent** (vérifié) : la commande `anime` coupée
  répond son message honnête (🎬, pas ❌) → `hadError=false`, la boucle s'arrête
  proprement, l'agent relaie. Aucun tour IA gaspillé en boucle.
- **Budgets prompt tenus** : fiche < 10 000 / agent < 11 500 (tests
  `agentPromptBudget.test.ts`, registre initialisé — garde anti faux-vert 9.18eeee).
  Pire cas dynamique mesuré ≈ 19-20 k chars système (mémoire 4 000 + social 1 200 +
  choix ~900 + observation + date…) — confortable pour Gemini/NIM.

## 2. Findings détaillés

### 🟠 #1 — Sessions `.a`/`.f` partagées par chat (le retour de B5)

**Constat.** `const sender = context.sender` (`novabox.ts:1371`, `novafilm.ts:305`) —
c'est le **jid du chat**, pas l'auteur. `setUserSession(sender, …)` (6 sites) et
`sessions.get(sender)` : en groupe, la session (recherche, anime choisi, saison,
qualité) est **commune à tous les membres**. Le `.a 2` de B consomme la recherche de A ;
la confirmation de langue de B redirige le flux de A.

**Pourquoi c'est déjà corrigé ailleurs.** L'audit B5 (9.12) avait exactement ce bug pour
les écrans `.ytv` : la clé est devenue `(chat, auteur)` — `hasPendingYtvChoice(senderJid,
actualSenderJid)` (`botEngine.ts:1282,1406`). Novobox/novafilm n'ont pas eu le traitement.

**Impact.** Groupe uniquement (DM : auteur = chat). Mauvais anime téléchargé « pour »
quelqu'un d'autre, écrasements d'écran — coûteux (téléchargement) et déroutant.

**Correctif proposé (9.19n).** Clé composite `chatJid|actorJid` dans les deux Maps de
session (+ `lastVaSearches`, `hasPendingLanguageConfirm`), même pattern que B5. Les
écrans en groupe affichent déjà qui a la main. Effort : moyen (toucher novabox demande
des tests recalés — le fichier fait 4 132 lignes, les tests lisant le source sont connus).

### 🟠 #2 — Un throw dans la boucle de messages perd le batch

**Constat.** `sock.ev.on("messages.upsert", async (m) => { … for (const msg of
m.messages) { … } })` (`botEngine.ts:994-999`) : **aucun try/catch autour du corps de
boucle**. Une exception imprévue (ex. `exec` qui jette à travers `handleAgentMessage`,
ou un accès sur un message malformé) rejette la promesse du listener :
1. les messages **restants du même batch** ne sont jamais traités ;
2. l'erreur part en `unhandledRejection` — le handler (`server.ts:59`) **logue avec
   rate-limit 5 s** : des rejets répétés passent inaperçus.

**Correctif proposé.** Un `try { … } catch (e) { addLog(…) }` par itération de message
(3 lignes, aucun comportement changé). C'est la même leçon que l'audit 17/10 §3 :
le process ne meurt plus, mais le message, lui, meurt quand même.

### 🟡 #3 — `offerCatalogRetry` sur socket capturé

`agentRunner.ts:946` : `await sock.sendMessage(…)` direct dans un try/catch vide — si le
socket est mort entre l'erreur de commande et l'offre, **l'offre de bascule de catalogue
est perdue silencieusement**. Le correctif 9.18ggg (`resolveLiveSocket`) est appliqué
dans `sendText`, `replyHandler`, `reactHandler`, `agentVoice`… partout sauf ici.
**Correctif** : `resolveLiveSocket(sock).sendMessage` (1 ligne).

### 🟡 #4 — Quota consommé avant l'appel IA

`agentRunner.ts:359` : `if (!det) consumeAIQuota(info.actorJid)` précède l'appel
`generateTextWithFallback`. Si le fournisseur est en panne (NIM 502, Gemini quota…),
l'utilisateur reçoit « IA momentanément indisponible » **ET perd un cran de quota**.
Même motif dans la relance multi-intention. **Correctif** : consommer après un appel
réussi (ou restituer dans le `catch`) — attention aux tests de quota qui comptent les
appels, à recaler.

### 🟡 #5 — `.img` préfixe hors RoleGuard

`commandDispatch.ts:93` : le routage `img` en préfixe retourne **avant** le lookup et
l'ACL. Conséquences : une politique de groupe (`memberDeny`) ne peut pas interdire
`.img` ; le chemin préfixe ne vérifie pas `checkAgentBudget` (le chemin agent le fait).
Le quota web par utilisateur, lui, est bien vérifié des deux côtés.
**Correctif** : passer le contrôle RoleGuard avant le routage interne (ou documenter
l'exception).

### 🟡 #6 — Délai de frappe cumulatif

`commandDispatch.ts:148` : chaque `reply` attend 600 ms–2,5 s de « typing » avant
l'envoi. Un flux qui envoie 3 messages (recherche, liste, livraison) ajoute jusqu'à
~7 s de latence pure ; le chemin agent paie le même délai pour chaque texte capturé
(c'est aussi ce qui humanise — c'est un **compromis assumé 9.19f**, pas un bug).
**Piste** : ne simuler la frappe que sur le PREMIER reply d'une exécution (flag simple),
ou réduire le plafond côté agent. À trancher côté owner.

### 🔵 #7 à #10 — consistance

- **#7** `ownerOnly` mort : les 3 portes owner sont inline. Proposition : tagger
  `agtrace` `ownerOnly: true` (il est déjà `isHeavy` par la règle admin/owner →
  double filet), garder l'inline pour les autres.
- **#8** `trace.ts:70` : élaguer `lastCallByUser` à l'accès (comme `uploads`).
- **#9** Ajouter `agtrace` à `AGENT_DENYLIST` — l'agent n'a rien à exécuter là.
- **#10** `.agent` en groupe : confirmer le choix (quota par auteur = juste ; sinon,
  exiger la mention comme le langage naturel).

## 3. Inventaire commandes (état)

- **53 commandes**, 43 fichiers, 10 528 lignes. Plus grosses : `novabox.ts` 4 132,
  `ytvideo.ts` 740, `novafilm.ts` 591, `instagram.ts` 404.
- **ACL** : 14 commandes `adminOnly` (kick/promote/demote, warn, mute/unmute,
  grouplink, welcome/goodbye, tagall/hidetag/del, poll…) — toutes avec double contrôle
  runtime (`groupJidOf` + porte inline) ✓. **0** `ownerOnly`, **0** `privateOnly`.
- **Écrans interactifs** : tous avec TTL et cleanup vérifiés (sauf le scoping #1).
- **Couverture tests** : 2 071 tests verts, harnais agent complet
  (`agentFlow`, `agentBrain`, `agentHardening`, `agentPromptBudget`…), registre et
  inventaire pinnés, kill-switchs 9.19m testés sans réseau.

## 4. Plan de correction proposé (attente feu vert)

| Lot | Contenu | Risque | Effort |
|---|---|---|---|
| A (sûr, 30 min) | #2 try/catch boucle · #3 resolveLiveSocket · #8 élagage trace · #9 denylist agtrace | nul | faible |
| B (quota) | #4 quota après appel réussi | tests quota à recaler | moyen |
| C (policy) | #5 RoleGuard sur `.img` préfixe · #7 tag ownerOnly | comportement à confirmer | faible |
| D (le gros) | #1 scoping (chat, auteur) des sessions `.a`/`.f` | gros fichier, tests à recaler | élevé |
| À trancher | #6 frape cumulée · #10 `.agent` en groupe | choix owner | — |

Recommandation : lots A+B maintenant (aucune décision à prendre), C+D après feu vert.

---

## 5. Suivi — correctifs livrés (9.19n, 08/11, feu vert owner « oui vas y »)

| Finding | Statut | Correctif |
|---|---|---|
| #2 boucle sans try | ✅ **livré** | try/catch PAR message (`botEngine.ts`) — un message qui jette est logué, le reste du lot continue |
| #3 socket capturé | ✅ **livré** | `sendMuted` + `offerCatalogRetry` passent par `resolveLiveSocket` — plus AUCUN `sock.sendMessage` direct dans agentRunner (pin de test) |
| #4 quota avant l'appel | ✅ **livré** | quota consommé au SUCCÈS de l'appel, aux 6 sites (agent ×4, DM botEngine, `.ai`) — une panne fournisseur ne brûle plus le quota |
| #5 `.img` hors RoleGuard | ✅ **livré** | porte ACL avant le routage interne (fail-closed, politique de groupe appliquée, owner jamais bloqué — testé comportementalement) |
| #7 tag ownerOnly mort | ✅ **livré** | `agtrace` taggé `ownerOnly: true` (double filet avec sa porte inline) |
| #8 trace lastCallByUser | ✅ **livré** (constat **rectifié**) | la map ÉTAIT bornée (`clear()` à 500) mais le clear perdait les cooldowns ACTIFS — remplacé par l'élagage des seules entrées expirées |
| #9 agtrace exécutable | ✅ **livré** | `agtrace` ajouté à `AGENT_DENYLIST` |
| #1 sessions par chat | ⏳ **9.19o** (lot D) | scoping (chat, auteur) de `.a`/`.f` — livraison séparée, novabox.ts fait 4 132 lignes |
| #6 frape cumulée | ⏳ à trancher | compromis humanisation 9.19f — décision owner |
| #10 `.agent` en groupe | ⏳ à trancher | décision owner |

Qualité : 2081/2081 tests (+10), tsc 0, ESLint 0, CI verte.
