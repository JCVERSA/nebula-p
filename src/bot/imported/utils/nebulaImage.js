// Nebula Bot by Dark Neon
/**
 * nebulaImage.js — Générateur d'images style nébuleuse spatiale
 * Utilisé par .leaderboard et .groupstats
 * Dépendance : sharp (déjà dans package.json)
 */

const sharp = require('sharp');

// ── Palette nébuleuse ─────────────────────────────────────────────────────────
const COLORS = {
  bg1:      '#06010f',   // fond noir spatial
  bg2:      '#110422',   // fond violet très sombre
  nebula1:  '#6a00c8',   // violet nébuleuse
  nebula2:  '#3d00a0',   // bleu-violet profond
  nebula3:  '#c800a0',   // rose/magenta
  nebula4:  '#0066ff',   // bleu électrique
  star:     '#ffffff',   // étoiles blanches
  gold:     '#ffd700',   // or pour #1
  silver:   '#c0c0c0',   // argent pour #2
  bronze:   '#cd7f32',   // bronze pour #3
  text:     '#e8e0ff',   // texte blanc lavande
  subtext:  '#9988bb',   // texte secondaire
  accent:   '#cc44ff',   // accent violet vif
  bar_bg:   '#1a0a2e',   // fond barre
  bar_fill: '#8833ff',   // remplissage barre
  border:   '#4a1a7a',   // bordure
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function escXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max - 1) + '…' : str;
}

function rankColor(i) {
  if (i === 0) return COLORS.gold;
  if (i === 1) return COLORS.silver;
  if (i === 2) return COLORS.bronze;
  return COLORS.text;
}

function rankIcon(i) {
  if (i === 0) return '👑';
  if (i === 1) return '🥈';
  if (i === 2) return '🥉';
  return `#${i + 1}`;
}

// Génère N étoiles aléatoires (déterministe via seed)
function stars(count, w, h, seed = 42) {
  let s = seed;
  const rand = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
  return Array.from({ length: count }, () => {
    const x  = Math.floor(rand() * w);
    const y  = Math.floor(rand() * h);
    const r  = rand() * 1.5 + 0.3;
    const op = rand() * 0.7 + 0.3;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="white" opacity="${op.toFixed(2)}"/>`;
  }).join('');
}

// Nuages de nébuleuse (ellipses floutées)
function nebulaClouds(w, h) {
  return `
    <ellipse cx="${w * 0.15}" cy="${h * 0.3}"  rx="180" ry="120" fill="${COLORS.nebula1}" opacity="0.18"/>
    <ellipse cx="${w * 0.85}" cy="${h * 0.7}"  rx="200" ry="140" fill="${COLORS.nebula3}" opacity="0.14"/>
    <ellipse cx="${w * 0.5}"  cy="${h * 0.15}" rx="250" ry="100" fill="${COLORS.nebula2}" opacity="0.20"/>
    <ellipse cx="${w * 0.75}" cy="${h * 0.2}"  rx="120" ry="80"  fill="${COLORS.nebula4}" opacity="0.12"/>
    <ellipse cx="${w * 0.3}"  cy="${h * 0.8}"  rx="160" ry="90"  fill="${COLORS.nebula2}" opacity="0.16"/>
  `;
}

// Barre de progression SVG
function progressBar(x, y, w, h, pct, color = COLORS.bar_fill) {
  const filled = Math.max(4, Math.round(w * Math.min(pct, 1)));
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${COLORS.bar_bg}" opacity="0.7"/>
    <rect x="${x}" y="${y}" width="${filled}" height="${h}" rx="${h / 2}" fill="${color}" opacity="0.9"/>
  `;
}

// Télécharger une photo de profil (retourne buffer ou null)
async function fetchAvatar(url) {
  try {
    if (!url) return null;
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
    return Buffer.from(res.data);
  } catch {
    return null;
  }
}

// ── LEADERBOARD IMAGE ─────────────────────────────────────────────────────────

/**
 * Génère l'image leaderboard
 * @param {object} opts
 * @param {string} opts.groupName
 * @param {Array}  opts.members   — [{ name, msgs, media, pct, uid }]
 * @param {number} opts.total     — total messages aujourd'hui
 * @param {string} opts.period    — 'Aujourd\'hui' | 'Cette semaine'
 * @param {string} opts.peakHour  — ex: '20h00'
 * @returns {Buffer} image PNG
 */
async function generateLeaderboard({ groupName, members, total, period, peakHour }) {
  const W = 900;
  const ROW_H = 72;
  const HEADER_H = 130;
  const FOOTER_H = 60;
  const H = HEADER_H + members.length * ROW_H + FOOTER_H;
  const maxMsgs = members[0]?.msgs || 1;

  // ── Lignes membres ──
  const rows = members.map((m, i) => {
    const y      = HEADER_H + i * ROW_H;
    const yMid   = y + ROW_H / 2;
    const color  = rankColor(i);
    const icon   = rankIcon(i);
    const name   = escXml(truncate(m.name || m.uid?.split('@')[0] || '?', 18));
    const pct    = (m.msgs / maxMsgs);
    const barW   = 340;
    const barX   = 320;
    const barY   = yMid + 8;
    const barCol = i === 0 ? COLORS.gold : i === 1 ? COLORS.silver : i === 2 ? COLORS.bronze : COLORS.bar_fill;

    // Fond de ligne alternée
    const rowBg = i % 2 === 0
      ? `<rect x="0" y="${y}" width="${W}" height="${ROW_H}" fill="#0d0520" opacity="0.5"/>`
      : `<rect x="0" y="${y}" width="${W}" height="${ROW_H}" fill="#08010f" opacity="0.4"/>`;

    // Cercle rang
    const rankCircle = `
      <circle cx="36" cy="${yMid}" r="22" fill="${color}" opacity="0.2"/>
      <circle cx="36" cy="${yMid}" r="22" fill="none" stroke="${color}" stroke-width="1.5"/>
      <text x="36" y="${yMid + 5}" text-anchor="middle" font-family="Arial" font-size="${i < 3 ? 16 : 13}" fill="${color}">${i < 3 ? icon : icon}</text>
    `;

    // Avatar placeholder (cercle coloré avec initiale)
    const avatarColors = ['#6a00c8','#c800a0','#0066ff','#ff6600','#00cc88'];
    const avatarCol = avatarColors[i % avatarColors.length];
    const initial = escXml((m.name || '?').charAt(0).toUpperCase());
    const avatar = `
      <circle cx="90" cy="${yMid}" r="26" fill="${avatarCol}" opacity="0.3"/>
      <circle cx="90" cy="${yMid}" r="26" fill="none" stroke="${avatarCol}" stroke-width="1.5" opacity="0.7"/>
      <text x="90" y="${yMid + 7}" text-anchor="middle" font-family="Arial Bold" font-size="18" fill="white" opacity="0.9">${initial}</text>
    `;

    // Nom + stats
    const nameText = `<text x="130" y="${yMid - 6}" font-family="Arial" font-size="15" font-weight="bold" fill="${color}">${name}</text>`;
    const statsText = `<text x="130" y="${yMid + 12}" font-family="Arial" font-size="12" fill="${COLORS.subtext}">${m.msgs} msgs${m.media ? '  📎 ' + m.media : ''}</text>`;

    // Barre de progression
    const bar = progressBar(barX, barY - 7, barW, 10, pct, barCol);

    // Pourcentage
    const pctText = `<text x="${barX + barW + 12}" y="${barY + 3}" font-family="Arial" font-size="13" fill="${color}" font-weight="bold">${m.pct}%</text>`;

    return rowBg + rankCircle + avatar + nameText + statsText + bar + pctText;
  }).join('');

  // ── SVG complet ──
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="bg" cx="40%" cy="30%" r="80%">
        <stop offset="0%" stop-color="${COLORS.bg2}"/>
        <stop offset="100%" stop-color="${COLORS.bg1}"/>
      </radialGradient>
      <filter id="glow">
        <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
        <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>

    <!-- Fond -->
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    ${nebulaClouds(W, H)}
    ${stars(120, W, H, 77)}

    <!-- Bordure extérieure -->
    <rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="16" fill="none" stroke="${COLORS.border}" stroke-width="1.5" opacity="0.6"/>

    <!-- Header -->
    <rect x="0" y="0" width="${W}" height="${HEADER_H}" fill="#0e0222" opacity="0.7"/>
    <rect x="0" y="${HEADER_H - 2}" width="${W}" height="2" fill="${COLORS.accent}" opacity="0.5"/>

    <!-- Titre -->
    <text x="50" y="52" font-family="Arial" font-size="26" font-weight="bold" fill="${COLORS.accent}" filter="url(#glow)">🏆 LEADERBOARD</text>
    <text x="50" y="78" font-family="Arial" font-size="15" fill="${COLORS.subtext}">${escXml(truncate(groupName, 40))}</text>
    <text x="50" y="108" font-family="Arial" font-size="13" fill="${COLORS.text}">📅 ${escXml(period)}  ·  📨 ${total} messages${peakHour ? '  ·  🕐 Pic: ' + peakHour : ''}</text>

    <!-- Icône nébuleuse décorative header -->
    <circle cx="${W - 60}" cy="65" r="40" fill="${COLORS.nebula1}" opacity="0.15"/>
    <text x="${W - 60}" y="76" text-anchor="middle" font-size="36">🌌</text>

    <!-- Lignes membres -->
    ${rows}

    <!-- Footer -->
    <rect x="0" y="${H - FOOTER_H}" width="${W}" height="${FOOTER_H}" fill="#0a011a" opacity="0.8"/>
    <rect x="0" y="${H - FOOTER_H}" width="${W}" height="1" fill="${COLORS.accent}" opacity="0.3"/>
    <text x="${W / 2}" y="${H - 22}" text-anchor="middle" font-family="Arial" font-size="13" fill="${COLORS.subtext}">✨ Nebula Bot  ·  by Dark Neon</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── GROUPSTATS IMAGE ──────────────────────────────────────────────────────────

/**
 * Génère l'image groupstats
 * @param {object} opts
 * @param {string} opts.groupName
 * @param {number} opts.total      — total messages aujourd'hui
 * @param {number} opts.media      — total médias
 * @param {number} opts.commands   — total commandes
 * @param {string} opts.peakHour   — ex: '20h00 (45 msgs)'
 * @param {Array}  opts.topMembers — [{ name, msgs, pct }] top 5
 * @param {Array}  opts.hourlyData — [{ hour, count }] 24h
 * @returns {Buffer} image PNG
 */
async function generateGroupStats({ groupName, total, media, commands, peakHour, topMembers, hourlyData }) {
  const W = 900;
  const H = 520;
  const maxMsgs = topMembers[0]?.msgs || 1;

  // ── Graphe horaire (mini barres) ──
  const chartX = 50, chartY = 290, chartW = 800, chartH = 120;
  const maxHour = Math.max(...(hourlyData.map(h => h.count)), 1);
  const barW = Math.floor(chartW / 24) - 2;

  const hourBars = hourlyData.map(({ hour, count }) => {
    const bh  = count > 0 ? Math.max(4, Math.round((count / maxHour) * chartH)) : 2;
    const bx  = chartX + hour * (barW + 2);
    const by  = chartY + chartH - bh;
    const col = count === maxHour && count > 0 ? COLORS.gold : COLORS.bar_fill;
    const opacity = count > 0 ? '0.85' : '0.2';
    return `
      <rect x="${bx}" y="${by}" width="${barW}" height="${bh}" rx="2" fill="${col}" opacity="${opacity}"/>
      ${hour % 6 === 0 ? `<text x="${bx + barW / 2}" y="${chartY + chartH + 16}" text-anchor="middle" font-family="Arial" font-size="10" fill="${COLORS.subtext}">${hour}h</text>` : ''}
    `;
  }).join('');

  // ── Top 5 membres (barres horizontales) ──
  const topY = 120;
  const topRows = topMembers.slice(0, 5).map((m, i) => {
    const y     = topY + i * 28;
    const barX  = 280;
    const barW2 = 380;
    const col   = rankColor(i);
    const name  = escXml(truncate(m.name || '?', 16));
    const pct   = m.msgs / maxMsgs;
    return `
      <text x="50" y="${y + 14}" font-family="Arial" font-size="13" font-weight="bold" fill="${col}">${rankIcon(i)}</text>
      <text x="75" y="${y + 14}" font-family="Arial" font-size="13" fill="${COLORS.text}">${name}</text>
      <text x="${barX - 10}" y="${y + 14}" font-family="Arial" font-size="12" fill="${COLORS.subtext}" text-anchor="end">${m.msgs}</text>
      ${progressBar(barX, y + 3, barW2, 12, pct, col)}
      <text x="${barX + barW2 + 8}" y="${y + 14}" font-family="Arial" font-size="11" fill="${col}">${m.pct}%</text>
    `;
  }).join('');

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="bg" cx="60%" cy="20%" r="90%">
        <stop offset="0%" stop-color="#120330"/>
        <stop offset="100%" stop-color="${COLORS.bg1}"/>
      </radialGradient>
    </defs>

    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    ${nebulaClouds(W, H)}
    ${stars(100, W, H, 123)}
    <rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="16" fill="none" stroke="${COLORS.border}" stroke-width="1.5" opacity="0.5"/>

    <!-- Header -->
    <rect x="0" y="0" width="${W}" height="105" fill="#0d0220" opacity="0.75"/>
    <rect x="0" y="104" width="${W}" height="2" fill="${COLORS.accent}" opacity="0.4"/>

    <text x="50" y="44" font-family="Arial" font-size="24" font-weight="bold" fill="${COLORS.accent}">📊 GROUP STATS</text>
    <text x="50" y="68" font-family="Arial" font-size="14" fill="${COLORS.subtext}">${escXml(truncate(groupName, 45))}</text>

    <!-- Stats résumé -->
    <text x="50"  y="94" font-family="Arial" font-size="13" fill="${COLORS.text}">📨 ${total} msgs</text>
    <text x="200" y="94" font-family="Arial" font-size="13" fill="${COLORS.text}">📎 ${media} médias</text>
    <text x="370" y="94" font-family="Arial" font-size="13" fill="${COLORS.text}">⚡ ${commands} cmds</text>
    ${peakHour ? `<text x="540" y="94" font-family="Arial" font-size="13" fill="${COLORS.gold}">🕐 Pic: ${escXml(peakHour)}</text>` : ''}

    <!-- Décoration header -->
    <text x="${W - 65}" y="70" font-size="42">🌌</text>

    <!-- Top membres -->
    <text x="50" y="${topY - 10}" font-family="Arial" font-size="14" font-weight="bold" fill="${COLORS.accent}">🏆 Top membres</text>
    ${topRows}

    <!-- Séparateur graphe -->
    <rect x="50" y="${chartY - 24}" width="${chartW}" height="1" fill="${COLORS.border}" opacity="0.5"/>
    <text x="50" y="${chartY - 8}" font-family="Arial" font-size="13" font-weight="bold" fill="${COLORS.accent}">📈 Activité horaire</text>

    <!-- Graphe horaire -->
    <rect x="${chartX - 4}" y="${chartY}" width="${chartW + 8}" height="${chartH}" rx="6" fill="#06010f" opacity="0.5"/>
    ${hourBars}

    <!-- Footer -->
    <rect x="0" y="${H - 36}" width="${W}" height="36" fill="#08011a" opacity="0.8"/>
    <text x="${W / 2}" y="${H - 13}" text-anchor="middle" font-family="Arial" font-size="12" fill="${COLORS.subtext}">✨ Nebula Bot  ·  by Dark Neon</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { generateLeaderboard, generateGroupStats };
