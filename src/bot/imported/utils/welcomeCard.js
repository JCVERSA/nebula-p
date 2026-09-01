// Nebula Bot by Dark Neon
/**
 * welcomeCard.js — Générateur de carte Welcome/Goodbye style nébuleuse
 * Dépendances : sharp, axios (déjà dans package.json)
 *
 * Layout (900 x 380 px) :
 *   ┌─────────────────────────────────────────────┐
 *   │  ░░ fond nébuleuse + étoiles ░░             │
 *   │  ┌──────────┐   BIENVENUE                   │
 *   │  │  photo   │   Nom du membre               │
 *   │  │ (carré   │   ─────────────               │
 *   │  │  arrondi)│   🏠 Groupe · 👥 N membres    │
 *   │  └──────────┘                               │
 *   └─────────────────────────────────────────────┘
 */

'use strict';

const sharp = require('sharp');
const axios = require('axios');

// ── Dimensions ────────────────────────────────────────────────────────────────
const W       = 900;
const H       = 380;
const PP_SIZE = 220;   // taille photo de profil
const PP_X    = 60;    // left de la photo
const PP_Y    = (H - PP_SIZE) / 2;  // centrée verticalement
const RADIUS  = 36;    // arrondi du carré photo

// ── Palette nébuleuse ─────────────────────────────────────────────────────────
const C = {
  bg1:     '#04000d',
  bg2:     '#0f0225',
  neb1:    '#6600cc',
  neb2:    '#3a0099',
  neb3:    '#cc0099',
  neb4:    '#0044dd',
  neb5:    '#ff3399',
  accent:  '#cc44ff',
  gold:    '#ffe066',
  text:    '#f0eaff',
  sub:     '#bbaad8',
  border:  '#7722cc',
  divider: '#5511aa',
};

// ── Générateur d'étoiles déterministe ─────────────────────────────────────────
function genStars(count, w, h, seed = 7) {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
  return Array.from({ length: count }, () => {
    const x  = (rnd() * w).toFixed(1);
    const y  = (rnd() * h).toFixed(1);
    const r  = (rnd() * 1.6 + 0.2).toFixed(2);
    const op = (rnd() * 0.65 + 0.25).toFixed(2);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="white" opacity="${op}"/>`;
  }).join('');
}

// ── Échapper les caractères XML ───────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Tronquer ──────────────────────────────────────────────────────────────────
function trunc(s, max) {
  s = String(s || '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ── SVG de fond (background + texte, sans la photo) ──────────────────────────
function buildBackgroundSVG(opts, isGoodbye) {
  const { memberName, groupName, memberCount } = opts;

  const titleText  = isGoodbye ? 'AU REVOIR' : 'BIENVENUE';
  const titleColor = isGoodbye ? C.neb5 : C.accent;
  const subtitleTx = isGoodbye
    ? `vient de quitter ${esc(trunc(groupName, 22))}`
    : `vient de rejoindre ${esc(trunc(groupName, 22))}`;

  // Zone texte : commence après la photo
  const TX = PP_X + PP_SIZE + 60;   // x début texte
  const TW = W - TX - 40;           // largeur dispo texte

  // Nom : si c'est un numéro brut → afficher "+XXXXXX" proprement
  const isPhoneNumber = /^\d{6,}$/.test(String(memberName || '').trim());
  const displayedName = isPhoneNumber
    ? '+' + String(memberName).replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3')
    : memberName;
  const nameRaw  = esc(trunc(displayedName, 22));
  const nameFsz  = isPhoneNumber ? 30 : (nameRaw.length > 14 ? 38 : 46);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <!-- Dégradé fond principal -->
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="${C.bg1}"/>
      <stop offset="50%"  stop-color="${C.bg2}"/>
      <stop offset="100%" stop-color="#0a0020"/>
    </linearGradient>

    <!-- Lueur titre -->
    <filter id="glow" x="-30%" y="-50%" width="160%" height="200%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>

    <!-- Lueur douce pour le nom -->
    <filter id="softglow" x="-20%" y="-50%" width="140%" height="200%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>

    <!-- Clip arrondi pour la photo -->
    <clipPath id="ppClip">
      <rect x="${PP_X}" y="${PP_Y}" width="${PP_SIZE}" height="${PP_SIZE}" rx="${RADIUS}" ry="${RADIUS}"/>
    </clipPath>

    <!-- Masque pour le placeholder photo (si pas de PP) -->
    <linearGradient id="ppGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="${C.neb1}"/>
      <stop offset="100%" stop-color="${C.neb3}"/>
    </linearGradient>
  </defs>

  <!-- ── Fond ─────────────────────────────────────────────────────── -->
  <rect width="${W}" height="${H}" fill="url(#bgGrad)"/>

  <!-- ── Nuages de nébuleuse ──────────────────────────────────────── -->
  <ellipse cx="${W * 0.12}" cy="${H * 0.25}" rx="210" ry="130" fill="${C.neb1}" opacity="0.15"/>
  <ellipse cx="${W * 0.88}" cy="${H * 0.75}" rx="230" ry="150" fill="${C.neb3}" opacity="0.11"/>
  <ellipse cx="${W * 0.55}" cy="${H * 0.10}" rx="280" ry="110" fill="${C.neb2}" opacity="0.18"/>
  <ellipse cx="${W * 0.80}" cy="${H * 0.30}" rx="140" ry="90"  fill="${C.neb4}" opacity="0.10"/>
  <ellipse cx="${W * 0.30}" cy="${H * 0.85}" rx="180" ry="80"  fill="${C.neb2}" opacity="0.13"/>
  <ellipse cx="${W * 0.65}" cy="${H * 0.90}" rx="160" ry="70"  fill="${C.neb5}" opacity="0.07"/>

  <!-- ── Étoiles ──────────────────────────────────────────────────── -->
  ${genStars(180, W, H, 42)}

  <!-- ── Ligne verticale décorative séparatrice ───────────────────── -->
  <line x1="${TX - 25}" y1="40" x2="${TX - 25}" y2="${H - 40}"
        stroke="${C.divider}" stroke-width="1.5" opacity="0.5"/>

  <!-- ── Coins décoratifs (cadre intérieur fin) ───────────────────── -->
  <rect x="14" y="14" width="${W - 28}" height="${H - 28}"
        rx="18" ry="18" fill="none"
        stroke="${C.border}" stroke-width="1" opacity="0.35"/>

  <!-- ── Placeholder photo (visible si la PP n'est pas chargée) ───── -->
  <rect x="${PP_X}" y="${PP_Y}" width="${PP_SIZE}" height="${PP_SIZE}"
        rx="${RADIUS}" ry="${RADIUS}" fill="url(#ppGrad)" opacity="0.25"/>

  <!-- ── Bordure photo ────────────────────────────────────────────── -->
  <rect x="${PP_X - 3}" y="${PP_Y - 3}" width="${PP_SIZE + 6}" height="${PP_SIZE + 6}"
        rx="${RADIUS + 3}" ry="${RADIUS + 3}" fill="none"
        stroke="${isGoodbye ? C.neb5 : C.accent}" stroke-width="2.5" opacity="0.8"/>

  <!-- ── Lueur derrière la photo ──────────────────────────────────── -->
  <rect x="${PP_X - 18}" y="${PP_Y - 18}" width="${PP_SIZE + 36}" height="${PP_SIZE + 36}"
        rx="${RADIUS + 18}" ry="${RADIUS + 18}" fill="none"
        stroke="${isGoodbye ? C.neb5 : C.neb1}" stroke-width="18" opacity="0.12"/>

  <!-- ── TITRE : BIENVENUE / AU REVOIR ────────────────────────────── -->
  <!-- Ombre/lueur -->
  <text x="${TX}" y="115"
        font-family="Arial Black, Arial" font-weight="900" font-size="52"
        fill="${titleColor}" opacity="0.25" filter="url(#glow)">${titleText}</text>
  <!-- Texte principal -->
  <text x="${TX}" y="112"
        font-family="Arial Black, Arial" font-weight="900" font-size="52"
        fill="${titleColor}" filter="url(#glow)"
        letter-spacing="4">${titleText}</text>

  <!-- ── Nom du membre ─────────────────────────────────────────────── -->
  <text x="${TX}" y="${112 + nameFsz + 18}"
        font-family="Arial, sans-serif" font-weight="700" font-size="${nameFsz}"
        fill="${C.text}" filter="url(#softglow)">${nameRaw}</text>

  <!-- ── Ligne de séparation sous le nom ──────────────────────────── -->
  <rect x="${TX}" y="${112 + nameFsz + 18 + 14}"
        width="${Math.min(TW, 340)}" height="2"
        rx="1" fill="${C.divider}" opacity="0.6"/>

  <!-- ── Sous-texte (vient de rejoindre / quitter) ─────────────────── -->
  <text x="${TX}" y="${112 + nameFsz + 18 + 14 + 32}"
        font-family="Arial, sans-serif" font-size="20"
        fill="${C.sub}" opacity="0.85">${subtitleTx}</text>

  <!-- ── Compteur membres ──────────────────────────────────────────── -->
  <text x="${TX}" y="${H - 80}"
        font-family="Arial, sans-serif" font-size="17" fill="${C.sub}" opacity="0.7">
    👥  Membre n° <tspan font-weight="700" fill="${C.text}">${memberCount}</tspan>
  </text>

  <!-- ── Footer ────────────────────────────────────────────────────── -->
  <rect x="0" y="${H - 46}" width="${W}" height="46"
        fill="black" opacity="0.35"/>
  <text x="${W / 2}" y="${H - 16}"
        text-anchor="middle" font-family="Arial, sans-serif" font-size="14"
        fill="${C.sub}" opacity="0.55" letter-spacing="2">
    ᴘᴏᴡᴇʀᴇᴅ ʙʏ Nebula Bot  ·  Dark Neon
  </text>

</svg>`;
}

// ── Photo de profil : télécharge + redimensionne + arrondi ────────────────────
async function buildAvatarLayer(ppUrl) {
  try {
    if (!ppUrl) throw new Error('no url');
    const res = await axios.get(ppUrl, { responseType: 'arraybuffer', timeout: 8000 });
    const raw = Buffer.from(res.data);

    // Masque carré arrondi SVG
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${PP_SIZE}" height="${PP_SIZE}">
         <rect x="0" y="0" width="${PP_SIZE}" height="${PP_SIZE}"
               rx="${RADIUS}" ry="${RADIUS}" fill="white"/>
       </svg>`
    );

    // Redimensionner la PP
    const resized = await sharp(raw)
      .resize(PP_SIZE, PP_SIZE, { fit: 'cover', position: 'center' })
      .toBuffer();

    // Appliquer le masque arrondi
    const masked = await sharp(resized)
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();

    return masked; // Buffer PNG avec transparence arrondie
  } catch {
    return null; // Pas de photo → on laisse le placeholder du SVG
  }
}

// ── Fonction principale ────────────────────────────────────────────────────────
/**
 * Génère la carte Welcome ou Goodbye
 * @param {object} opts
 * @param {string} opts.memberName    — nom du membre
 * @param {string} opts.memberNumber  — numéro WA
 * @param {string} opts.groupName     — nom du groupe
 * @param {number} opts.memberCount   — nombre de membres
 * @param {string} opts.ppUrl         — URL photo de profil (peut être null)
 * @param {boolean} [opts.isGoodbye]  — true pour carte goodbye
 * @returns {Promise<Buffer>} image PNG
 */
async function generateWelcomeCard(opts) {
  const { ppUrl, isGoodbye = false } = opts;

  // 1. Générer le SVG de fond
  const svgBg = buildBackgroundSVG(opts, isGoodbye);
  const bgBuf = Buffer.from(svgBg);

  // 2. Convertir le fond SVG en PNG
  const bgPng = await sharp(bgBuf).png().toBuffer();

  // 3. Télécharger et masquer la photo de profil
  const avatarBuf = await buildAvatarLayer(ppUrl);

  // 4. Composite : fond + photo
  const composites = [];
  if (avatarBuf) {
    composites.push({
      input: avatarBuf,
      top:   Math.round(PP_Y),
      left:  Math.round(PP_X),
    });
  }

  const finalBuf = await sharp(bgPng)
    .composite(composites)
    .png()
    .toBuffer();

  return finalBuf;
}

module.exports = { generateWelcomeCard };
