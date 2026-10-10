/**
 * Utilitaires texte web (9.0 — recherche web).
 *
 * Fonctions PURES (testées unitairement) partagées par .search / .fetch /
 * .wiki : décodage d'entités HTML, HTML → texte lisible, nettoyage
 * WhatsApp (les * _ ~ cassent le formatage), coupe propre à la longueur.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", ccedil: "ç",
  ugrave: "ù", ucirc: "û", ocirc: "ô", icirc: "î", acirc: "â", ugrave2: "ù",
  euml: "ë", ouml: "ö", auml: "ä", uuml: "ü", iuml: "ï", ntilde: "ñ",
  laquo: "«", raquo: "»", middot: "·", bull: "•", hellip: "…",
  rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', mdash: "—", ndash: "–",
  deg: "°", euro: "€", pound: "£", copy: "©", reg: "®", trade: "™",
  oelig: "œ", OElig: "Œ", times: "×", frac12: "½", sup2: "²", sup3: "³",
  micro: "µ", shy: "",
};

function safeCodePoint(code: number): string {
  // Refuse les hors-plages et les surrogate isolés (String.fromCodePoint lèverait)
  if (!Number.isFinite(code) || code < 9 || code > 0x10ffff) return "";
  if (code >= 0xd800 && code <= 0xdfff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Décode les entités HTML nommées courantes + numériques (déc/hex). */
export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeCodePoint(Number(dec)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name: string) => NAMED_ENTITIES[name] ?? m);
}

/**
 * Nettoie un texte destiné à WhatsApp : les *, _, ~ et backticks sont des
 * balises de formatage — un titre web qui en contient casse le rendu du
 * message (leçon 8.96 : astérisques parasites).
 */
export function cleanForWhatsApp(input: string): string {
  return input.replace(/[*_~`]+/g, " ").replace(/[ \t]{2,}/g, " ").trim();
}

/** HTML complet → texte lisible (pour .fetch). Pured, testé sur fixtures. */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|head|iframe|nav|footer)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|li|tr|h[1-6]|section|article|blockquote|pre|table|ul|ol|dl|dt|dd|figure|figcaption|header|main|form|aside)>/gi,
      "\n",
    )
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, " ");
  text = decodeHtmlEntities(text);
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Coupe propre à une longueur max : au dernier espace, sinon caractère dur. */
export function capText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const lastNewline = cut.lastIndexOf("\n");
  const boundary = Math.max(lastSpace, lastNewline);
  const kept = boundary > max * 0.5 ? cut.slice(0, boundary) : cut;
  return kept.trimEnd() + "…";
}

/** Nom de domaine affichable d'une URL (www. retiré). */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
