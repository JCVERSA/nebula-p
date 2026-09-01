# Rapport — Nouveau système de téléchargement (analyse cat-catch + diagnostic)

*Demandé le 2026-08-31 après deux symptômes : « 360P » livré à 299,2 Mo
(Code Geass s2 ep2), et comparaison avec l'extension Chrome
[cat-catch](https://github.com/xifangczy/cat-catch) qui affiche résolutions et
poids réels.*

---

## 1. Diagnostic du bug « 360P = 299 Mo »

**Cause racine, confirmée dans le code** (`animeStreamExtractor.ts`, branche
Sibnet) : l'extracteur sibnet **fabriquait deux pistes fictives** —

```
480P → 85 Mo (taille inventée, codée en dur)
360P → 55 Mo (taille inventée, codée en dur)
```

— pointant toutes les deux vers le **même fichier MP4**, dont la résolution
réelle est inconnue (sibnet ne fournit aucun manifeste). Or sibnet avait une
**priorité plus haute que vidmoly** : pour `.a … r2` (360P), la recherche de
qualité exacte trouvait le faux « 360P » sibnet **avant** d'atteindre vidmoly,
téléchargeait le vrai fichier (un 1080P de 299 Mo) et l'étiquetait « 360P ».
Taille annoncée fausse, qualité fausse, fichier non diffusable en direct.

**Correctifs appliqués (ce push) :**
1. **VidMoly devient la source n°1** (voir §4) ; sibnet redescend en repli (priorité 4).
2. **Sibnet honnête** : une seule piste « Original » avec la **taille réelle**
   obtenue par HTTP `HEAD Content-Length`. Plus aucune qualité inventée, donc
   plus de faux « match exact 360P ».
3. Le nom du lecteur affiché dans la carte WhatsApp est désormais le **vrai
   hôte** (avant : « Direct Stream » même quand vidmoly avait servi le flux).

---

## 2. Ce que fait réellement cat-catch (analyse du source)

Lecture du dépôt (`js/m3u8.js`, 2 353 lignes ; `js/m3u8.downloader.js`) :

| Fonction | Implémentation cat-catch | Où |
|---|---|---|
| **Liste des qualités** | Parse le `#EXT-X-STREAM-INF` du master m3u8 : chaque variante affichée avec `RESOLUTION=WxH` et `BANDWIDTH` (Kbps) ; défaut = débit max | `m3u8.js` L356-359 |
| **Poids exact** | `estimateFileInfo()` : requêtes `HEAD` sur **10 segments échantillons** → taille moyenne × nombre total de segments | `m3u8.js` L867-901 |
| **Téléchargement** | `Downloader(fragments, thread = 6)` : **6 segments en parallèle** par défaut (réglable), avec reprises | `m3u8.downloader.js` L3, L366 |
| **Assemblage** | Concaténation TS puis remux MP4 (ffmpeg / N_m3u8DL-RE en option) | fin de `m3u8.js` |
| **Sniffing** | Détecte les m3u8 **dans le navigateur de l'utilisateur** (cookies + IP locale) | `catch.js`, `background.js` |

**Pourquoi « ça marche à la maison »** : cat-catch tourne dans **ton** Chrome,
avec ton IP résidentielle et tes cookies. Le bot télécharge depuis le **VPS**,
dont l'IP est bloquée par anime-sama (d'où le fallback nakanime). Ce n'est pas
la même course — mais pour les flux HLS eux-mêmes (vidmoly, sibnet…), les deux
mondes font **exactement les mêmes requêtes**.

---

## 3. Ce que Nebula a déjà (et ce qui manquait)

| Brique cat-catch | Équivalent Nebula | État |
|---|---|---|
| Liste des variantes RESOLUTION+BANDWIDTH | `fetchHlsTracksAndSizes()` — parse le master, labels 360/480/720/1080 | ✅ déjà là |
| Poids exact (HEAD 10 segments) | Poids = `BANDWIDTH × durée réelle des segments / 8` (somme des `#EXTINF`) | ✅ déjà là (±10 %) |
| Téléchargement 6 threads | `downloadHlsAppLevel()` — downloader parallèle « Cat-Catch style » (même nom dans nos logs `[CAT_CATCH_DOWNLOAD]`) | ✅ **plus rapide** : 173 Mo en 19,8 s (356 segments) |
| Remux MP4 | concat TS → ffmpeg `-c copy` | ✅ déjà là |
| Qualités/poids **honnêtes partout** | ❌ sibnet mentait (fausses pistes) | ✅ **corrigé ce push** |
| Source de qualité stable par défaut | ❌ sibnet (menteur) passé avant vidmoly | ✅ **corrigé ce push** (vidmoly n°1) |
| Garantie « lisible dans WhatsApp » | compression 480p auto si >95 Mo sur r1/r2 | ✅ déjà là, maintenant déclenchée sur de vrais fichiers |

---

## 4. Le nouveau système (design adopté)

```
.a <anime> sN epN rN
        │
        ├─ 1. Résolution des lecteurs (nakanime) ── priorité : VIDMOLY (1)
        │       replis : ansembed (2), embed4me (3), sibnet (4), sendvid (5)…
        │       miroirs triés par langue de session (VF d'abord si VF)
        │
        ├─ 2. VIDMOLY : master.m3u8 → VRAIES variantes (ex. 480P ~150 Mo,
        │       1080P ~330 Mo — tailles = bande passante × durée réelle)
        │
        ├─ 3. Choix honnête : r1=480P r2=360P r3=720P r4=1080P
        │       exact → sinon plus proche ≤ demandée → sinon la plus petite
        │       (jamais d'étiquette mensongère, jamais de 1080P déguisé)
        │
        ├─ 4. Téléchargement parallèle des segments (style cat-catch, ~9 Mo/s)
        │
        └─ 5. Livraison WhatsApp :
                ≤ 60 Mo  → vidéo lisible directement dans le chat
                ≤ 100 Mo → document
                > 100 Mo sur r1/r2 → compression 480p CRF26 automatique
                                    → vidéo dans le chat
                r3/r4 (>100 Mo)     → lien temporaire 2 h (APP_URL)
```

**Choix assumés** (mon avis) :
- **VidMoly en référence qualité** : manifeste stable à 2 variantes par épisode
  (480P + 1080P typiquement — ce que montre ta capture), tailles fiables,
  extraction robuste éprouvée. Les autres lecteurs restent des **replis** pour
  la disponibilité, plus des sources de qualité.
- **r2 sur vidmoly = 480P réel** (vidmoly n'a pas de 360P) : plutôt que de
  refuser, on sert le 480P **réel** puis on le **compresse** pour WhatsApp —
  c'est ce qui colle le mieux à « rapide et lisible dans le chat ».
- La précision cat-catch (HEAD d'échantillons) n'apporterait que ~5 % de
  précision supplémentaire sur l'annonce, pour 10 requêtes de plus par
  variante : pas retenu pour l'instant, la bande passante × durée réelle suffit.

## 5. Résultat attendu après ce push

`.a code geass s2 ep2 r2` :
1. vidmoly sondé en premier → master → variantes réelles (480P/1080P) ;
2. pas de 360P → **480P réel** sélectionné (plus proche ≤ 360 inexistant →
   plus petite disponible) — étiquette honnête ;
3. téléchargement parallèle (~20-30 s) → ~150-190 Mo ;
4. > 95 Mo + voie rapide → **compression automatique 480p** → **vidéo ~60-90 Mo
   lisible directement dans le chat**.

Vérification sans WhatsApp :
```bash
npx tsx scripts/anime-repro.ts "code geass" 2 2 --dl
# attendu : [vidmoly.org] STREAM OK tracks: 480P,1080P + extraction < 60 s
# (le repro déduplique désormais les hôtes : 4 sondés au lieu de 7)
```

*Audit technique : §8.4 ajoutée à `ANIME_DOWNLOAD_AUDIT.md`. Suite : 196/196
tests (19 fichiers).*
