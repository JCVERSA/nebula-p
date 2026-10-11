# Nebula — Brand identity (9.13)

**Concept : « Constellation N »** — quatre points (les commandes du bot) reliés
en N par des traits, avec une étoile à 4 branches au centre : **l'agent IA**,
qui relie les commandes entre elles. Le trait diagonal s'interrompt autour de
l'étoile : l'agent est le nœud lumineux de la trajectoire, pas un simple trait.

Approuvé par l'owner le 2026-10-11 (concept A sur 3 construits — voir
`concepts/sheet.png` ; concepts B « Nova préfixe » et C « Trajectoire N »
archivés dans `concepts/`).

## Fichiers

| Fichier | Usage |
|---|---|
| `mark.svg` / `mark-on-dark.svg` | Symbole seul, encre noire (#111827) / claire (#eef1ff), fond transparent |
| `mark-color-on-light.svg` / `mark-color-on-dark.svg` | Symbole en couleurs (indigo #1e1b4b / #eef1ff, étoile violette) |
| `wordmark-on-light.svg` / `wordmark-on-dark.svg` | « NEBULA » monoline seul (trait 9, caps arrondis — même langage que la constellation) |
| `logo-horizontal-on-light.svg` / `logo-horizontal-on-dark.svg` | Lockup symbole + wordmark — **pour l'en-tête README** (`<picture>` prefers-color-scheme) |
| `favicon.svg`, `favicon-16/32/48.png` | Petite taille : **points + étoile, sans traits** (les traits disparaissent < 32 px) |
| `apple-touch-icon-180.png`, `icon-512.png` | Icônes app / og |
| `preview-horizontal-light/dark.png` | Aperçus rendus (resvg) |

Palette : encre `#111827` / `#eef1ff` · étoile `#7c3aed` (clair) / `#a78bfa`
(sombre) · fond spatial `#0b1026` · poussière `#e0e7ff`.

## Règles d'usage

- **Taille mini** : symbole complet ≥ 24 px ; en dessous, utiliser la variante
  favicon (points + étoile). Wordmark ≥ 90 px de large.
- **Espace de protection** : dégagement = hauteur d'un point (20/256 de la
  hauteur du symbole) tout autour.
- **Fonds approuvés** : transparent, blanc, `#0b1026`. Pas de photo ni de
  dégradé derrière le symbole.
- **Interdits** : recolorer l'étoile autrement que violette · ajouter ombres,
  contours ou dégradés · déformer · poser le symbole sur un fond sans contraste.
- **Mono** : quand une seule couleur est possible, tout le symbole dans cette
  couleur (l'étoile se distingue par sa forme, pas sa couleur).

## Vérification honnête

Géométrie auditée par rendu programmatique (resvg + pngjs) : marges 52/52/40/40,
alignement des lettres du wordmark à ±1 unité, encre favicon 25 % à 16 px.
**Inspection visuelle humaine : faite par l'owner sur la feuille de concepts et
le README.** Aucune recherche d'antériorité de marque n'a été effectuée.
