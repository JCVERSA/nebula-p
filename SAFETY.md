# 🔒 SAFETY.md — Modèle de sécurité de l'agent IA

> Version 8.98 (10 oct. 2026). Ce document décrit noir sur blanc ce que
> l'agent IA du bot peut et ne peut pas faire, et pourquoi. Il est inspiré
> des leçons de [hermes-agent](https://github.com/NousResearch/hermes-agent)
> et [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
> (voir §7).

L'agent (8.93+) traduit le langage naturel en **commandes existantes** du
bot et les exécute. Ce n'est **pas** un agent universel : pas d'accès
terminal, pas de navigation web, pas d'outils propres. Sa puissance est
volontairement minuscule et son périmètre, verrouillé.

---

## 1. Périmètre

| Où | Comportement |
|---|---|
| **DM privé** | L'agent comprend et **exécute** (aux droits de l'expéditeur) |
| **Groupes** | **Jamais d'exécution** (beta) — l'IA guide seulement, elle donne la commande exacte à taper |

Le déclenchement en DM est automatique (message sans préfixe). `.agent` / `.ag` forcent l'agent explicitement.

## 2. Ce que l'agent peut faire

- Exécuter une **commande déjà enregistrée** dans le bot (registre dynamique) ;
- **Aux droits de l'expéditeur** : RoleGuard s'applique exactement comme si la personne tapait la commande elle-même ;
- **Une seule** commande par décision.

## 3. Ce qu'il ne peut JAMAIS faire

- **Denylist stricte** : `.ai` et `.agent` (pas de méta-récursion), plus toutes les commandes de groupe ;
- **Inventer** une commande, des arguments ou une capacité : réponse honnête + alternative la plus proche ;
- Annoncer la **langue, la disponibilité ou la qualité** d'un anime dans son `say` (la commande décide et le dit honnêtement — leçon du terrain 8.95b) ;
- Nommer les **sources privées** des catalogues anime (audit 8.42, test `sourcePrivacy`).

## 4. Fail-closed partout

- **Commande lourde** (téléchargements, plages d'épisodes, `purge`, `watch`, commandes owner/admin) → **confirmation explicite « OK »** exigée sous 2 minutes. Silence = rien ne se lance ;
- **JSON de l'IA non conforme** → zéro confiance : dégradation en **guidage classique**, jamais d'exécution au jugé ;
- **Commande en échec** → un seul tour de **rattrapage** (l'IA explique, propose la commande corrigée) qui exige **aussi** un OK ;
- **Bascule de catalogue** (8.94/8.96) → offre déterministe, zéro appel IA supplémentaire, confirmation OK requise ;
- Priorité des réponses nues : un « oui »/« non » nu répond **à la question en cours** (novabox ou agent), il ne redémarre pas une conversation (8.95b).

## 4ter. Outils web (9.0) — .search / .fetch / .wiki

Recherche DÉTERMINISTE : aucun token IA, aucune synthèse par le modèle —
les résultats partent tels quels à l'utilisateur. Le texte extrait par
`.fetch` est une DONNÉE affichée : aucune IA ne le lit, aucune commande
ne s'exécute à partir de lui (anti-injection de prompt par construction).

Tout le réseau sortant passe par `safeFetch` (urlSafety.ts, déjà utilisé
par le téléchargeur) : localhost, IPs privées, IPv6-mappées et `.internal`
sont REFUSÉS — le panneau et le moteur (même conteneur) restent
injoignables ; le DNS est épinglé pour empêcher un rebond de redirection
vers le réseau interne. Plafonds : 2 Mo / 15 s par requête, 4 redirections.

Budget partagé par utilisateur (`NEBULA_WEB_DAILY_LIMIT`, défaut 20/jour,
débité uniquement en cas de succès) pour ne pas faire bloquer l'IP du
serveur par les moteurs. Transparence M11 : le moteur utilisé
(DuckDuckGo, Tavily si clé, Wikipédia) voit la requête — dit dans la
réponse du bot.

## 4bis. Guardrail d'arguments (8.99)

Même après validation de la commande, les arguments produits par l'IA sont
**nettoyés avant exécution** : URLs retirées, backticks/quotes écorchés,
flags shell (`--x`) supprimés, tokens plafonnés (80 chars) et budget total
(200 chars). Un nettoyage actif est audité (`agent.args.sanitized`) et
l'exécution utilise les arguments nettoyés — la commande revalide ses
propres arguments ensuite (défense en profondeur).

## 5. Budgets et quotas

| Ressource | Plafond |
|---|---|
| Appels IA (chat + agent) | 40 / jour / utilisateur |
| Exécutions agent | 10 / heure / utilisateur |
| Concurrence IA | globale, file d'attente |
| Fiche agent (contexte) | < 6 000 caractères (test CI `agentContextBudget`) |
| Historique anime dans le prompt | uniquement si le message parle d'anime (8.99, leçon Mastra) |
| Prompt système total estimé | < 18 000 caractères |

La mémoire de conversation (8.38) et la mémoire des choix anime (8.97/8.98) sont **plafonnées et compactées** : tours bruts + résumé glissant, TTL 10 h (conversation) / 7 jours (`NEBULA_ANIME_CHOICES_TTL_HOURS`) — le bloc historique est gardé sous 900 caractères.

## 6. Vie privée et données

- **Audit sans contenus** : `agent.exec`, `agent.confirm.pending`, `agent.deny`… numéros masqués, jamais le texte des messages ;
- **Filtre anti-secrets** à l'écriture en mémoire (mots de passe, tokens, PIN…) ;
- **`.ai forget`** efface la conversation **et** l'historique anime du chat ;
- Les noms des catalogues privés n'apparaissent dans aucun message utilisateur.

## 7. Leçons externes intégrées

1. **hermes-agent a supprimé son scanner de sécurité heuristique** (tirith, oct. 2026) : 14/16 commandes d'attaque attrapées, mais 12/24 commandes bénignes bloquées — un ratio de faux positifs invivable. Nous : **allowlist de commandes existantes + denylist + confirmations explicites**, pas d'heuristique de contenu.
2. **hermes-agent a découvert que sa fiche de contexte de 38,7k caractères débordait son budget** : « chaque session perdait son milieu ». Nous : budget de fiche **verrouillé par un test CI** (8.98).
3. **deepseek-harness** : infrastructure de tests en couches (e2e, snapshot, stress). Nous : harness de replay agent (`scripts/agent-replay.ts`) pour rejouer de vraies conversations contre l'IA réelle — hors CI (clés requises), lancement manuel.

## 8. Métriques de l'agent (8.99)

Chaque tour est tracé SANS contenu de message : action (execute/ask/reply/
degraded/denied/error), moteur, latence, décision conforme oui/non, args
nettoyés. Agrégat 24 h via `/api/bot/agent-health` (carte « AI Agent —
last 24 h » du panneau) et dans le digest quotidien du propriétaire.

## 9. Harness de replay (tests agent avec la vraie IA)

Rejoue des conversations réelles de référence et vérifie les décisions de
l'agent (commande, arguments, say). **Nécessite une clé IA configurée**
(la même que le bot).

```bash
# build (une fois, après un changement de code)
npm run build

# dans le conteneur Docker (déploiement owner) :
docker exec -it <nom-du-conteneur> node dist/agent-replay.cjs

# ou n'importe où avec node_modules + .env :
node dist/agent-replay.cjs
```

Sortie : un rapport par scénario (✓/✗ + raison), code de sortie non nul si
un scénario échoue. Les scénarios vivent dans `scripts/agent-replay.ts`
(les ajouter = éditer le tableau `SCENARIOS`).

## 10. Ce qui resterait à faire (v3 éventuelle)

- Tâches planifiées en langage naturel (cron) — nécessite un cadre d'approbation ;
- Mémoire auto-curée par l'agent (hermes-style) — risque de dérive à cadrer ;
- Sous-agents parallèles — hors périmètre actuel, volontairement.
