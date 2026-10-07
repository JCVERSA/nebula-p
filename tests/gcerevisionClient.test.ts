import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  extractArticleText,
  extractDirectPdfLinks,
  extractViewerPdfTitle,
  matchSubject,
  parseLevelSubjects,
  parseSubjectSessions,
  pickMediaUrl,
  type GceSubject
} from "../src/bot/services/gcerevisionClient.js";

/**
 * 8.91 — parsing cameroongcerevision.com. Toutes les fonctions testées sont
 * PURES : fixtures HTML figées, aucun réseau. Ground truth constaté sur le
 * site le 2026-10-06 (structures réelles simplifiées).
 */

const BASE = "https://cameroongcerevision.com";

const LEVEL_HTML = `
<html><body>
  <h1>Cameroon gce Questions A-level</h1>
  <h3>Biology (0710)</h3>
  <img src="bio.png">
  <a href="https://cameroongcerevision.com/a-level/june-biology-a-level/">View all papers</a>
  <h3>Chemistry (0715)</h3>
  <a href="https://cameroongcerevision.com/a-level/june-chemistry-a-level">View all papers</a>
  <h3>Computer science (0795)</h3>
  <a href="/a-level/june-computer-science/">View all papers</a>
  <h3>Autre section sans code</h3>
  <a href="https://cameroongcerevision.com/product/pamphlet/">Buy Books</a>
</body></html>`;

const SUBJECT_HTML = `
<html><body>
  <h1>cameroon gce Questions A level Biology 0710</h1>
  <h3>Chose a year:</h3>
  <h3>june 2023</h3>
  <a href="https://cameroongcerevision.com/cameroon-gce-a-level-june-2023-biology-1/"><strong>Paper 1</strong></a>
  <a href="/cameroon-gce-a-level-june-2023-biology-2/">Paper 2</a>
  <h3>Paper 3</h3>
  <h3>mock 2024</h3>
  <a href="https://cameroongcerevision.com/advanced-level-2024-north-west-mock-biology-1/">NW Mock Paper 1</a>
  <a href="https://cameroongcerevision.com/advanced-level-2024-north-west-mock-biology-1/">NW Mock Paper 1</a>
  <a href="https://cameroongcerevision.com/advanced-level-2024-caspa-mock-biology-2/">CASPA Mock Paper 2</a>
  <h3>june 2026</h3>
  <a href="https://cameroongcerevision.com/cameroon-gce-advanced-level-june-2026-biology-2/">Paper 2</a>
</body></html>`;

const ARTICLE_HTML = `
<html><body>
  <article>
    <h3>cameroon gce A level June 2023 biology 2</h3>
    <p>Explain how the information encoded in DNA is used to make protein.</p>
    <p>How is the synthesis of proteins regulated by enzyme induction and enzyme repression? (12, 8 marks)</p>
    <p>With the aid of suitable examples, distinguish between metagenesis and alternation of generation. How is the tapeworm adapted to its parasitic mode of life? What role is played by each of the following in digestion? Salivary glands. Oxyntic cells.</p>
    <p>Show how the structure of the ileum is suited to its function of absorption. Describe the cardiac cycle with the aid of a diagram.</p>
    <div>{"id": "", "title": "AL-2023-BIOLOGY-2-Copy.pdf", "mimeType": "application\\/pdf"}</div>
    <div>Page 1 of 2</div>
    <div>PDF is loading please wait...</div>
    <div>Buy your pamphet</div>
    <div>One comment on “biology 2”</div>
  </article>
</body></html>`;

describe("8.91 — parseLevelSubjects", () => {
  it("extrait les matières (nom sans code) depuis les ancres « View all papers »", () => {
    const subjects = parseLevelSubjects(LEVEL_HTML, BASE, "al");
    expect(subjects.map(s => s.name)).toEqual(["Biology", "Chemistry", "Computer science"]);
    expect(subjects[0]).toMatchObject({ url: "https://cameroongcerevision.com/a-level/june-biology-a-level/", level: "al" });
    expect(subjects[2].url).toBe("https://cameroongcerevision.com/a-level/june-computer-science/"); // href relatif résolu
  });

  it("ignore les liens non-« View all papers » (produits payants)", () => {
    const subjects = parseLevelSubjects(LEVEL_HTML, BASE, "al");
    expect(subjects.some(s => s.name.includes("Autre"))).toBe(false);
  });
});

describe("8.91 — parseSubjectSessions", () => {
  it("sessions juin + mocks, papiers liés, papier SANS lien = pas publié, doublons déduits", () => {
    const sessions = parseSubjectSessions(SUBJECT_HTML, `${BASE}/a-level/june-biology-a-level/`);
    expect(sessions).toHaveLength(3);
    const june23 = sessions.find(s => s.kind === "june" && s.year === 2023)!;
    expect(june23.label).toBe("juin 2023");
    expect(june23.papers).toHaveLength(3);
    expect(june23.papers[0]).toMatchObject({ label: "Paper 1", articleUrl: expect.stringContaining("june-2023-biology-1") });
    expect(june23.papers[2]).toMatchObject({ label: "Paper 3", articleUrl: null }); // listé mais pas publié
    const mock24 = sessions.find(s => s.kind === "mock" && s.year === 2024)!;
    expect(mock24.papers).toHaveLength(2); // le doublon NW Mock Paper 1 est déduit
    expect(mock24.papers[1].label).toBe("CASPA Mock Paper 2");
  });
});

describe("8.91 — extraction PDF d'un article", () => {
  it("le blob du viewer Google porte le NOM du vrai fichier", () => {
    expect(extractViewerPdfTitle(ARTICLE_HTML)).toBe("AL-2023-BIOLOGY-2-Copy.pdf");
    expect(extractViewerPdfTitle("<html></html>")).toBeNull();
  });

  it("liens PDF directs wp-content/uploads détectés", () => {
    const html = `<a href="${BASE}/wp-content/uploads/2023/06/paper.pdf">Download</a><a href="/product/x/">shop</a>`;
    expect(extractDirectPdfLinks(html, BASE)).toEqual([`${BASE}/wp-content/uploads/2023/06/paper.pdf`]);
  });

  it("pickMediaUrl : match exact du nom (guid ou source_url), PDF uniquement", () => {
    const media = [
      { source_url: `${BASE}/wp-content/uploads/2023/06/other.png`, guid: { rendered: `${BASE}/wp-content/uploads/2023/06/other.png` }, title: { rendered: "Other" } },
      { source_url: `${BASE}/wp-content/uploads/2023/06/AL-2023-BIOLOGY-2-Copy.pdf`, guid: { rendered: `${BASE}/wp-content/uploads/2023/06/AL-2023-BIOLOGY-2-Copy.pdf` }, title: { rendered: "AL 2023 BIOLOGY 2-Copy" } }
    ];
    expect(pickMediaUrl(media, "AL-2023-BIOLOGY-2-Copy.pdf")).toBe(`${BASE}/wp-content/uploads/2023/06/AL-2023-BIOLOGY-2-Copy.pdf`);
    expect(pickMediaUrl(media, "INCONNU-x.pdf")).toBeNull();
    expect(pickMediaUrl([], "x.pdf")).toBeNull();
  });
});

describe("8.91 — fallback texte (papier sans PDF publié)", () => {
  it("extrait le texte officiel et s'arrête aux marqueurs de boilerplate", () => {
    const text = extractArticleText(ARTICLE_HTML)!;
    expect(text).toContain("encoded in DNA");
    expect(text).toContain("cardiac cycle");
    expect(text).not.toContain("PDF is loading");
    expect(text).not.toContain("Buy your pamphet");
    expect(text).not.toContain("Page 1 of 2");
    expect(text.length).toBeGreaterThanOrEqual(200);
  });

  it("contenu trop court (boilerplate seul) → null, pas de faux texte", () => {
    expect(extractArticleText("<article><p>Short page.</p></article>")).toBeNull();
  });
});

describe("8.91 — matchSubject (recherche floue)", () => {
  const subjects: GceSubject[] = [
    { name: "Biology", url: "u1", level: "al" },
    { name: "Chemistry", url: "u2", level: "al" },
    { name: "Mathematics", url: "u3", level: "al" },
    { name: "Additional Math", url: "u4", level: "ol" },
    { name: "Food and nutrition", url: "u5", level: "ol" },
    { name: "Computer science", url: "u6", level: "al" }
  ];
  it("alias usuels et noms exacts", () => {
    expect(matchSubject(subjects, "bio")?.name).toBe("Biology");
    expect(matchSubject(subjects, "biology")?.name).toBe("Biology");
    expect(matchSubject(subjects, "math")?.name).toBe("Mathematics");
    expect(matchSubject(subjects, "chemistry")?.name).toBe("Chemistry");
    expect(matchSubject(subjects, "comp sci")?.name).toBe("Computer science");
    expect(matchSubject(subjects, "food")?.name).toBe("Food and nutrition");
  });
  it("inconnu → null", () => {
    expect(matchSubject(subjects, "zoulou")).toBeNull();
    expect(matchSubject(subjects, "")).toBeNull();
  });
});

describe("8.91 — intégration structurelle", () => {
  it("le préfixe gce_ est couvert par la purge des débris (8.90/8.91)", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/services/tmpDebris.ts"), "utf8");
    expect(src).toContain('"gce_"');
  });
});
