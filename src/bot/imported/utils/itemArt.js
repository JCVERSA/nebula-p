/**
 * itemArt.js — Bibliothèque d'illustrations SVG pour les items Nebula
 * Design : Géométrique, épuré, style "RPG moderne"
 */

'use strict';

const C = {
  iron:    '#94a3b8',
  steel:   '#cbd5e1',
  gold:    '#f59e0b',
  wood:    '#78350f',
  cloth:   '#475569',
  energy:  '#06b6d4',
  danger:  '#ef4444',
  success: '#10b981',
  violet:  '#7c3aed',
  white:   '#ffffff',
  black:   '#000000',
  cyan:    '#22d3ee',
  purple:  '#a78bfa',
};

/**
 * Retourne un fragment SVG (sans balise <svg>) pour l'item demandé
 * @param {string} itemId 
 * @param {number} w Largeur cible
 * @param {number} h Hauteur cible
 */
function getItemArtSVG(itemId, w = 150, h = 160) {
  const cx = w / 2;
  const cy = h / 2;

  const arts = {
    // ── ARMES ───────────────────────────────────────────────────────────────
    dagger: `
      <path d="M ${cx} ${cy - 50} L ${cx + 15} ${cy} L ${cx} ${cy + 10} L ${cx - 15} ${cy} Z" fill="${C.steel}"/>
      <rect x="${cx - 12}" y="${cy + 10}" width="24" height="6" rx="2" fill="${C.iron}"/>
      <rect x="${cx - 5}" y="${cy + 16}" width="10" height="25" rx="2" fill="${C.wood}"/>
      <path d="M ${cx} ${cy - 50} L ${cx + 7} ${cy} L ${cx} ${cy + 10} Z" fill="white" opacity="0.3"/>
    `,
    sword: `
      <path d="M ${cx} ${cy - 70} L ${cx + 20} ${cy} L ${cx} ${cy + 15} L ${cx - 20} ${cy} Z" fill="${C.steel}"/>
      <rect x="${cx - 25}" y="${cy + 15}" width="50" height="8" rx="2" fill="${C.iron}"/>
      <rect x="${cx - 6}" y="${cy + 23}" width="12" height="35" rx="3" fill="${C.wood}"/>
      <circle cx="${cx}" cy="${cy + 58}" r="8" fill="${C.iron}"/>
      <path d="M ${cx} ${cy - 70} L ${cx + 10} ${cy} L ${cx} ${cy + 15} Z" fill="white" opacity="0.3"/>
    `,
    axe: `
      <rect x="${cx - 4}" y="${cy - 60}" width="8" height="120" rx="4" fill="${C.wood}"/>
      <path d="M ${cx + 4} ${cy - 40} Q ${cx + 50} ${cy - 20} ${cx + 4} ${cy} Z" fill="${C.iron}"/>
      <path d="M ${cx - 4} ${cy - 40} Q ${cx - 50} ${cy - 20} ${cx - 4} ${cy} Z" fill="${C.iron}"/>
      <path d="M ${cx + 4} ${cy - 35} Q ${cx + 40} ${cy - 20} ${cx + 4} ${cy - 5} Z" fill="white" opacity="0.3"/>
    `,
    katana: `
      <path d="M ${cx + 30} ${cy - 70} Q ${cx - 10} ${cy - 20} ${cx - 20} ${cy + 20}" fill="none" stroke="${C.steel}" stroke-width="12" stroke-linecap="round"/>
      <path d="M ${cx + 25} ${cy - 65} Q ${cx - 15} ${cy - 15} ${cx - 25} ${cy + 15}" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" opacity="0.5"/>
      <circle cx="${cx - 22}" cy="${cy + 25}" r="15" fill="${C.iron}" stroke="${C.black}" stroke-width="2"/>
      <path d="M ${cx - 25} ${cy + 30} L ${cx - 45} ${cy + 60}" fill="none" stroke="${C.black}" stroke-width="14" stroke-linecap="round"/>
    `,
    pistol: `
      <rect x="${cx - 40}" y="${cy - 20}" width="70" height="25" rx="5" fill="${C.black}"/>
      <rect x="${cx - 5}" y="${cy - 5}" width="20" height="50" rx="5" fill="${C.black}" transform="rotate(-15 ${cx} ${cy})"/>
      <rect x="${cx - 40}" y="${cy - 10}" width="70" height="5" fill="${C.iron}" opacity="0.2"/>
      <circle cx="${cx - 30}" cy="${cy - 5}" r="3" fill="${C.danger}"/>
    `,
    ak47: `
      <rect x="${cx - 60}" y="${cy - 20}" width="120" height="15" rx="2" fill="${C.black}"/>
      <rect x="${cx - 10}" y="${cy - 5}" width="15" height="40" rx="2" fill="${C.black}"/>
      <path d="M ${cx + 5} ${cy + 5} Q ${cx + 25} ${cy + 50} ${cx + 45} ${cy + 5}" fill="none" stroke="${C.black}" stroke-width="15" stroke-linecap="round"/>
      <rect x="${cx - 80}" y="${cy - 15}" width="30" height="25" rx="5" fill="${C.wood}"/>
    `,
    sniper: `
      <rect x="${cx - 75}" y="${cy - 10}" width="150" height="10" rx="2" fill="${C.black}"/>
      <rect x="${cx - 10}" y="${cy - 25}" width="30" height="15" rx="5" fill="${C.black}"/>
      <line x1="${cx - 5}" y1="${cy - 25}" x2="${cx - 5}" y2="${cy - 35}" stroke="${C.black}" stroke-width="4"/>
      <line x1="${cx + 15}" y1="${cy - 25}" x2="${cx + 15}" y2="${cy - 35}" stroke="${C.black}" stroke-width="4"/>
      <rect x="${cx - 30}" y="${cy}" width="40" height="30" rx="2" fill="${C.black}" transform="rotate(-20 ${cx} ${cy})"/>
    `,
    grenade: `
      <ellipse cx="${cx}" cy="${cy + 10}" rx="35" ry="45" fill="${C.iron}"/>
      <rect x="${cx - 10}" y="${cy - 45}" width="20" height="20" fill="${C.black}"/>
      <circle cx="${cx + 15}" cy="${cy - 40}" r="12" fill="none" stroke="${C.iron}" stroke-width="4"/>
      <path d="M ${cx - 20} ${cy} L ${cx + 20} ${cy} M ${cx} ${cy - 20} L ${cx} ${cy + 30}" stroke="${C.black}" stroke-width="2" opacity="0.3"/>
    `,
    bazooka: `
      <rect x="${cx - 70}" y="${cy - 20}" width="140" height="35" rx="5" fill="${C.iron}"/>
      <rect x="${cx + 40}" y="${cy - 25}" width="35" height="45" rx="5" fill="none" stroke="${C.black}" stroke-width="8"/>
      <rect x="${cx - 30}" y="${cy + 15}" width="15" height="30" rx="2" fill="${C.black}"/>
      <path d="M ${cx - 60} ${cy} L ${cx + 60} ${cy}" stroke="white" stroke-width="2" opacity="0.2"/>
    `,
    rasengan: `
      <circle cx="${cx}" cy="${cy}" r="50" fill="none" stroke="${C.cyan}" stroke-width="2" opacity="0.5"/>
      <circle cx="${cx}" cy="${cy}" r="35" fill="none" stroke="${C.cyan}" stroke-width="4" opacity="0.7"/>
      <circle cx="${cx}" cy="${cy}" r="20" fill="${C.white}"/>
      <path d="M ${cx} ${cy-45} A 45 45 0 0 1 ${cx+45} ${cy}" fill="none" stroke="${C.cyan}" stroke-width="8" stroke-linecap="round"/>
      <path d="M ${cx} ${cy+45} A 45 45 0 0 1 ${cx-45} ${cy}" fill="none" stroke="${C.cyan}" stroke-width="8" stroke-linecap="round"/>
    `,
    chidori: `
      <path d="M ${cx} ${cy - 60} L ${cx - 20} ${cy} L ${cx + 10} ${cy} L ${cx - 10} ${cy + 60} L ${cx + 20} ${cy} L ${cx - 10} ${cy} Z" fill="${C.cyan}"/>
      <path d="M ${cx} ${cy - 50} L ${cx - 10} ${cy} L ${cx + 5} ${cy} L ${cx - 5} ${cy + 50} L ${cx + 10} ${cy} L ${cx - 5} ${cy} Z" fill="${C.white}"/>
      <circle cx="${cx}" cy="${cy}" r="30" fill="${C.cyan}" opacity="0.2">
        <animate attributeName="opacity" values="0.2;0.5;0.2" dur="1s" repeatCount="indefinite"/>
      </circle>
    `,
    getsuga: `
      <path d="M ${cx - 60} ${cy} Q ${cx} ${cy - 80} ${cx + 60} ${cy} Q ${cx} ${cy - 20} ${cx - 60} ${cy}" fill="${C.black}"/>
      <path d="M ${cx - 50} ${cy - 5} Q ${cx} ${cy - 65} ${cx + 50} ${cy - 5}" fill="none" stroke="${C.danger}" stroke-width="4" opacity="0.6"/>
      <path d="M ${cx - 70} ${cy + 10} L ${cx + 70} ${cy + 40}" fill="none" stroke="${C.black}" stroke-width="15" opacity="0.3" stroke-linecap="round"/>
    `,
    atomic: `
      <circle cx="${cx}" cy="${cy}" r="20" fill="${C.danger}"/>
      <path d="M ${cx} ${cy - 55} L ${cx} ${cy + 55} M ${cx - 55} ${cy} L ${cx + 55} ${cy}" stroke="${C.gold}" stroke-width="8" opacity="0.8"/>
      <circle cx="${cx}" cy="${cy}" r="45" fill="none" stroke="${C.gold}" stroke-width="5" stroke-dasharray="20 10"/>
      <circle cx="${cx}" cy="${cy}" r="10" fill="${C.white}"/>
    `,
    caca: `
      <path d="M ${cx} ${cy + 40} Q ${cx + 50} ${cy + 40} ${cx + 40} ${cy} Q ${cx + 30} ${cy - 30} ${cx} ${cy - 30} Q ${cx - 30} ${cy - 30} ${cx - 40} ${cy} Q ${cx - 50} ${cy + 40} ${cx} ${cy + 40}" fill="#78350f"/>
      <path d="M ${cx} ${cy + 10} Q ${cx + 30} ${cy + 10} ${cx + 25} ${cy - 10} Q ${cx} ${cy - 30} ${cx - 25} ${cy - 10} Q ${cx - 30} ${cy + 10} ${cx} ${cy + 10}" fill="#92400e" opacity="0.5"/>
      <circle cx="${cx - 15}" cy="${cy}" r="5" fill="white"/>
      <circle cx="${cx + 15}" cy="${cy}" r="5" fill="white"/>
    `,

    // ── ARMURES ─────────────────────────────────────────────────────────────
    leather: `
      <path d="M ${cx - 40} ${cy - 50} L ${cx + 40} ${cy - 50} L ${cx + 50} ${cy + 40} L ${cx - 50} ${cy + 40} Z" fill="${C.wood}"/>
      <rect x="${cx - 10}" y="${cy - 50}" width="20" height="90" fill="${C.black}" opacity="0.2"/>
      <line x1="${cx - 30}" y1="${cy - 20}" x2="${cx - 30}" y2="${cy + 20}" stroke="${C.black}" stroke-width="2"/>
      <line x1="${cx + 30}" y1="${cy - 20}" x2="${cx + 30}" y2="${cy + 20}" stroke="${C.black}" stroke-width="2"/>
    `,
    helmet: `
      <path d="M ${cx - 45} ${cy + 20} A 45 45 0 1 1 ${cx + 45} ${cy + 20} Z" fill="${C.iron}"/>
      <rect x="${cx - 40}" y="${cy}" width="80" height="15" rx="5" fill="${C.black}" opacity="0.6"/>
      <path d="M ${cx - 45} ${cy - 10} Q ${cx} ${cy - 60} ${cx + 45} ${cy - 10}" fill="none" stroke="white" stroke-width="3" opacity="0.3"/>
    `,
    shield2: `
      <path d="M ${cx} ${cy + 55} L ${cx - 45} ${cy + 10} L ${cx - 45} ${cy - 45} L ${cx + 45} ${cy - 45} L ${cx + 45} ${cy + 10} Z" fill="${C.iron}"/>
      <path d="M ${cx} ${cy + 40} L ${cx - 30} ${cy + 5} L ${cx - 30} ${cy - 30} L ${cx + 30} ${cy - 30} L ${cx + 30} ${cy + 5} Z" fill="${C.violet}" opacity="0.5"/>
      <path d="M ${cx} ${cy - 15} L ${cx - 10} ${cy + 10} L ${cx + 10} ${cy + 10} Z" fill="white"/>
    `,
    armor: `
      <path d="M ${cx - 50} ${cy - 40} L ${cx - 30} ${cy - 60} L ${cx + 30} ${cy - 60} L ${cx + 50} ${cy - 40} L ${cx + 40} ${cy + 50} L ${cx - 40} ${cy + 50} Z" fill="${C.steel}"/>
      <path d="M ${cx - 30} ${cy - 60} Q ${cx} ${cy - 20} ${cx + 30} ${cy - 60}" fill="none" stroke="${C.black}" stroke-width="5" opacity="0.3"/>
      <rect x="${cx - 35}" y="${cy - 10}" width="70" height="8" rx="2" fill="${C.black}" opacity="0.1"/>
      <rect x="${cx - 35}" y="${cy + 10}" width="70" height="8" rx="2" fill="${C.black}" opacity="0.1"/>
    `,
    titanium: `
      <path d="M ${cx} ${cy - 60} L ${cx + 50} ${cy - 30} L ${cx + 50} ${cy + 30} L ${cx} ${cy + 60} L ${cx - 50} ${cy + 30} L ${cx - 50} ${cy - 30} Z" fill="${C.cyan}" opacity="0.4"/>
      <path d="M ${cx} ${cy - 50} L ${cx + 40} ${cy - 25} L ${cx + 40} ${cy + 25} L ${cx} ${cy + 50} L ${cx - 40} ${cy + 25} L ${cx - 40} ${cy - 25} Z" fill="none" stroke="${C.cyan}" stroke-width="4"/>
      <path d="M ${cx} ${cy - 20} L ${cx + 15} ${cy} L ${cx} ${cy + 20} L ${cx - 15} ${cy} Z" fill="white"/>
    `,
    godshield: `
      <circle cx="${cx}" cy="${cy}" r="60" fill="url(#godGrad)"/>
      <defs>
        <radialGradient id="godGrad">
          <stop offset="0%" stop-color="${C.white}"/>
          <stop offset="70%" stop-color="${C.gold}"/>
          <stop offset="100%" stop-color="${C.gold}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <path d="M ${cx} ${cy - 40} L ${cx + 35} ${cy + 20} L ${cx - 35} ${cy + 20} Z" fill="${C.white}" opacity="0.8"/>
      <circle cx="${cx}" cy="${cy}" r="50" fill="none" stroke="${C.gold}" stroke-width="4" stroke-dasharray="5 10"/>
    `,

    // ── ÉCONOMIE ────────────────────────────────────────────────────────────
    pickaxe: `
      <rect x="${cx - 3}" y="${cy - 10}" width="6" height="70" rx="3" fill="${C.wood}"/>
      <path d="M ${cx - 50} ${cy - 30} Q ${cx} ${cy + 10} ${cx + 50} ${cy - 30}" fill="none" stroke="${C.iron}" stroke-width="12" stroke-linecap="round"/>
      <path d="M ${cx - 45} ${cy - 25} Q ${cx} ${cy + 5} ${cx + 45} ${cy - 25}" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" opacity="0.4"/>
    `,
    lucky: `
      <path d="M ${cx} ${cy} Q ${cx+30} ${cy-30} ${cx} ${cy-50} Q ${cx-30} ${cy-30} ${cx} ${cy} Z" fill="${C.success}"/>
      <path d="M ${cx} ${cy} Q ${cx+30} ${cy+30} ${cx} ${cy+50} Q ${cx-30} ${cy+30} ${cx} ${cy} Z" fill="${C.success}"/>
      <path d="M ${cx} ${cy} Q ${cx-30} ${cy+30} ${cx-50} ${cy} Q ${cx-30} ${cy-30} ${cx} ${cy} Z" fill="${C.success}"/>
      <path d="M ${cx} ${cy} Q ${cx+30} ${cy+30} ${cx+50} ${cy} Q ${cx+30} ${cy-30} ${cx} ${cy} Z" fill="${C.success}"/>
      <circle cx="${cx}" cy="${cy}" r="5" fill="white" opacity="0.5"/>
    `,
    boost: `
      <circle cx="${cx}" cy="${cy}" r="45" fill="none" stroke="${C.violet}" stroke-width="5"/>
      <path d="M ${cx - 10} ${cy - 30} L ${cx - 20} ${cy + 5} L ${cx} ${cy + 5} L ${cx - 5} ${cy + 35} L ${cx + 25} ${cy - 5} L ${cx + 5} ${cy - 5} L ${cx + 15} ${cy - 30} Z" fill="${C.violet}"/>
      <path d="M ${cx - 5} ${cy - 25} L ${cx - 15} ${cy + 0} L ${cx + 5} ${cy + 0} L ${cx + 0} ${cy + 25} L ${cx + 20} ${cy - 10} L ${cx + 0} ${cy - 10} L ${cx + 10} ${cy - 25} Z" fill="white" opacity="0.5"/>
    `,
    robbery: `
      <path d="M ${cx - 50} ${cy - 20} Q ${cx} ${cy - 40} ${cx + 50} ${cy - 20} L ${cx + 40} ${cy + 20} Q ${cx} ${cy + 10} ${cx - 40} ${cy + 20} Z" fill="${C.black}"/>
      <circle cx="${cx - 20}" cy="${cy}" r="12" fill="${C.white}"/>
      <circle cx="${cx + 20}" cy="${cy}" r="12" fill="${C.white}"/>
      <circle cx="${cx - 20}" cy="${cy}" r="6" fill="${C.black}"/>
      <circle cx="${cx + 20}" cy="${cy}" r="6" fill="${C.black}"/>
    `,
    shield: `
      <path d="M ${cx} ${cy + 50} Q ${cx + 45} ${cy + 30} ${cx + 45} ${cy - 30} L ${cx - 45} ${cy - 30} Q ${cx - 45} ${cy + 30} ${cx} ${cy + 50}" fill="${C.energy}"/>
      <path d="M ${cx} ${cy - 10} L ${cx - 15} ${cy + 15} L ${cx + 15} ${cy + 15} Z" fill="white" opacity="0.8"/>
    `,
    vault: `
      <circle cx="${cx}" cy="${cy}" r="55" fill="${C.iron}"/>
      <circle cx="${cx}" cy="${cy}" r="45" fill="none" stroke="${C.black}" stroke-width="2"/>
      <circle cx="${cx}" cy="${cy}" r="15" fill="${C.black}"/>
      <rect x="${cx - 20}" y="${cy - 3}" width="40" height="6" fill="white" opacity="0.5"/>
      <rect x="${cx - 3}" y="${cy - 20}" width="6" height="40" fill="white" opacity="0.5"/>
    `,

    // ── POUVOIRS ────────────────────────────────────────────────────────────
    healing: `
      <circle cx="${cx}" cy="${cy}" r="45" fill="${C.success}" opacity="0.2"/>
      <rect x="${cx - 10}" y="${cy - 35}" width="20" height="70" rx="5" fill="${C.success}"/>
      <rect x="${cx - 35}" y="${cy - 10}" width="70" height="20" rx="5" fill="${C.success}"/>
    `,
    super_heal: `
      <path d="M ${cx - 20} ${cy + 40} L ${cx + 20} ${cy + 40} L ${cx + 30} ${cy - 20} L ${cx - 30} ${cy - 20} Z" fill="${C.cyan}"/>
      <rect x="${cx - 15}" y="${cy - 40}" width="30" height="20" rx="5" fill="${C.iron}"/>
      <circle cx="${cx}" cy="${cy + 10}" r="10" fill="white" opacity="0.6"/>
      <path d="M ${cx - 20} ${cy + 10} Q ${cx} ${cy - 10} ${cx + 20} ${cy + 10}" fill="none" stroke="white" stroke-width="2" opacity="0.4"/>
    `,
    revive_power: `
      <path d="M ${cx} ${cy - 50} Q ${cx + 40} ${cy} ${cx} ${cy + 50} Q ${cx - 40} ${cy} ${cx} ${cy - 50}" fill="${C.gold}"/>
      <path d="M ${cx} ${cy - 30} L ${cx + 20} ${cy + 10} L ${cx - 20} ${cy + 10} Z" fill="${C.danger}"/>
      <circle cx="${cx}" cy="${cy - 10}" r="15" fill="white" opacity="0.3"/>
    `,
    chance_power: `
      <circle cx="${cx}" cy="${cy}" r="50" fill="none" stroke="${C.danger}" stroke-width="10"/>
      <circle cx="${cx}" cy="${cy}" r="30" fill="none" stroke="${C.white}" stroke-width="10"/>
      <circle cx="${cx}" cy="${cy}" r="10" fill="${C.danger}"/>
      <path d="M ${cx + 40} ${cy - 40} L ${cx} ${cy}" stroke="${C.black}" stroke-width="5" stroke-linecap="round"/>
    `,
    sharingan: `
      <circle cx="${cx}" cy="${cy}" r="45" fill="${C.danger}"/>
      <circle cx="${cx}" cy="${cy}" r="10" fill="${C.black}"/>
      <path d="M ${cx} ${cy - 30} Q ${cx + 20} ${cy - 20} ${cx + 10} ${cy}" fill="none" stroke="${C.black}" stroke-width="5" stroke-linecap="round"/>
      <path d="M ${cx - 25} ${cy + 15} Q ${cx - 15} ${cy + 25} ${cx} ${cy + 15}" fill="none" stroke="${C.black}" stroke-width="5" stroke-linecap="round"/>
      <path d="M ${cx + 25} ${cy + 15} Q ${cx + 15} ${cy + 25} ${cx} ${cy + 15}" fill="none" stroke="${C.black}" stroke-width="5" stroke-linecap="round"/>
    `,
    invisible: `
      <path d="M ${cx} ${cy - 50} Q ${cx + 30} ${cy - 50} ${cx + 30} ${cy} L ${cx - 30} ${cy} Q ${cx - 30} ${cy - 50} ${cx} ${cy - 50}" fill="none" stroke="${C.iron}" stroke-width="2" stroke-dasharray="5 5"/>
      <circle cx="${cx}" cy="${cy - 20}" r="15" fill="none" stroke="${C.iron}" stroke-width="2" stroke-dasharray="3 3"/>
    `,
    poison_power: `
      <circle cx="${cx}" cy="${cy}" r="40" fill="${C.success}" opacity="0.3"/>
      <path d="M ${cx - 20} ${cy - 10} Q ${cx} ${cy - 40} ${cx + 20} ${cy - 10} L ${cx + 15} ${cy + 20} L ${cx - 15} ${cy + 20} Z" fill="${C.white}"/>
      <circle cx="${cx - 8}" cy="${cy}" r="4" fill="${C.black}"/>
      <circle cx="${cx + 8}" cy="${cy}" r="4" fill="${C.black}"/>
    `,
    regeneration: `
      <path d="M ${cx} ${cy + 40} Q ${cx + 40} ${cy} ${cx} ${cy - 50} Q ${cx - 40} ${cy} ${cx} ${cy + 40}" fill="${C.success}"/>
      <line x1="${cx}" y1="${cy + 40}" x2="${cx}" y2="${cy - 30}" stroke="white" stroke-width="2" opacity="0.4"/>
      <path d="M ${cx} ${cy} L ${cx + 20} ${cy - 10} M ${cx} ${cy + 15} L ${cx - 15} ${cy + 5}" stroke="white" stroke-width="1.5" opacity="0.4"/>
    `,
    berserker: `
      <circle cx="${cx}" cy="${cy}" r="45" fill="${C.danger}" opacity="0.2"/>
      <path d="M ${cx - 25} ${cy - 10} Q ${cx - 15} ${cy - 25} ${cx - 5} ${cy - 10}" fill="none" stroke="${C.danger}" stroke-width="5" stroke-linecap="round"/>
      <path d="M ${cx + 25} ${cy - 10} Q ${cx + 15} ${cy - 25} ${cx + 5} ${cy - 10}" fill="none" stroke="${C.danger}" stroke-width="5" stroke-linecap="round"/>
      <path d="M ${cx - 20} ${cy + 20} Q ${cx} ${cy + 40} ${cx + 20} ${cy + 20}" fill="none" stroke="${C.danger}" stroke-width="8" stroke-linecap="round"/>
    `,
    barrier: `
      <path d="M ${cx} ${cy - 55} L ${cx + 48} ${cy - 27} L ${cx + 48} ${cy + 27} L ${cx} ${cy + 55} L ${cx - 48} ${cy + 27} L ${cx - 48} ${cy - 27} Z" fill="${C.cyan}" opacity="0.3"/>
      <path d="M ${cx} ${cy - 45} L ${cx + 38} ${cy - 22} L ${cx + 38} ${cy + 22} L ${cx} ${cy + 45} L ${cx - 38} ${cy + 22} L ${cx - 38} ${cy - 22} Z" fill="none" stroke="${C.white}" stroke-width="2" opacity="0.6"/>
    `,
    time_stop: `
      <path d="M ${cx - 30} ${cy - 50} L ${cx + 30} ${cy - 50} L ${cx} ${cy} L ${cx + 30} ${cy + 50} L ${cx - 30} ${cy + 50} L ${cx} ${cy} Z" fill="${C.iron}"/>
      <rect x="${cx - 35}" y="${cy - 55}" width="70" height="8" rx="2" fill="${C.black}"/>
      <rect x="${cx - 35}" y="${cy + 47}" width="70" height="8" rx="2" fill="${C.black}"/>
      <circle cx="${cx}" cy="${cy}" r="5" fill="${C.cyan}"/>
    `,
  };

  return arts[itemId] || arts['caca']; // Fallback
}

module.exports = { getItemArtSVG };
