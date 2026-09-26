# Nebula Bot — Audit du harnais IA (8.79) et correctifs (8.80)

**Dépôt :** `JCVERSA/p` · Branche `arena/01a05555-p` · Audit sur commit `70d3b29` (« 8.79 harnais IA »)
**Date :** 2026-09-26 · **Mode : audit en lecture seule d'abord, correctifs appliqués après approbation owner (« corrige tout »)**
**Portée :** harnais IA — `persona.ts`, `commandKnowledge.ts`, `commandRegistry.ts`, `commands/ai.ts`, surfaces DM de `botEngine.ts`, `panelCommands.ts`, `aiQuota.ts`, `geminiClient.ts` (chemin `systemInstruction`), prompt système complet.

> Classification : `CONFIRMED` = prouvé par le code/une commande · `LIKELY` = inférence forte non prouvée · `RECOMMENDATION` = amélioration proposée.

---

## 1. Points vérifiés SAINS (CONFIRMED)

| Contrôle | Preuve |
|---|---|
| Cycle de modules `registry → ai → persona → commandKnowledge → registry` sûr dans tous les chemins d'entrée **pré-8.80** | vitest 565/565 ; boot du bundle esbuild (`dist/engine.cjs`) : `[Registry] Ready: 18 commands` ; chemin runtime complet exercé dans le bundle (POST `/api/bot/simulate` → simulateur → `getPersonaPrompt` construit → appel Gemini tenté, échec final = fausse clé volontaire) |
| Taille réelle du prompt système | 6 595 chars ≈ 1 649 tokens (DM, 18 commandes, 7 catégories) — mesuré via script d'inspection |
| Fiche `.a` factuelle | plafond 12 (`MAX_BATCH_EPISODES`), liens 120 min, `va` en 1er token, `vostfr`/`vf` acceptés, `all`/`tout`/`full`, plages `1-5`, listes `e2,e5`, `s1 d-`, `.a r N`, page HTML >1 épisode, `.w` — tous vérifiés dans `novabox.ts` + `quickAnimeParser.ts` |
| Résilience du bloc connaissance | `getConfig()` ne jette jamais (try/catch → defaults) ; registre vide → fiche `.a` livrée sans section inventaire (testé) |
| Quota IA sur les surfaces DM | `checkAIQuota` AVANT `consumeAIQuota` dans le handler privé (`botEngine.ts`) ; `.ai` idem |
| IA privée uniquement en DM | garde `!isGroup && !isFromMe && !text.startsWith(prefix)` ; anti-boucle `isFromMe` sans préfixe → `continue` |
| `systemInstruction` bien transmis aux deux moteurs | `geminiClient.ts` (Gemini `config.systemInstruction`) + `nimFallback(prompt, systemInstruction)` |
| Métadonnées panneau bornées | names `[a-z0-9]+`, description ≤ 200, usage ≤ 120, aliases ≤ 20×32, restauration ≤ 100 defs |

## 2. Constats et correctifs (tous appliqués en 8.80)

### F1 — CONFIRMED (latent) : cycle de modules fragile → **corrigé**
`commandRegistry.ts` construisait `const defaultCommands = [aiCommand, …]` **au top-level du module**. Importer `commands/ai.ts` AVANT le registre (test, futur refactor) faisait évaluer `aiCommand` avant l'initialisation de `ai.ts` → **crash au boot** (`ReferenceError` TDZ en ESM ; `undefined` → `TypeError: Cannot read properties of undefined (reading 'parentCategory')` — reproduit empiriquement par `tests/registryCycle.test.ts` avant le fix).
**Fix :** liste construite dans `getBuiltinCommands()` (différée au runtime, après évaluation complète de tous les modules) — tous les ordres d'entrée sont sûrs.

### F2 — CONFIRMED (préexistant, aggravé par 8.79) : registre vivant non suivi → **corrigé**
`replaceAllPanelCommands` (restauration de backup, appelée par `app.ts` `/api/bot/download-zip`… cf. route de restauration) et `deletePanelCommand` retiraient du **store** mais jamais du **registre vivant** : une commande supprimée restait invoquable ET listée dans l'inventaire IA jusqu'au restart.
**Fix :** tracking `registeredPanelNames` (Set) ; restauration/suppression retirent du registre via `removeCommand` (qui purge les alias depuis 8.79) ; `savePanelCommand` tracke aussi.

### F3 — CONFIRMED (préexistant) : alias fantômes au ré-enregistrement → **corrigé**
Ré-enregistrer une commande avec moins d'alias laissait les anciens alias pointer sur l'ancien objet (l'inventaire IA listait les alias de la nouvelle version, le moteur répondait aux anciens).
**Fix :** `register()` purge les alias de la version précédente du même nom (sans toucher un alias ré-attribué à une autre commande).

### F4 — CONFIRMED (durcissement) : injection structurelle via métadonnées → **corrigé**
Les métadonnées de commandes panneau (description, aliases…) alimentent le prompt système de l'IA. Un saut de ligne permettait d'injecter une fausse section (« # Instructions »). Surface = admin `PANEL_TOKEN` uniquement (même niveau de confiance que le code), donc durcissement et pas vulnérité critique.
**Fix :** `cleanMeta()` (aplatit `\u0000-\u001f` + `\u007f`) appliqué aux trois chemins : sauvegarde, restauration, enregistrement (défense en profondeur, couvre le store disque).

### F5 — CONFIRMED (précision) : TTL ZIP erroné dans la fiche → **corrigé**
La fiche disait « liens expirent après 2 h » — vrai pour les liens épisodes (120 min) ; l'archive ZIP optionnelle (`NEBULA_BATCH_ZIP=1`) vit 60 min. Fiche précisée.

### F6 — CONFIRMED : store sans plafond en sauvegarde → **corrigé**
`savePanelCommand` poussait sans borne (seule la restauration cappe à 100) → inventaire IA théoriquement sans limite.
**Fix :** plafond `MAX_PANEL_COMMANDS = 100` aligné sur la restauration ; la mise à jour d'une commande existante reste permise au plafond.

### F7 — INFO (risque accepté, non corrigé) : historique de mémoire dans le prompt
`aiMemory` (8.38) rejoue l'historique de conversation de l'utilisateur dans le prompt système — surface d'injection standard de tout système à mémoire conversationnelle, inchangée par 8.79, bornée par le quota IA (40/jour/utilisateur). Accepté.

## 3. Validation des correctifs

- `tests/registryCycle.test.ts` (F1) : import de `commands/ai.ts` en premier → charge + registre OK (crashait avant le fix).
- `tests/panelCommandsRegistry.test.ts` (F2/F3/F4/F6, 6 tests, store isolé via `NEBULA_DATA_DIR`) : restauration retire du registre + inventaire IA ; delete désenregistre ; mise à jour avec moins d'alias purge ; description/aplatissement structurel ; 101e commande refusée.
- `tests/commandKnowledge.test.ts` + `tests/persona.test.ts` : inchangés, verts.
- Suite complète, tsc, eslint --quiet, prettier, build, boot bundle : voir le commit 8.80.
