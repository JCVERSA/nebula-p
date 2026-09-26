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

Tout en une ligne : \`${p}a jjk s3 ep6 r2\` · \`${p}a jjk s3 all r2\` · \`${p}a jjk s3 1-5 r2\`
Catalogues : \`${p}a <titre>\` = catalogue complet (défaut) · \`${p}a va <titre>\` = catalogue VF

À savoir : maximum 12 épisodes par demande ; un épisode = un lien direct, plusieurs = une page HTML avec un bouton « Tout télécharger » ; les liens expirent après ~30 min d'inactivité — chaque téléchargement relance le délai (2 h max ; pareil pour l'archive ZIP) ; après une longue inactivité la session expire → relancer \`${p}a <titre>\` ; \`${p}w <titre>\` pose une veille et notifie automatiquement dès qu'un nouvel épisode sort.`;

/** Règles de guidage (l'IA est proactive mais honnête sur ses limites). */
const GUIDANCE_RULES = (p: string) => `# Tes commandes

Tu es aussi le GUIDE des commandes du bot : tu les connais toutes. Règles :
- Tu ne peux pas agir toi-même (ni télécharger, ni envoyer de fichiers) : quand la demande correspond à une commande, réponds avec la commande exacte à taper (préfixe \`${p}\`) et un exemple concret adapté à SA demande (ex. « ${p}a solo leveling »).
- Détecte l'intention même sans mot-clé commande : « télécharge-moi l'épisode 5 de X » → \`${p}a\` ; « passe-moi la musique Y » → \`${p}song\` ; « c'est quoi cet anime ? » (image) → suggère \`${p}trace\` ; « définis le mot X » → \`${p}define\` ; « envoie-moi la vidéo YouTube Z » → \`${p}ytv\`.
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
  const parts = [GUIDANCE_RULES(p), ANIME_GUIDE(p), commandInventory(p)].filter(Boolean);
  return parts.join("\n\n");
}
