/**
 * NebulaMark (9.13c) — la marque « Constellation N » dans le panel.
 *
 * Variante petite taille du logo (docs/brand/) : les quatre points (les
 * commandes) et l'étoile centrale (l'agent), SANS les traits de liaison —
 * sous ~32 px les traits disparaissent de toute façon, la constellation
 * tient entirement sur points + étoile. C'est le même dessin que le
 * favicon (public/favicon.svg).
 *
 * Couleurs : points en currentColor (s'adaptent au thème du conteneur),
 * étoile violette (#a78bfa sur fond sombre) — la couleur de l'agent.
 */
export default function NebulaMark({
  size = 20,
  className = "",
  starColor = "#a78bfa",
  title,
  onClick,
}: {
  size?: number;
  className?: string;
  starColor?: string;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      className={className}
      fill="none"
      onClick={onClick}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      <circle cx="76" cy="76" r="30" fill="currentColor" />
      <circle cx="76" cy="180" r="30" fill="currentColor" />
      <circle cx="180" cy="180" r="30" fill="currentColor" />
      <circle cx="180" cy="76" r="30" fill="currentColor" />
      <path
        d="M 128,80 Q 137,119 176,128 Q 137,137 128,176 Q 119,137 80,128 Q 119,119 128,80 Z"
        fill={starColor}
      />
    </svg>
  );
}
