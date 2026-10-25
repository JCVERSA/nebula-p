/**
 * 9.18llll — service sticker (inspiré de l'analyse concurrent KnightBot-Mini,
 * MIT) : conversion image/vidéo → sticker WhatsApp .webp avec métadonnées
 * de pack (EXIF), SANS API tierce.
 *
 * Pipeline local uniquement :
 *   média → ffmpeg (scale 512 + pad transparent, libwebp) → node-webpmux
 *   (chunk EXIF « sticker-pack-name ») → buffer prêt pour sendMessage.
 *
 * Décisions :
 *  - ffmpeg SANS shell (spawn args array, comme runFfmpegKit) ;
 *  - vidéo → sticker animé (fps 15) plafonné à ~1 Mo : deux passes de
 *    ré-encodage dégradées (fps 12/q45 puis fps 8/q30, durée coupée) avant
 *    d'abandonner honnêtement ;
 *  - pack/author configurables : NEBULA_STICKER_PACK / NEBULA_STICKER_AUTHOR
 *    (défaut « Nebula » / « Nebula Bot ») ;
 *  - entrée plafonnée à 40 Mo (VPS 1 cœur : le temps de conversion compte).
 */

import fs from "fs";
import { Image as WebPImage } from "node-webpmux";
import { runFfmpegKit } from "./mediaToolkit.js";

export const STICKER_INPUT_MAX_BYTES = 40 * 1024 * 1024;
export const STICKER_TARGET_MAX_BYTES = 1024 * 1024; // 1 Mo — zone de confort sticker WhatsApp

export function stickerPackName(): string {
  return (process.env.NEBULA_STICKER_PACK || "Nebula").slice(0, 60);
}

export function stickerAuthorName(): string {
  return (process.env.NEBULA_STICKER_AUTHOR || "Nebula Bot").slice(0, 60);
}

/** Filtre ffmpeg : rétrécit en gardant le ratio, puis cadre en 512×512 transparent. */
export function buildStickerFilter(animated: boolean, fps: number): string {
  const base = "scale=512:512:force_original_aspect_ratio=decrease";
  const pad = "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000";
  return animated ? `${base},fps=${fps},${pad}` : `${base},format=rgba,${pad}`;
}

export interface StickerEncodeOptions {
  animated: boolean;
  fps?: number;
  quality?: number;
  /** Coupe la durée (secondes) — stickers animés longs = fichiers énormes. */
  timeLimitSec?: number;
  /** Bitrate vidéo plafonné (passes de secours uniquement). */
  bitrateKbps?: number;
}

/** Args ffmpeg SANS shell — testables à plat. */
export function buildStickerFfmpegArgs(input: string, output: string, opts: StickerEncodeOptions): string[] {
  const { animated, fps = 15, quality = 75, timeLimitSec, bitrateKbps } = opts;
  const args = ["-y", "-i", input];
  if (timeLimitSec && timeLimitSec > 0) args.push("-t", String(Math.floor(timeLimitSec)));
  args.push(
    "-vf",
    buildStickerFilter(animated, fps),
    "-c:v",
    "libwebp",
    "-preset",
    "default",
    "-loop",
    "0",
    "-vsync",
    "0",
    "-pix_fmt",
    "yuva420p",
    "-quality",
    String(quality),
    "-compression_level",
    "6",
  );
  if (bitrateKbps && bitrateKbps > 0) args.push("-b:v", `${bitrateKbps}k`);
  args.push(output);
  return args;
}

/**
 * Chunk EXIF WhatsApp (recette communautaire éprouvée — TIFF little-endian,
 * une entrée, tag « AW » 0x8741 du standard sticker) : c'est ce que lit
 * WhatsApp pour afficher le nom du pack et l'auteur.
 */
export function buildStickerExifBuffer(packName: string, author: string): Buffer {
  const json = Buffer.from(
    JSON.stringify({
      "sticker-pack-id": "nebula",
      "sticker-pack-name": packName,
      "sticker-author-name": author,
    }),
    "utf8",
  );
  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x16, 0x00, 0x00, 0x00,
  ]);
  const exif = Buffer.concat([exifAttr, json]);
  exif.writeUIntLE(json.length, 14, 4);
  return exif;
}

/** Ré-écrit le buffer .webp avec l'EXIF du pack (node-webpmux, pur JS). */
export async function withStickerExif(webpBuffer: Buffer, packName: string, author: string): Promise<Buffer> {
  const img = new WebPImage();
  await img.load(webpBuffer);
  img.exif = buildStickerExifBuffer(packName, author);
  return await img.save(null);
}

export type StickerConvertResult =
  | { ok: true; buffer: Buffer; degraded: boolean }
  | { ok: false; reason: "ffmpeg" | "tooBig" | "empty" };

/** Lit le média déjà sur disque et produit le sticker final (EXIF inclus). */
export async function convertMediaToSticker(inputPath: string, animated: boolean): Promise<StickerConvertResult> {
  const tmp = (suffix: string) => `${inputPath}.sticker${suffix}.webp`;
  const outputs: string[] = [];
  try {
    // Passe 1 : qualité normale.
    const out1 = tmp("");
    outputs.push(out1);
    const r1 = await runFfmpegKit(buildStickerFfmpegArgs(inputPath, out1, { animated }), 120000);
    if (r1.ok && fs.existsSync(out1) && fs.statSync(out1).size > 0) {
      const buf = fs.readFileSync(out1);
      if (!animated || buf.length <= STICKER_TARGET_MAX_BYTES) {
        return { ok: true, buffer: await withStickerExif(buf, stickerPackName(), stickerAuthorName()), degraded: false };
      }
    } else if (!r1.ok) {
      return { ok: false, reason: "ffmpeg" };
    }

    // Passe 2 (animé trop lourd) : fps 12, qualité 45, 3 s max.
    const out2 = tmp(".p2");
    outputs.push(out2);
    const r2 = await runFfmpegKit(
      buildStickerFfmpegArgs(inputPath, out2, { animated: true, fps: 12, quality: 45, timeLimitSec: 3 }),
      120000,
    );
    if (r2.ok && fs.existsSync(out2) && fs.statSync(out2).size > 0) {
      const buf = fs.readFileSync(out2);
      if (buf.length <= STICKER_TARGET_MAX_BYTES) {
        return { ok: true, buffer: await withStickerExif(buf, stickerPackName(), stickerAuthorName()), degraded: true };
      }
    }

    // Passe 3 (dernier recours) : fps 8, qualité 30, 2 s max, bitrate plafonné.
    const out3 = tmp(".p3");
    outputs.push(out3);
    const r3 = await runFfmpegKit(
      buildStickerFfmpegArgs(inputPath, out3, {
        animated: true,
        fps: 8,
        quality: 30,
        timeLimitSec: 2,
        bitrateKbps: 100,
      }),
      120000,
    );
    if (r3.ok && fs.existsSync(out3) && fs.statSync(out3).size > 0) {
      const buf = fs.readFileSync(out3);
      return { ok: true, buffer: await withStickerExif(buf, stickerPackName(), stickerAuthorName()), degraded: true };
    }
    return { ok: false, reason: "ffmpeg" };
  } catch {
    return { ok: false, reason: "ffmpeg" };
  } finally {
    for (const f of outputs) {
      try {
        fs.unlinkSync(f);
      } catch {}
    }
  }
}
