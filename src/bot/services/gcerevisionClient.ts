/**
 * Client cameroongcerevision.com (8.91) — annales GCE Cameroun (O/L, A/L, mocks).
 *
 * Idée owner 2026-10-06 : un flux « novabox » pour les papiers GCE — le site
 * publie les annales en PDF (public, sans auth) via WordPress.
 *
 * Ground truth (vérifié 2026-10-06, site + VPS owner) :
 *   - /a-level/ et /o-level/ listent les matières (liens « View all papers ») ;
 *   - chaque page matière liste les sessions (« june 2026 », « mock 2024 »)
 *     puis les papiers (Paper 1/2/3) — certains sans lien = pas publiés ;
 *   - chaque article embarque le PDF via le viewer Google Docs : la page
 *     contient un blob JSON {"title": "AL-2023-BIOLOGY-2-Copy.pdf"} (le nom
 *     du vrai fichier) ; l'URL gview?...url= est un artefact de template
 *     périmé (ne PAS lui faire confiance) ;
 *   - l'API REST WordPress est OUVERTE : /wp-json/wp/v2/media?search=<stem>
 *     renvoie le média avec son URL directe (testé : PDF 1,1 Mo téléchargé
 *     depuis le VPS) ;
 *   - les articles RÉCENTS (2025/2026) n'ont pas de PDF intégré mais
 *     contiennent le TEXTE officiel des questions (fallback owner-validé) ;
 *   - réponse honnête par papier : PDF → texte → « pas encore publié ».
 *
 * Bon citoyen : pages matières en cache 24 h partagé (tous users), UA propre,
 * un seul domaine, aucune requête massive. Jamais /product/, /cart/,
 * /checkout/ (contenu payant — hors périmètre).
 *
 * Architecture : TOUT le parsing est en fonctions PURES testées sur fixtures
 * (aucun réseau) ; la couche fetch est fine et passe par la garde SSRF
 * (safeAxiosGet). Détail des échecs TOUJOURS loggé (leçon 8.86b).
 */

import * as cheerio from "cheerio";
import fs from "fs";
import os from "os";
import path from "path";
import { safeAxiosGet } from "../urlSafety.js";

export const GCE_BASE = "https://cameroongcerevision.com";
const GCE_UA = "NebulaBot/1.0 (WhatsApp revision bot; +https://github.com/JCVERSA/nebula-p)";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

export type GceLevel = "ol" | "al";

export interface GceSubject {
  name: string;
  url: string;
  level: GceLevel;
}

export interface GcePaper {
  /** Ex. « Paper 1 » ou « SW Mock Paper 2 ». */
  label: string;
  /** URL de l'article — null = listé mais pas publié sur le site. */
  articleUrl: string | null;
}

export interface GceSession {
  /** Ex. « juin 2023 », « Mock SW 2024 ». */
  label: string;
  year: number;
  kind: "june" | "mock";
  papers: GcePaper[];
}

export type ResolvedPaper =
  | { kind: "pdf"; pdfUrl: string; filename: string }
  | { kind: "text"; title: string; text: string }
  | { kind: "unavailable"; detail: string };

// ── Parsing PUR (testé sur fixtures) ────────────────────────────────────────

/** Page /a-level/ ou /o-level/ → matières (ancres « View all papers »). */
export function parseLevelSubjects(html: string, baseUrl: string, level: GceLevel): GceSubject[] {
  const $ = cheerio.load(html);
  const out: GceSubject[] = [];
  const seen = new Set<string>();
  let currentName = "";
  $("h1, h2, h3, h4, h5, a").each((_i, el) => {
    const node = $(el);
    const text = node.text().replace(/\s+/g, " ").trim();
    if (el.tagName === "a" || el.tagName === "A") {
      if (!/view all papers/i.test(text)) return;
      const href = node.attr("href");
      if (!href || !currentName) return;
      const url = new URL(href, baseUrl).toString();
      if (seen.has(url)) return;
      seen.add(url);
      out.push({ name: currentName, url, level });
      return;
    }
    // Heading : « Biology (0710) » → nom de matière (sans le code)
    const m = text.match(/^(.+?)\s*\(\d{4}\)\s*$/);
    if (m && m[1].length > 2) currentName = m[1].replace(/\s+/g, " ").trim();
  });
  return out;
}

/** Page matière → sessions (juin + mocks) et leurs papiers. */
export function parseSubjectSessions(html: string, pageUrl: string): GceSession[] {
  const $ = cheerio.load(html);
  const sessions: GceSession[] = [];
  let current: GceSession | null = null;
  const pushSession = (label: string, year: number, kind: "june" | "mock") => {
    current = { label, year, kind, papers: [] };
    sessions.push(current);
  };
  $("h1, h2, h3, h4, h5, h6, a").each((_i, el) => {
    const node = $(el);
    const text = node.text().replace(/\s+/g, " ").trim();
    const isAnchor = el.tagName === "a" || el.tagName === "A";
    if (!isAnchor) {
      // Heading de session : « june 2023 », « mock 2024 »…
      const june = text.match(/^june\s*(\d{4})$/i);
      const mock = text.match(/^mock\s*(\d{4})$/i);
      if (june) pushSession(`juin ${june[1]}`, Number(june[1]), "june");
      else if (mock) pushSession(`Mocks ${mock[1]}`, Number(mock[1]), "mock");
      else if (/^paper\s*\d+/i.test(text) && current) {
        // Heading « Paper 3 » SANS lien = listé mais pas publié
        current.papers.push({ label: text.replace(/\s+/g, " "), articleUrl: null });
      }
      return;
    }
    // Ancêtre de papier : « Paper 1 », « SW Mock Paper 2 »…
    if (!/paper\s*\d+/i.test(text)) return;
    const href = node.attr("href");
    if (!href) return;
    const articleUrl = new URL(href, pageUrl).toString();
    if (!current) {
      // Structure inattendue : inférer la session depuis l'URL de l'article
      // (ex. …-june-2023-biology-1/, …-2024-north-west-mock-biology-1/)
      const jm = articleUrl.match(/june[-_](\d{4})/i);
      const mm = articleUrl.match(/(?:mock|regional)[-_.](\d{4})|(\d{4})[-_][a-z-]*mock/i);
      const year = jm ? Number(jm[1]) : mm ? Number(mm[1] || mm[2]) : 0;
      if (!year) return;
      pushSession(jm ? `juin ${year}` : `Mocks ${year}`, year, jm ? "june" : "mock");
    }
    current!.papers.push({ label: text.replace(/\s+/g, " "), articleUrl });
  });
  // Dédupliquer les papiers (certains thèmes listent le même lien 2×)
  for (const s of sessions) {
    const seen = new Set<string>();
    s.papers = s.papers.filter(p => {
      const key = `${p.label}|${p.articleUrl}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return sessions.filter(s => s.papers.length > 0);
}

/** Blob du viewer Google : {"title": "AL-2023-BIOLOGY-2-Copy.pdf"} → nom du fichier. */
export function extractViewerPdfTitle(html: string): string | null {
  const m = html.match(/"title"\s*:\s*"([^"]+\.pdf)"/i);
  return m ? m[1] : null;
}

/** Liens PDF directs (wp-content/uploads) présents dans la page. */
export function extractDirectPdfLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href") || "";
    if (/\/wp-content\/uploads\/[^"']?[^"']*\.pdf(\?[^"']*)?$/i.test(href)) {
      const url = new URL(href, baseUrl).toString();
      if (!out.includes(url)) out.push(url);
    }
  });
  return out;
}

const TEXT_STOP_MARKERS = [
  "buy your pamphet", "buy your pamphlet", "one comment on", "leave a comment",
  "pdf is loading", "loading add-", "recent articles", "sponsors ads",
  "for more free gce questions", "looking for solutions", "download this paper on",
  "download this question in our application", "recent comments", "resources"
];

/** Article sans PDF → texte officiel des questions (fallback owner-validé). */
export function extractArticleText(html: string): string | null {
  const $ = cheerio.load(html);
  // Zone de contenu : article > premier bloc, sinon body entier
  const root = $("article").first().length ? $("article").first() : $("body");
  const raw = root
    .find("h1, h2, h3, h4, p, li, ol, ul")
    .addBack("h1, h2, h3, h4, p, li")
    .map((_i, el) => $(el).text())
    .get()
    .join("\n");
  const lines = raw
    .split("\n")
    .map(l => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const kept: string[] = [];
  for (const line of lines) {
    const low = line.toLowerCase();
    if (TEXT_STOP_MARKERS.some(m => low.includes(m))) break;
    if (/^page \d+ of \d+$/i.test(line)) continue;
    if (/^\d+\s*(comments?|comment)$/i.test(line)) continue;
    kept.push(line);
  }
  const text = kept.join("\n").trim();
  // Trop court = boilerplate sans les questions → pas de faux texte
  return text.length >= 200 ? text.slice(0, 60000) : null;
}

/** Réponse /wp-json/wp/v2/media → URL directe du PDF correspondant au nom cherché. */
export function pickMediaUrl(mediaJson: unknown, wantedTitle: string): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = norm(wantedTitle);
  const items = Array.isArray(mediaJson) ? (mediaJson as Array<Record<string, any>>) : [];
  for (const item of items) {
    const url: string | undefined = item?.source_url || item?.guid?.rendered;
    if (!url || !/\.pdf(\?|$)/i.test(url)) continue;
    const name = decodeURIComponent(url.split("/").pop() || "");
    if (norm(name) === wanted || norm(item?.title?.rendered || "") === wanted) return url;
  }
  return null;
}

/** Recherche floue de matière : « bio » → Biology. */
export function matchSubject(subjects: GceSubject[], query: string): GceSubject | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const q = norm(query);
  if (!q) return null;
  return (
    subjects.find(s => norm(s.name) === q) ||
    subjects.find(s => norm(s.name).startsWith(q)) ||
    subjects.find(s => norm(s.name).includes(q)) ||
    // Alias francophones usuels
    subjects.find(s => {
      const n = norm(s.name);
      return (
        (q.startsWith("math") && (n.includes("mathematic") || n.includes("math"))) ||
        (q.startsWith("bio") && n.startsWith("bio")) ||
        (q.startsWith("chem") && n.startsWith("chem")) ||
        (q.startsWith("phys") && n.startsWith("phys")) ||
        (q.startsWith("geo") && n.startsWith("geograph")) ||
        (q.startsWith("hist") && n.startsWith("histor")) ||
        (q.startsWith("comp") && n.includes("computer")) ||
        (q.startsWith("eng") && n.startsWith("english")) ||
        (q.startsWith("fr") && n.startsWith("french")) ||
        (q.startsWith("food") && (n.includes("food") || n.includes("nutrition")))
      );
    }) ||
    null
  );
}

// ── Couche fetch (fine, SSRF-gardée, cache 24 h) ────────────────────────────

interface CacheEntry<T> { at: number; data: T; }
const caches = {
  subjects: new Map<GceLevel, CacheEntry<GceSubject[]>>(),
  sessions: new Map<string, CacheEntry<GceSession[]>>()
};

async function fetchHtml(url: string): Promise<string> {
  const resp = await safeAxiosGet(url, {
    headers: { "User-Agent": GCE_UA, Accept: "text/html" },
    timeout: 20000,
    responseType: "text"
  });
  if (resp.status !== 200) throw new Error(`HTTP ${resp.status} sur ${url}`);
  return String(resp.data);
}

async function fetchJson(url: string): Promise<unknown> {
  const resp = await safeAxiosGet(url, {
    headers: { "User-Agent": GCE_UA, Accept: "application/json" },
    timeout: 15000,
    responseType: "json"
  });
  if (resp.status !== 200) throw new Error(`API HTTP ${resp.status} sur ${url}`);
  return resp.data;
}

export function levelPageUrl(level: GceLevel): string {
  return level === "al" ? `${GCE_BASE}/a-level/` : `${GCE_BASE}/o-level/`;
}

/** Matières d'un niveau (cache 24 h partagé). */
export async function getLevelSubjects(level: GceLevel): Promise<GceSubject[]> {
  const hit = caches.subjects.get(level);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const html = await fetchHtml(levelPageUrl(level));
  const subjects = parseLevelSubjects(html, GCE_BASE, level);
  if (subjects.length === 0) throw new Error(`Aucune matière parsée sur ${levelPageUrl(level)} — structure du site changée ?`);
  caches.subjects.set(level, { at: Date.now(), data: subjects });
  return subjects;
}

/** Sessions d'une matière (cache 24 h partagé). */
export async function getSubjectSessions(subject: GceSubject): Promise<GceSession[]> {
  const hit = caches.sessions.get(subject.url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const html = await fetchHtml(subject.url);
  const sessions = parseSubjectSessions(html, subject.url);
  caches.sessions.set(subject.url, { at: Date.now(), data: sessions });
  return sessions;
}

/** Années disponibles pour un niveau (desc), tous niveaux de sessions confondus. */
export async function getLevelYears(level: GceLevel): Promise<number[]> {
  const subjects = await getLevelSubjects(level);
  const years = new Set<number>();
  for (const s of subjects) {
    try {
      for (const sess of await getSubjectSessions(s)) years.add(sess.year);
    } catch {} // une matière injoignable ne bloque pas le niveau
  }
  return Array.from(years).sort((a, b) => b - a);
}

export interface SubjectYearAvailability {
  subject: GceSubject;
  sessions: GceSession[];
}

/** Matières ayant au moins une session pour l'année donnée. */
export async function getSubjectsForYear(level: GceLevel, year: number): Promise<SubjectYearAvailability[]> {
  const subjects = await getLevelSubjects(level);
  const out: SubjectYearAvailability[] = [];
  for (const s of subjects) {
    try {
      const all = await getSubjectSessions(s);
      const matching = all.filter(sess => sess.year === year);
      if (matching.length > 0) out.push({ subject: s, sessions: matching });
    } catch {}
  }
  return out;
}

/**
 * Résout UN papier : PDF direct > viewer+API média > texte officiel >
 * indisponible. Ne jette jamais — chaque échec porte son détail (log).
 */
export async function resolvePaper(articleUrl: string): Promise<ResolvedPaper> {
  const html = await fetchHtml(articleUrl).catch(err => {
    throw new Error(`article injoignable: ${err.message}`);
  });

  // 1. Liens PDF directs dans la page
  const direct = extractDirectPdfLinks(html, articleUrl);
  if (direct.length > 0) {
    return { kind: "pdf", pdfUrl: direct[0], filename: sanitizePdfFilename(direct[0].split("/").pop() || "gce.pdf") };
  }

  // 2. Viewer Google : le blob porte le NOM du vrai fichier → API média
  const viewerTitle = extractViewerPdfTitle(html);
  if (viewerTitle) {
    const stem = viewerTitle.replace(/\.pdf$/i, "").slice(0, 60);
    try {
      const media = await fetchJson(`${GCE_BASE}/wp-json/wp/v2/media?search=${encodeURIComponent(stem)}&per_page=5`);
      const url = pickMediaUrl(media, viewerTitle);
      if (url) return { kind: "pdf", pdfUrl: url, filename: sanitizePdfFilename(viewerTitle) };
    } catch (err: any) {
      console.warn(`[GCE] media search échouée pour ${viewerTitle}: ${err.message}`);
    }
  }

  // 3. Texte officiel (papiers récents sans PDF publié)
  const text = extractArticleText(html);
  if (text) {
    const title = cheerio.load(html)("h1").first().text().replace(/\s+/g, " ").trim() || "Paper";
    return { kind: "text", title, text };
  }

  return { kind: "unavailable", detail: viewerTitle ? `média introuvable pour ${viewerTitle}` : "ni PDF ni texte publiés" };
}

function sanitizePdfFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "gce-paper.pdf";
}

/**
 * Télécharge le PDF vers un fichier temporaire (préfixe gce_ — couvert par
 * la purge des débris 8.90). L'APPELANT supprime le fichier juste après
 * l'envoi WhatsApp (décision owner : rien ne reste sur le VPS).
 */
export async function downloadPaperPdf(pdfUrl: string): Promise<string> {
  const resp = await safeAxiosGet(pdfUrl, {
    headers: { "User-Agent": GCE_UA },
    timeout: 45000,
    responseType: "arraybuffer",
    maxContentLength: MAX_PDF_BYTES
  });
  if (resp.status !== 200) throw new Error(`PDF HTTP ${resp.status}`);
  const buf = Buffer.from(resp.data);
  if (buf.length < 1000) throw new Error("PDF vide ou tronqué");
  const tmp = path.join(os.tmpdir(), `gce_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`);
  fs.writeFileSync(tmp, buf);
  return tmp;
}

/** Test hook — vide les caches. */
export function __clearGceCachesForTests(): void {
  caches.subjects.clear();
  caches.sessions.clear();
}
