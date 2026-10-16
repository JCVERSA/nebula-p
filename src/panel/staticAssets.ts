import compression from "compression";
import express from "express";
import path from "path";

/**
 * 9.18uu — service statique du panneau : gzip + cache immuable.
 *
 * Retour terrain 17/10 : « l'interface lag, c'est devenu lent ». Le VPS était
 * innocent (CPU idle) mais express.static ne compresse RIEN par défaut : le
 * bundle du panel (1,14 Mo) partait NON COMPRESSÉ à chaque chargement froid
 * (~318 Ko en gzip — 4× moins) et sans Cache-Control, le navigateur
 * re-validait tout à chaque fois. À travers le tunnel, chaque F5 pesait son
 * méga.
 *
 * - compression() : JSON des API et assets textuels. Aucun flux SSE au
 *   panneau (le journal est en polling) — donc aucun risque de buffering.
 * - /assets : noms hashés par vite (index-XXXX.js) → immuables, cache
 *   navigateur 1 an : zéro re-téléchargement entre deux rechargements.
 *   index.html reste servi sans cache (il référence les nouveaux hash à
 *   chaque build).
 * - Les bundles SERVEUR (server.cjs, engine.cjs, *.map) ne sont plus
 *   exposés : le static naïf les servait à quiconque atteint le panneau.
 */
export function mountStaticPanel(app: express.Express, distPath: string): void {
  app.use(compression());
  app.use(
    "/assets",
    express.static(path.join(distPath, "assets"), { maxAge: "1y", immutable: true })
  );
  app.use((req, _res, next) => {
    if (/\.(cjs|map)$/i.test(req.path)) {
      _res.status(403).end();
      return;
    }
    next();
  });
  app.use(express.static(distPath));
}
