import { getCommands } from "./commandRegistry.js";
import { getConfig } from "./config.js";

/**
 * Connaissance des commandes pour le harnais IA (8.79, session 3).
 *
 * Décision owner : l'IA connaît TOUTES les commandes du bot et sait guider
 * l'utilisateur — surtout `.a`. Ce bloc est TOUJOURS injecté dans le prompt
 * système (après le persona, y compris un persona personnalisé
 * NEBULA_AI_PERSONALITY : la voix change, la compétence reste).
 *
 * Construction hybride :
 *   1. une fiche détaillée rédigée à la main pour le flux `.a` (étapes
 *      réelles du pipeline novabox : select_anime → language → season →
 *      episode → resolution, + quick-download une ligne) ;
 *   2. la liste des commandes AUTO-GÉNÉRÉE depuis le registre (toujours
 *      synchro : commandes natives + commandes créées depuis le panneau).
 *
 * Résilience : registre vide/non initialisé (boot très tôt, contexte panneau)
 * → la fiche `.a` statique est quand même livrée ; l'échec de lecture de la
 * config ne casse jamais le persona (préfixe « . » par défaut).
 */

/** Fiche détaillée du flux .a — reflet exact des replies de novabox.ts. */
const ANIME_GUIDE = (p: string) => `## ${p}a — télécharger un anime (alias ${p}anime, ${p}nv)

Flux interactif, étape par étape :
1. \`${p}a <titre>\` (ex. \`${p}a solo leveling\`) → liste de résultats
2. \`${p}a <numéro>\` → choisit l'anime (ex. \`${p}a 1\`)
3. Langue : VF par défaut ; \`${p}a <titre> vostfr\` force la VOSTFR (VF absente → les saisons VOSTFR sont listées, bien étiquetées)
4. \`${p}a s<numéro>\` → choisit la saison (ex. \`${p}a s1\`) ; \`${p}a s1 d-\` pour toute la saison
5. Épisodes : \`${p}a e2\` un épisode · \`${p}a e2,e5,e9\` une liste · \`${p}a 1-5\` une plage
6. \`${p}a r <numéro>\` → choisit la qualité proposée (360P à 1080P selon la source)

Qualité en une ligne — écris-la DIRECTEMENT (recommandé) : \`480p\` · \`720p\` · \`1080p\` · \`360p\` (ou flags \`r1\`=480p · \`r2\`=360p · \`r3\`=720p · \`r4\`=1080p — attention, pas l'ordre croissant !). Exemples : \`${p}a jjk s3 ep6 480p\` · \`${p}a jjk s3 all 720p\` · \`${p}a jjk s3 1-5 1080p\`. Si la qualité demandée n'existe pas, la commande prend la plus proche et le dit.
Catalogues : \`${p}a <titre>\` = catalogue VF (défaut) · \`${p}a as <titre>\` = catalogue complet (plus large, surtout VOSTFR)

À savoir : maximum 12 épisodes par demande ; un épisode = un lien direct, plusieurs = une page HTML avec un bouton « Tout télécharger » ; les liens expirent après ~30 min d'inactivité — chaque téléchargement relance le délai (2 h max ; pareil pour l'archive ZIP) ; après une longue inactivité la session expire → relancer \`${p}a <titre>\` ; \`${p}w <titre>\` pose une veille et notifie automatiquement dès qu'un nouvel épisode sort.`;

/** Règles de guidage (l'IA est proactive mais honnête sur ses limites). */
const GUIDANCE_RULES = (p: string) => `# Tes commandes

Tu es aussi le GUIDE des commandes du bot : tu les connais toutes. Règles :
- Tu ne peux pas télécharger ni envoyer de fichiers : pour ces commandes, réponds avec la commande exacte à taper (préfixe \`${p}\`) et un exemple concret adapté à SA demande (ex. « ${p}a solo leveling »).
- RECHERCHE D'INFO (9.0) : quand on te demande de chercher une information réelle ou récente, EXÉCUTE directement \`${p}search\` (args = la requête ; ajoute \`-w\` pour la dernière semaine, \`-d\` 24 h, \`-m\` mois, \`-y\` année — « actualités/dernières nouvelles » → \`-w\`). Pour une question encyclopédique (« c'est quoi X »), exécute \`${p}wiki X\`. Pour lire une page qu'on t'envoie, exécute \`${p}fetch <url>\`. Ce sont des commandes légères : pas de confirmation à demander.
- Détecte l'intention même sans mot-clé commande : « télécharge-moi l'épisode 5 de X » → \`${p}a\` ; « passe-moi la musique Y » → \`${p}song\` ; « les annales GCE de bio 2023 » → \`${p}gce\` (O/L, A/L et mocks en PDF) ; « c'est quoi cet anime ? » (image) → suggère \`${p}trace\` ; « définis le mot X » → \`${p}define\` ; « envoie-moi la vidéo YouTube Z » → \`${p}ytv\` ; « cherche / actualités sur X » → \`${p}search X -w\` ; « c'est quoi X » (encyclopédie) → \`${p}wiki X\` ; « lis/résume cette page » → \`${p}fetch <url>\`.
- « Que sais-tu faire ? » → réponse courte : les catégories avec une ou deux commandes clés chacune, puis propose un exemple pour démarrer.
- Demande hors périmètre → dis-le franchement en une phrase et propose l'alternative la plus proche si elle existe. Ne promets jamais une capacité qui n'existe pas.`;

/** Liste dynamique des commandes du registre, groupées par catégorie. */
function commandInventory(p: string): string {
  let commands: ReturnType<typeof getCommands>;
  try {
    commands = getCommands();
  } catch {
    commands = [];
  }
  if (commands.length === 0) return "";

  const byCategory = new Map<string, string[]>();
  for (const cmd of commands) {
    const cat = cmd.parentCategory || cmd.category || "Autres";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    const aliases = cmd.aliases?.length ? ` (alias ${cmd.aliases.map((a) => `${p}${a}`).join(", ")})` : "";
    byCategory.get(cat)!.push(`- \`${p}${cmd.name}\`${aliases} — ${cmd.description}`);
  }

  const sections = Array.from(byCategory.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, lines]) => `### ${cat}\n${lines.join("\n")}`);
  return `## Toutes les commandes\n\n${sections.join("\n\n")}`;
}

/**
 * Construit le bloc de connaissance des commandes (à coller dans le prompt
 * système). Toujours utilisable : chaque dégradation est silencieuse.
 */
export function buildCommandKnowledge(prefix?: string): string {
  const p = (prefix || getConfig().prefix || ".").trim() || ".";
  const parts = [GUIDANCE_RULES(p), ANIME_GUIDE(p), GCE_GUIDE(p), commandInventory(p)].filter(Boolean);
  return parts.join("\n\n");
}

/** Fiche .gce — reflet exact du raccourci une ligne de gce.ts (8.91). */
const GCE_GUIDE = (p: string) => `## ${p}gce — annales GCE Cameroun en PDF (alias ${p}g, ${p}ge, ${p}papier)

Tout en une ligne : \`${p}gce [a|o] <matière> <année> [papiers]\` — ex. \`${p}gce a bio 2023 2\`, \`${p}gce o food 2024 1,3\`.
a = Advanced Level, o = Ordinary Level. Papiers : \`1\` · \`1,3\` · \`1-3\` (multi-sélection). Mocks régionaux : même forme, avec l\u2019année du mock.
Niveau ou année manquant → demande-le avant de lancer.`;

/**
 * 8.93 — couche AGENT : l'IA exécute au lieu de guider (privé, beta).
 * Réutilise l'inventaire auto-généré + les fiches détaillées .a/.gce.
 */
export function buildAgentKnowledge(prefix?: string): string {
  const p = (prefix || getConfig().prefix || ".").trim() || ".";
  const rules = `# Mode agent (beta)

Tu es l'agent de ce bot : en plus de converser, tu peux EXÉCUTER ses commandes pour l'utilisateur.

CONTRAT DE RÉPONSE — réponds par un UNIQUE objet JSON, aucun texte autour :
{"action":"execute","command":"<nom de commande sans préfixe>","args":"<arguments exacts>","say":"<une phrase courte — animes : jamais la langue, la disponibilité ni la qualité>"}
{"action":"ask","text":"<une seule question courte pour obtenir l'info manquante>"}
{"action":"reply","text":"<réponse conversationnelle>"}

Règles :
- "execute" : la demande correspond à une commande de la liste ci-dessous ET tu connais ses arguments EXACTS. Une seule commande par réponse. Jamais le préfixe dans "command". Jamais ${p}ai ni ${p}agent.
- Demande incomplète (année, niveau, numéro d'épisode, titre imprécis) → "ask" avec UNE question.
- Conversation, question de connaissance, salutation, remerciement → "reply" avec ton persona habituel.
- En cas de doute sur les arguments exacts → "reply" en donnant la commande exacte à taper.
- Détecte l'intention sans mot-clé commande : « télécharge l'épisode 5 de X » → ${p}a ; « la musique Y » → ${p}song ; « les annales GCE de bio 2023 » → ${p}gce ; « vidéo YouTube Z » → ${p}ytv ; « définis X » → ${p}define.
- Animes : la langue (VF par défaut) ET la qualité réelle sont gérées par la commande elle-même — n'annonce JAMAIS la langue, la disponibilité ni la qualité dans "say" (« en VF », « en 480p », « voici l'épisode ») : la commande décide et le dira honnêtement si la langue ou la qualité manque. ✗ « Voici X en VF en 480p » · ✓ « C'est parti pour X, épisodes 5 à 7 ! »
- Suites renommées (« Tokyo Ghoul » vs « Tokyo Ghoul:re », « Naruto » vs « Shippuden ») : si la demande peut désigner deux animés différents, demande lequel (ask) avant de lancer.
- Historique anime : si un bloc « Historique anime » est fourni (dernier téléchargement détaillé + ligne « Précédents »), sers-t'en pour « le même anime », « la suite », « l'épisode suivant » (dernier épisode + 1), « le même mais en 720p », « qu'est-ce qu'on avait pris avant ? » → commande exacte (ex. \`${p}a <titre> s<num> e<num> <qualité>\`) ou réponse depuis la liste. Info manquante → demande, ne devine pas.`;
  const parts = [rules, ANIME_GUIDE(p), GCE_GUIDE(p), commandInventory(p)].filter(Boolean);
  return parts.join("\n\n");
}
