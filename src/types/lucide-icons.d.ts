/**
 * 9.18tt — icônes lucide en IMPORTS PAR FICHIER pour morphicons.
 *
 * Retour terrain 17/10 : build de 20+ min sur le VPS 1 Go. Cause : l'index
 * de `lucide` ré-exporte ~1900 icônes et vite doit TOUTES les transformer
 * (2698 → 4608 modules) alors que nous n'en utilisons que 8.
 *
 * Usage : import PauseData from "lucide/dist/esm/icons/pause";
 * SANS extension .mjs : TS ne résout pas le sous-chemin (le paquet ne livre
 * pas de types) et ce wildcard ambiant s'applique ; Vite, lui, résout vers
 * pause.mjs au build. Précédent local : ruhend-scraper.d.ts / yt-search.d.ts.
 *
 * NOTE : l'import de type vit À L'INTÉRIEUR du declare — un import en tête
 * de .d.ts ferait du fichier un module et transformerait ces déclarations
 * en augmentations (qui ne s'appliquent qu'aux modules existants).
 */
declare module "lucide/dist/esm/icons/*" {
  import type { IconNode } from "morphicons";
  const iconNode: IconNode;
  export default iconNode;
}
