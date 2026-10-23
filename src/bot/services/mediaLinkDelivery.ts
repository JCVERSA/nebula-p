/**
 * 9.18r — Livraison AVEC LIENS des médias IA-téléchargeurs (Instagram,
 * TikTok) : même standard que Novabox — le média part du disque du serveur
 * et chaque envoi s'accompagne d'un lien haut-débit à TTL glissant.
 *
 * Retour terrain 14/10 04:54 : sept reels livrés sans liens → l'owner a dû
 * répondre `.up` à CHAQUE vidéo pour obtenir des liens. Désormais la
 * commande télécharge le média en local (fiable : l'URL CDN distante peut
 * expirer en plein envoi), l'enregistre dans le store à TTL glissant, et
 * livre média + lien.
 *
 * Robustesse : TOUT échec (téléchargement, quota du store) retombe sur le
 * comportement d'avant 9.18r — envoi depuis l'URL distante, sans lien.
 * Jamais de régression de livraison.
 */
import axios from "axios";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { registerTempDownload } from "../tempDownloadManager.js";

/** Plafond par média — au-delà : envoi direct depuis l'URL distante. */
const MAX_MEDIA_BYTES = 200 * 1024 * 1024;

/** Borné : un média qui traîne ne bloque jamais la commande. */
const FETCH_TIMEOUT_MS = 60000;

export interface MediaLinkRecord {
  /** Fichier dans le store (APRÈS le move) — c'est LUI qu'on envoie. */
  filePath: string;
  downloadUrl: string;
  sizeMB: number;
}

/**
 * Télécharge un média vers un fichier temporaire local. Retourne null sur
 * tout problème (URL invalide, timeout, taille > plafond, disque) —
 * l'appelant retombe sur l'envoi distant.
 */
export async function fetchMediaToTempFile(
  url: string,
  onProgress?: (receivedBytes: number, totalBytes: number) => void
): Promise<string | null> {
  const target = String(url || "").trim();
  if (!/^https?:\/\//i.test(target)) return null;
  const ext = /\.(jpe?g|png|webp)(?:[?#]|$)/i.test(target)
    ? path.extname(target.match(/\.(jpe?g|png|webp)(?:[?#]|$)/i)![0])
    : ".mp4";
  const tmpPath = path.join(os.tmpdir(), `igtt_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`);
  try {
    const res = await axios.get(target, {
      timeout: FETCH_TIMEOUT_MS,
      responseType: "stream",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "*/*"
      },
      validateStatus: (s) => s === 200
    });
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(tmpPath);
      let received = 0;
      let settled = false;
      // 9.18hhhh — total réel quand la source le donne (content-length).
      const totalLen = Number(res.headers?.["content-length"]) || 0;
      const totalBytes = Number.isFinite(totalLen) && totalLen > 0 ? totalLen : 0;
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        try { out.destroy(); } catch {}
        try { res.data.destroy(); } catch {}
        if (err) {
          try { fs.unlinkSync(tmpPath); } catch {}
          reject(err);
        } else {
          resolve();
        }
      };
      res.data.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (onProgress) {
          try { onProgress(received, totalBytes); } catch {}
        }
        if (received > MAX_MEDIA_BYTES) done(new Error("media exceeds size cap"));
      });
      res.data.on("error", done);
      out.on("error", done);
      out.on("finish", () => done());
      res.data.pipe(out);
    });
    const st = fs.statSync(tmpPath);
    if (st.size <= 0) {
      try { fs.unlinkSync(tmpPath); } catch {}
      return null;
    }
    return tmpPath;
  } catch {
    try { fs.unlinkSync(tmpPath); } catch {}
    return null;
  }
}

/**
 * Enregistre le fichier local dans le store à TTL glissant (le move vers le
 * store est fait par registerTempDownload). Retourne null si le quota du
 * store refuse — le fichier reste alors à son emplacement d'origine
 * (l'appelant peut quand même l'envoyer, sans lien).
 */
export function registerMediaLink(localPath: string, filename: string): MediaLinkRecord | null {
  try {
    const rec = registerTempDownload(localPath, filename, { moveFile: true });
    if (!rec?.filePath || !rec?.downloadUrl) return null;
    return { filePath: rec.filePath, downloadUrl: rec.downloadUrl, sizeMB: rec.sizeMB };
  } catch {
    return null;
  }
}
