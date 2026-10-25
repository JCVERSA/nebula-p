/**
 * 9.18llll — typings minimaux de node-webpmux (pur JS, sans @types).
 * Seule la surface utilisée par stickerService est déclarée : lecture d'un
 * buffer .webp, écriture du chunk EXIF, ré-encodage en buffer.
 */
declare module "node-webpmux" {
  export const TYPE_LOSSY: number;
  export const TYPE_LOSSLESS: number;
  export const TYPE_EXTENDED: number;

  export class Image {
    width: number;
    height: number;
    type: number;
    hasAnim: boolean;
    /** Données EXIF brutes (chunk EXIF du conteneur RIFF). */
    exif: Buffer | undefined;
    /** Charge depuis un chemin ou un buffer. */
    load(source: string | Buffer | Uint8Array): Promise<void>;
    /**
     * Sérialise l'image. `path === null` → retourne un buffer (aucune IO).
     * `exif: true` (défaut) conserve le chunk EXIF courant.
     */
    save(
      path: string | null,
      options?: {
        width?: number;
        height?: number;
        frames?: unknown[];
        bgColor?: number[];
        loops?: number;
        delay?: number;
        x?: number;
        y?: number;
        blend?: boolean;
        dispose?: boolean;
        exif?: boolean;
        iccp?: boolean;
        xmp?: boolean;
      },
    ): Promise<Buffer>;
  }
}
