import { motion } from "motion/react";

/**
 * MorphIcon (9.18rr) — transitions d'icônes géométriques continues, portage
 * web du concept SwiftSlate de l'APK (SlateMorphIcon : « Draws icon pairs as
 * a continuous geometric transition without external heavy runtimes »).
 *
 * Origine : le repo « morphicons » de la liste du 14/10 avait été classé
 * cosmétique/backlog (9.18u) — son CODE ne sert pas, mais le CONCEPT vit
 * déjà dans l'app Android (SlateMorphIcon/SlateMotion, 9.18h). Le dashboard
 * web est la seule surface qui ne l'a pas : ces deux morphs y apportent un
 * retour d'ÉTAT tactile, pas de la décoration (esprit du grand nettoyage
 * 9.18qq) :
 *  - MenuCloseMorph : bulle du terminal — les lignes du chat pivotent en
 *    croix à l'ouverture (ouvert/fermé se lit d'un coup d'œil) ;
 *  - CheckMorph : fin de mise à jour — l'anneau se referme puis la coche se
 *    dessine (le spinner s'achève visuellement en succès).
 *
 * Uniquement des transforms CSS animés par motion/react (déjà en dépendance)
 * + pathLength pour les dessins — GPU-friendly, pas de runtime externe.
 */

interface MorphProps {
  size?: number;
  className?: string;
  stroke?: string;
  strokeWidth?: number;
}

/** Traits du chat ↔ croix de fermeture. `open` = état croix. */
export function MenuCloseMorph({ open, size = 22, className = "", stroke = "currentColor", strokeWidth = 2 }: MorphProps & { open: boolean }) {
  const t = { duration: 0.22, ease: "easeOut" as const };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {/* Bulle de chat : s'efface (échelle + opacité) quand on passe en croix */}
      <motion.rect
        x={4} y={5} width={16} height={14} rx={4}
        stroke={stroke} strokeWidth={strokeWidth}
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        animate={{ opacity: open ? 0 : 1, scale: open ? 0.55 : 1 }}
        transition={t}
      />
      {/* Queue de bulle */}
      <motion.path
        d="M8.5 19v2.6l2.6-2.6" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        animate={{ opacity: open ? 0 : 1, scale: open ? 0.55 : 1 }}
        transition={t}
      />
      {/* Trait 1 : ligne de chat → diagonale de la croix (rotation autour du centre) */}
      <motion.line
        x1={5.5} y1={12} x2={18.5} y2={12} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round"
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        animate={open ? { y: 0, rotate: 45, scaleX: 1 } : { y: -2.5, rotate: 0, scaleX: 0.68 }}
        transition={t}
      />
      {/* Trait 2 : seconde ligne → seconde diagonale */}
      <motion.line
        x1={5.5} y1={12} x2={18.5} y2={12} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round"
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        animate={open ? { y: 0, rotate: -45, scaleX: 1 } : { y: 3, rotate: 0, scaleX: 0.86 }}
        transition={t}
      />
    </svg>
  );
}

/**
 * Succès qui se DESSINE : l'anneau se referme puis la coche se trace
 * (mount → une passe). Monté au moment où le spinner de mise à jour
 * s'arrête — la fin d'attente devient lisible d'un coup d'œil.
 */
export function CheckMorph({ size = 16, className = "", stroke = "currentColor" }: MorphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <motion.circle
        cx={12} cy={12} r={9} stroke={stroke} strokeWidth={2} strokeLinecap="round"
        style={{ transformBox: "fill-box", transformOrigin: "center", rotate: -90 }}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      />
      <motion.path
        d="M7.5 12.5 L10.5 15.5 L16.5 9" stroke={stroke} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.28, delay: 0.32, ease: "easeOut" }}
      />
    </svg>
  );
}
