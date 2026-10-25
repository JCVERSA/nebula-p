/**
 * 9.18pppp — moteur de rendu des cards welcome/goodbye (owner 25/10).
 *
 * Deux familles de presets :
 *  - GÉNÉRATIFS (canvas 1200×600, @napi-rs/canvas + Poppins OFL bundlée
 *    dans src/bot/assets/fonts) : nebula, sunset, minimal, neon. L'avatar du
 *    membre est dessiné dessus (repli : silhouette colorée dérivée du
 *    numéro si la photo est privée ou indisponible).
 *  - IMAGE (asset PNG fixe du repo) : classernelle — bannières créées par
 *    l'owner (repo JCVERSA/noto), art intact, la mention du membre part en
 *    caption WhatsApp (décision owner : ne rien recouvrir).
 *
 * Contrat : renderCard ne JAMAIS lancer — null = échec et l'appelant replie
 * sur le texte seul (jamais d'échec visible). Canvas absent de la plateforme
 * → null : le bot continue de vivre avec les messages texte.
 */

import fs from "fs";
import path from "path";

export type CardKind = "welcome" | "goodbye";

export interface CardPresetInfo {
  id: string;
  label: string;
  kind: "generative" | "image";
  description: string;
}

export const CARD_PRESETS: CardPresetInfo[] = [
  { id: "nebula", label: "Nebula", kind: "generative", description: "Sombre, accents menthe — l'identité du dashboard." },
  { id: "sunset", label: "Sunset", kind: "generative", description: "Dégradé orange/rose chaleureux." },
  { id: "minimal", label: "Minimal", kind: "generative", description: "Blanc épuré, typographie noire." },
  { id: "neon", label: "Néon", kind: "generative", description: "Violet/fuchsia sombre, lueurs." },
  { id: "classernelle", label: "Classernelle", kind: "image", description: "Bannières officielles Classernelle (owner)." },
];

export function isCardPreset(id: string): boolean {
  return CARD_PRESETS.some(p => p.id === id);
}

/** Preset par défaut quand la config est migrée sans champ preset. */
export const DEFAULT_CARD_PRESET = "nebula";

// ── Résolution des assets (fonts + images) ─────────────────────────────────
// Le moteur tourne depuis le repo complet (VPS : /root/p, sandbox, CI) —
// on cherche sous plusieurs racines connues, env var en priorité. Absent →
// dégradation gracieuse (sans-serif système / preset image indisponible).

function assetRoots(): string[] {
  const roots = [
    process.env.NEBULA_ASSETS_DIR ? path.resolve(process.env.NEBULA_ASSETS_DIR) : null,
    path.resolve(process.cwd(), "src/bot/assets"),
    path.resolve(process.cwd(), "assets"),
    path.resolve(process.cwd(), "dist/assets"),
  ].filter((v): v is string => Boolean(v));
  return roots;
}

function findAsset(rel: string): string | null {
  for (const root of assetRoots()) {
    const full = path.join(root, rel);
    try {
      if (fs.existsSync(full)) return full;
    } catch {
      /* candidat suivant */
    }
  }
  return null;
}

/** Chemin de l'image fixe d'un preset image (null si introuvable). */
export function cardAssetPath(preset: string, kind: CardKind): string | null {
  const info = CARD_PRESETS.find(p => p.id === preset);
  if (!info || info.kind !== "image") return null;
  return findAsset(path.join("cards", `preset-${preset}-${kind}.png`));
}

// ── Canvas lazy (plateforme sans binaire → null, jamais de crash) ──────────

/* eslint-disable @typescript-eslint/no-explicit-any */
let canvasModule: any = undefined; // undefined = pas encore tenté, null = indisponible
async function getCanvas(): Promise<any> {
  if (canvasModule === undefined) {
    try {
      canvasModule = await import("@napi-rs/canvas");
    } catch {
      canvasModule = null;
    }
  }
  return canvasModule;
}

let fontsRegistered = false;
let fontsAvailable = false;
async function ensureFonts(cv: any): Promise<void> {
  if (fontsRegistered) return;
  fontsRegistered = true;
  try {
    for (const w of ["Regular", "SemiBold", "Bold", "ExtraBold"]) {
      const f = findAsset(path.join("fonts", `Poppins-${w}.ttf`));
      if (f) cv.GlobalFonts.registerFromPath(f, `Poppins${w}`);
    }
    fontsAvailable = true;
  } catch {
    fontsAvailable = false; // fallback sans-serif système
  }
}

const F = {
  regular: (px: number) => `${px}px ${"PoppinsRegular"}`,
  semi: (px: number) => `${px}px PoppinsSemiBold`,
  extra: (px: number) => `${px}px PoppinsExtraBold`,
};
function fontFor(weight: "regular" | "semi" | "extra", px: number): string {
  if (!fontsAvailable) return `${weight === "extra" ? "bold " : weight === "semi" ? "600 " : ""}${px}px sans-serif`;
  return weight === "regular" ? F.regular(px) : weight === "semi" ? F.semi(px) : F.extra(px);
}

// ── Palettes des presets génératifs ────────────────────────────────────────

interface Palette {
  paint: (ctx: any, W: number, H: number) => void;
  titleFill: string;
  underline: (ctx: any, cx: number, y: number) => void;
  ring: string;
  nameFill: string;
  pillFill: string;
  pillStroke: string | null;
  pillText: string;
  muted: string;
}

function dotGrid(ctx: any, W: number, H: number, color: string, step = 34, r = 2): void {
  ctx.fillStyle = color;
  for (let y = step; y < H; y += step) {
    for (let x = step; x < W; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function roundRectPath(ctx: any, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

const PALETTES: Record<string, Palette> = {
  nebula: {
    paint: (ctx, W, H) => {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#0b1011");
      g.addColorStop(1, "#122226");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      dotGrid(ctx, W, H, "rgba(162,227,203,0.10)");
    },
    titleFill: "#f4f7f4",
    underline: (ctx, cx, y) => {
      ctx.fillStyle = "#a2e3cb";
      ctx.fillRect(cx - 70, y, 140, 6);
    },
    ring: "#a2e3cb",
    nameFill: "#f4f7f4",
    pillFill: "#1d2b2d",
    pillStroke: "#263737",
    pillText: "#a2e3cb",
    muted: "#b0bcb8",
  },
  sunset: {
    paint: (ctx, W, H) => {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#ffb26b");
      g.addColorStop(1, "#ff7e7e");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      for (const [x, y, r] of [[170, 110, 70], [1030, 120, 90], [240, 500, 60], [980, 490, 75]] as const) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    titleFill: "#ffffff",
    underline: (ctx, cx, y) => {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillRect(cx - 70, y, 140, 6);
    },
    ring: "#ffffff",
    nameFill: "#ffffff",
    pillFill: "rgba(255,255,255,0.22)",
    pillStroke: "rgba(255,255,255,0.55)",
    pillText: "#ffffff",
    muted: "rgba(255,255,255,0.85)",
  },
  minimal: {
    paint: (ctx, W, H) => {
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "#e2e2e2";
      ctx.lineWidth = 2;
      ctx.strokeRect(22, 22, W - 44, H - 44);
    },
    titleFill: "#111111",
    underline: (ctx, cx, y) => {
      ctx.fillStyle = "#111111";
      ctx.fillRect(cx - 70, y, 140, 6);
    },
    ring: "#111111",
    nameFill: "#111111",
    pillFill: "#f0f0f0",
    pillStroke: null,
    pillText: "#555555",
    muted: "#888888",
  },
  neon: {
    paint: (ctx, W, H) => {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#12101f");
      g.addColorStop(1, "#1a1433");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const glow = ctx.createRadialGradient(600, 278, 40, 600, 278, 340);
      glow.addColorStop(0, "rgba(139,92,246,0.32)");
      glow.addColorStop(1, "rgba(139,92,246,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      const glow2 = ctx.createRadialGradient(120, 540, 20, 120, 540, 300);
      glow2.addColorStop(0, "rgba(217,70,239,0.20)");
      glow2.addColorStop(1, "rgba(217,70,239,0)");
      ctx.fillStyle = glow2;
      ctx.fillRect(0, 0, W, H);
      dotGrid(ctx, W, H, "rgba(139,92,246,0.14)");
    },
    titleFill: "#ffffff",
    underline: (ctx, cx, y) => {
      const g = ctx.createLinearGradient(cx - 80, 0, cx + 80, 0);
      g.addColorStop(0, "#8b5cf6");
      g.addColorStop(1, "#d946ef");
      ctx.fillStyle = g;
      ctx.fillRect(cx - 80, y, 160, 6);
    },
    ring: "#d946ef",
    nameFill: "#e9d5ff",
    pillFill: "#2a1f4d",
    pillStroke: "#3b2d6b",
    pillText: "#c084fc",
    muted: "#8f86b8",
  },
};

// ── Helpers de dessin ───────────────────────────────────────────────────────

/** Texte espacé centré (le letterSpacing natif n'est pas garanti partout). */
function drawSpacedText(ctx: any, text: string, centerX: number, y: number, spacing: number): void {
  const chars = [...text];
  const widths = chars.map(ch => ctx.measureText(ch).width);
  const total = widths.reduce((a: number, b: number) => a + b, 0) + spacing * Math.max(0, chars.length - 1);
  let x = centerX - total / 2;
  ctx.textAlign = "left";
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], x, y);
    x += widths[i] + spacing;
  }
}

/** Couleur stable dérivée du numéro (silhouette de repli). */
function hueFromNumber(number: string): number {
  let hash = 0;
  for (const ch of String(number || "0")) hash = (hash * 31 + ch.charCodeAt(0)) % 100000;
  return hash % 360;
}

function drawSilhouette(ctx: any, cx: number, cy: number, r: number, number: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = `hsl(${hueFromNumber(number)}, 55%, 42%)`;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.28, r * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.85, r * 0.62, Math.PI, 0);
  ctx.fill();
  ctx.restore();
}

function fitText(ctx: any, text: string, maxWidth: number, weight: "regular" | "semi" | "extra", startPx: number): number {
  let px = startPx;
  for (; px > 18; px -= 2) {
    ctx.font = fontFor(weight, px);
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  return px;
}

// ── Rendu ───────────────────────────────────────────────────────────────────

export interface RenderCardOptions {
  kind: CardKind;
  preset: string;
  /** Nom affiché (numéro formaté en prod, nom factice pour les aperçus). */
  userName: string;
  userNumber: string;
  /** Photo de profil du membre (Buffer image) ou null → silhouette. */
  avatar?: Buffer | null;
  groupName: string;
  memberCount?: number;
}

const CARD_W = 1200;
const CARD_H = 600;

export async function renderCard(opts: RenderCardOptions): Promise<Buffer | null> {
  const palette = PALETTES[opts.preset];
  if (!palette) return null; // preset inconnu ou preset image → caller gère l'asset
  const cv = await getCanvas();
  if (!cv) return null;
  await ensureFonts(cv);
  try {
    const canvas = cv.createCanvas(CARD_W, CARD_H);
    const ctx = canvas.getContext("2d");
    palette.paint(ctx, CARD_W, CARD_H);

    // Titre + soulignement
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.font = fontFor("extra", 58);
    ctx.fillStyle = palette.titleFill;
    drawSpacedText(ctx, opts.kind === "welcome" ? "BIENVENUE" : "AU REVOIR", CARD_W / 2, 108, 16);
    palette.underline(ctx, CARD_W / 2, 132);

    // Avatar (photo si fournie, sinon silhouette) + anneau
    const cx = CARD_W / 2;
    const cy = 288;
    const r = 100;
    let avatarImg: any = null;
    if (opts.avatar && opts.avatar.length > 0) {
      try {
        avatarImg = await cv.loadImage(opts.avatar);
      } catch {
        avatarImg = null; // format exotique → silhouette
      }
    }
    if (avatarImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(avatarImg, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
    } else {
      drawSilhouette(ctx, cx, cy, r, opts.userNumber);
    }
    ctx.strokeStyle = palette.ring;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.stroke();

    // Nom du membre
    const name = String(opts.userName || "").slice(0, 60);
    const namePx = fitText(ctx, name, 1000, "semi", 44);
    ctx.font = fontFor("semi", namePx);
    ctx.fillStyle = palette.nameFill;
    ctx.textAlign = "center";
    ctx.fillText(name, cx, 448);

    // Pastille groupe
    const group = String(opts.groupName || "").slice(0, 40);
    ctx.font = fontFor("regular", 26);
    const pillTextW = ctx.measureText(group).width;
    const pillW = pillTextW + 44;
    const pillH = 44;
    const pillY = 474;
    roundRectPath(ctx, cx - pillW / 2, pillY, pillW, pillH, 22);
    ctx.fillStyle = palette.pillFill;
    ctx.fill();
    if (palette.pillStroke) {
      ctx.strokeStyle = palette.pillStroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = palette.pillText;
    ctx.textBaseline = "middle";
    ctx.fillText(group, cx, pillY + pillH / 2 + 1);

    // Compteur (welcome uniquement — décision design : inutile au départ)
    if (opts.kind === "welcome" && typeof opts.memberCount === "number" && opts.memberCount > 0) {
      ctx.font = fontFor("regular", 24);
      ctx.fillStyle = palette.muted;
      ctx.fillText(`Membre n° ${opts.memberCount}`, cx, 556);
    }

    return canvas.toBuffer("image/png") as Buffer;
  } catch {
    return null; // jamais d'échec visible — repli texte de l'appelant
  }
}
