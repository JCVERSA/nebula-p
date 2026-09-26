# Nebula Bot — Audit ultra-complet de la couche commandes (8.84)

**Dépôt :** `JCVERSA/p` · Branche `arena/01a05555-p` · Audit sur commit `9c4cf24` (« 8.83 TTL glissant »)
**Date :** 2026-09-26 · **Mode : audit en lecture seule d'abord, correctifs appliqués après approbation owner (« GO tout »)**
**Périmètre :** dispatch moteur (`botEngine.ts`), registre/compilateur (`commandRegistry.ts`, `commandCompiler.ts`), les 18 commandes natives (`src/bot/commands/*.ts`), surfaces panneau (liste / code / save / generate), simulateur, ACL (`accessControl.ts`), harnais IA (couvert par AUDIT_HARNESS_2026-09-26.md, non re-audité).

> Classification : `CONFIRMED` = prouvé par le code · `LIKELY` = inférence forte · `INFO` = constat sans action.

---

## 1. Points forts vérifiés (CONFIRMED)

| Contrôle | Preuve |
|---|---|
| Dispatch robuste : préfixe → parsing insensible à la casse → exécution, try/catch par commande avec message FR | `botEngine.ts` l.835-1023 |
| RoleGuard fail-closed : ACL owner/admin/membre, deny > allow (membres), owner jamais bloqué, erreur = refus + audit trail | `accessControl.ts` + `botEngine.ts` l.1000-1015 |
| Timeouts réseau quasi partout : tiktok 20 s, recherches yt 20 s (Promise.race), chaînes song 15-20 s, téléchargement 90 s, jikan `AbortSignal.timeout`, trace 30 s | fichiers concernés |
| Garde-fous mémoire : média 100 Mo (mediaDownloader), audio 60 Mo (`maxContentLength`), image trace 10 Mo + cooldown 20 s/utilisateur borné à 500 entrées | `botEngine.ts`, `song.ts`, `trace.ts` |
| Hygiène fichiers : song nettoie ses tmp en `finally` ; IG dédoublonne par URL, max 20 médias, délai 1 s ; watch TTL 10 min sur sélections, max/chat | `song.ts`, `instagram.ts`, `watch.ts` |
| Menu/aide/IA cohérents : menu validé contre le registre (CI), inventaire verrouillé 18 commandes, help résout les alias | `menu.ts` + `tests/commandInventory.test.ts` |
| Aucun téléchargement serveur de média fourni par l'utilisateur (sweb délègue à microlink et le divulgue ; tiktok/IG/ytv laissent WhatsApp télécharger) | lecture des commandes |
| Sandbox des commandes panneau : analyse statique, VM bridée, timeout 30 s, jamais de code exécutable sur disque | `panelCommandSandbox.ts` |

## 2. Constats et correctifs (tous appliqués en 8.84)

### C1 — CONFIRMED (MEDIUM) : détournement silencieux de built-in par une commande panneau → **corrigé**
La route `/api/bot/commands/save` acceptait n'importe quel nom `[a-z0-9]+` sans vérifier la collision : sauver une commande « a » écrasait le built-in anime, et `registerPanelCommands()` (après les built-ins au boot) rendait le détournement **persistant**.
**Fix :** `findRegistrationBlocker()` — tout nom/alias doit être libre, ou résoudre vers SA PROPRE commande panneau (mise à jour). Un built-in homonyme (« trace ») est bloqué, un alias de built-in (« a », « nv ») est bloqué, un alias d'une autre commande panneau est bloqué. Appliqué aux trois chemins : save (refus propre), restauration de backup (erreur + non-enregistrée), boot (ignorée bruyamment). *Subtilité trouvée par les tests : l'auto-référence doit se baser sur `registeredPanelNames`, pas sur le simple match de nom — sinon un built-in homonyme passe.*

### C2 — CONFIRMED (MEDIUM-LOW) : `song` téléchargeait côté serveur une URL tiers sans la garde SSRF → **corrigé**
`downloadBuffer()` fetchait l'URL renvoyée par cobalt/y2mate/etc. : une API compromise aurait pu viser le metadata cloud ou un service interne. La garde dédiée existait déjà (`urlSafety.isSafeDownloadUrl`, DNS épinglé) — elle est maintenant branchée avant le fetch ; un refus bascule sur l'API suivante de la chaîne.

### C3 — CONFIRMED (LOW-MEDIUM) : vue « code » du panneau trompeuse → **corrigée**
Demander le code d'un alias (`a`) fabriquait un **faux code autogénéré** ; demander `anime` montrait le source de `anime.ts` (fiche MyAnimeList) au lieu de `novabox.ts` (la vraie commande). **Fix :** résolution alias → vraie commande, mapping `anime → novabox.ts`, et si aucun source lisible : champ vide + note honnête (l'éditeur s'ouvre vide ; la route save refuse un code vide — aucun risque de « sauver » du faux code, surtout combiné au garde C1).

### C4 — CONFIRMED (LOW) : `define` sans timeout → **corrigé**
`fetch()` nu — un API lent suspendait la commande plusieurs minutes. `AbortSignal.timeout(20 s)` ajouté.

### C5 — CONFIRMED (LOW) : `instagram` scraper sans timeout → **corrigé**
`ruhend-scraper` n'a aucun timeout intégré — borné par `Promise.race` 30 s.

### C6 — CONFIRMED (LOW) : `whois` inutilisable en privé → **corrigé**
En DM, `getGroupMembers` = [] → « ❌ Cet utilisateur n'est pas dans le groupe » même sur soi-même. Maintenant : en privé, profil affiché sans exigence d'appartenance (rôle « Contact (chat privé) »).

### C7 — CONFIRMED (LOW) : badge owner par sous-chaîne → **corrigé**
`ownerCfg.includes(number)` affichait 👑 à tout numéro *contenant* l'owner. Comparaison exacte sur liste de numéros nettoyés.

### C8 — CONFIRMED (LOW) : `base64 frombinary` corrompu en silence → **corrigé**
Entrée non binaire → `parseInt(NaN)` → caractères NUL. Maintenant : validation `/^[01]{1,16}$/` par token + message d'erreur clair (testé en comportement).

### C9 — INFO (documenté, sans action) : simulateur panneau sans RoleGuard
`simulateMessage` exécute sans ACL ni stats — surface admin (PANEL_TOKEN), équivalent à un shell d'admin ; documenté ici.

### C10 — INFO (comportement d'origine conservé) : commande inconnue = silence
Le moteur logue « Unknown command » sans répondre à l'utilisateur — fidèle aux originaux neb (contrainte standing). L'IA (8.79) couvre le guidage.

## 3. Validation

- `tests/panelCommandsRegistry.test.ts` +5 (C1) : alias de built-in refusé, built-in homonyme refusé, alias d'autre commande panneau refusé, auto-mise-à-jour permise, restauration + garde de boot.
- `tests/commandAuditFixes.test.ts` (10) : C2 (garde avant fetch), C3 (alias + mapping + plus de faux code), C4/C5 (timeouts), C6/C7 (whois), C8 en comportement (refus invalide, décode valide, rot13/encode intacts).
- Suite complète, tsc, eslint --quiet, prettier, build : voir commit 8.84.
