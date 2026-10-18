/**
 * 9.18lll — sélection auto du flux rapide (retour terrain 18/10).
 *
 * « the rampart of ice s1 ep 9-10 en 480 » : le catalogue répond
 * « Saison 1 » et « Saison 2 » comme entrées séparées ; le bot demandait
 * « 1 ou 2 ? » alors que la demande avait DÉJÀ dit s1.
 * pickQuickAutoChoice désigne l'entrée quand saison/langue rendent le
 * choix non ambigu — et JAMAIS autrement (écran de sélection sinon).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  pickQuickAutoChoice,
  pickVaQuickAutoChoice,
  type QuickDownloadParams,
} from "../src/bot/utils/quickAnimeParser.js";

interface FakeResult {
  title: string;
  subtitle?: string;
  url: string;
}

const mk = (title: string, subtitle?: string): FakeResult => ({ title, subtitle, url: `https://x/${title}` });

const qp = (over: Partial<QuickDownloadParams> = {}): QuickDownloadParams => ({
  rawInput: "the rampart of ice s1 e9-10 480p",
  animeQuery: "the rampart of ice",
  canonicalQuery: "the rampart of ice",
  isQuickCommand: true,
  ...over,
});

const TERRAIN: FakeResult[] = [mk("The Ramparts of Ice — Saison 1"), mk("The Ramparts of Ice — Saison 2")];

describe("9.18lll — pickQuickAutoChoice (pur)", () => {
  it("LE CAS TERRAIN : « s1 » + entrées Saison 1/Saison 2 → Saison 1 sans poser la question", () => {
    expect(pickQuickAutoChoice(TERRAIN, qp({ seasonNumber: 1 }))).toBe(TERRAIN[0]);
  });

  it("s2 → Saison 2", () => {
    expect(pickQuickAutoChoice(TERRAIN, qp({ seasonNumber: 2 }))).toBe(TERRAIN[1]);
  });

  it("pas de saison dans la demande → null (l'écran de sélection reste honnête)", () => {
    expect(pickQuickAutoChoice(TERRAIN, qp())).toBeNull();
  });

  it("formats de libellés : « Season 2 », « S2 », « S02 », VF/VOSTFR en sous-titre", () => {
    const en = [mk("X — Season 1"), mk("X — Season 2")];
    expect(pickQuickAutoChoice(en, qp({ seasonNumber: 2 }))).toBe(en[1]);
    const s = [mk("X S1", "VF"), mk("X S02", "VF")];
    expect(pickQuickAutoChoice(s, qp({ seasonNumber: 2 }))).toBe(s[1]);
    const sub = [mk("X", "VF"), mk("X", "VOSTFR")];
    expect(pickQuickAutoChoice(sub, qp({ language: "VOSTFR" }))).toBe(sub[1]);
  });

  it("langue demandée d'abord, puis saison : VF+VOSTFR × S1/S2 + « vostfr s1 » → la VOSTFR S1", () => {
    const r = [mk("X — Saison 1", "VF"), mk("X — Saison 2", "VF"), mk("X — Saison 1", "VOSTFR"), mk("X — Saison 2", "VOSTFR")];
    expect(pickQuickAutoChoice(r, qp({ language: "VOSTFR", seasonNumber: 1 }))).toBe(r[2]);
  });

  it("ambiguïté réelle → null : Saison 10 vs Saison 1 (pas de faux match), 0 ou 1 entrée → null", () => {
    // « Saison 10 » ne doit PAS matcher n=1 (garde (?!\d))
    const dix = [mk("X — Saison 1"), mk("X — Saison 10")];
    expect(pickQuickAutoChoice(dix, qp({ seasonNumber: 1 }))).toBe(dix[0]);
    expect(pickQuickAutoChoice(dix, qp({ seasonNumber: 10 }))).toBe(dix[1]);
    // entrées sans marque de saison → null
    expect(pickQuickAutoChoice([mk("X Part 1"), mk("X Part 2")], qp({ seasonNumber: 1 }))).toBeNull();
    // 0/1 entrée : hors périmètre (1 résultat = auto-sélection en amont)
    expect(pickQuickAutoChoice([], qp({ seasonNumber: 1 }))).toBeNull();
    expect(pickQuickAutoChoice([mk("X")], qp({ seasonNumber: 1 }))).toBeNull();
  });

  it("label personnalisé (libellés vfScreen) utilisé pour la détection", () => {
    const labels = new Map<FakeResult, string>([
      [TERRAIN[0], "The Ramparts of Ice — Saison 1 (VF)"],
      [TERRAIN[1], "The Ramparts of Ice — Saison 2 (VF)"],
    ]);
    expect(pickQuickAutoChoice(TERRAIN, qp({ seasonNumber: 2 }), (r) => labels.get(r) || r.title)).toBe(TERRAIN[1]);
  });
});

describe("9.18lll — câblage novabox (source)", () => {
  it("le flux rapide tente la sélection auto AVANT l'écran de sélection", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/bot/commands/novabox.ts"), "utf-8");
    expect(src).toContain("pickVaQuickAutoChoice(searchResults, quickParams");
    const auto = src.indexOf("pickVaQuickAutoChoice(searchResults, quickParams");
    const exact = src.indexOf("const matchResult = isExactAnimeMatch(quickParams.animeQuery");
    expect(auto).toBeGreaterThan(-1);
    expect(exact).toBeGreaterThan(auto); // auto d'abord, écran en dernier recours
    expect(src).toContain("sélection auto"); // log terrain [NOVABOX]
  });
});

interface FakeVaResult {
  title: string;
  subtitle?: string;
  url: string;
  language?: string | null;
}

const mkVa = (title: string, language: "VF" | "VOSTFR"): FakeVaResult => ({
  title,
  subtitle: language,
  url: `https://x/${encodeURIComponent(title)}`,
  language,
});
const vaLabel = (r: FakeVaResult) => `${r.title} (${r.language})`;

describe("9.18ooo — pickVaQuickAutoChoice (écran mixte : la préférence VF tranche)", () => {
  it("« s1 » avec S1 en VF ET en VOSTFR → la VF (défaut 9.9), sans repose de question", () => {
    const pool = [
      mkVa("Re:Zero — Saison 1", "VF"),
      mkVa("Re:Zero — Saison 2", "VF"),
      mkVa("Re:Zero — Saison 1", "VOSTFR"),
      mkVa("Re:Zero — Saison 2", "VOSTFR"),
    ];
    const pick = pickVaQuickAutoChoice(pool, qp({ seasonNumber: 1 }), vaLabel);
    expect(pick?.language).toBe("VF");
    expect(vaLabel(pick!)).toContain("Saison 1");
  });

  it("la saison n'existe qu'en VOSTFR → l'entrée VOSTFR (l'écran mixte l'aurait montrée)", () => {
    const pool = [
      mkVa("Re:Zero — Saison 2", "VF"),
      mkVa("Re:Zero — Saison 1", "VOSTFR"),
      mkVa("Re:Zero — Saison 2", "VOSTFR"),
    ];
    const pick = pickVaQuickAutoChoice(pool, qp({ seasonNumber: 1 }), vaLabel);
    expect(pick?.language).toBe("VOSTFR");
  });

  it("langue explicite → le filtre langue s'applique sur la liste mixte", () => {
    const pool = [mkVa("Re:Zero — Saison 1", "VF"), mkVa("Re:Zero — Saison 1", "VOSTFR")];
    const pick = pickVaQuickAutoChoice(pool, qp({ language: "VOSTFR", seasonNumber: 1 }), vaLabel);
    expect(pick?.language).toBe("VOSTFR");
  });

  it("ambiguïté réelle (deux « Saison 1 » en VF) → null, l'écran reste la réponse honnête", () => {
    const pool = [mkVa("Re:Zero — Saison 1", "VF"), mkVa("Re:Edit — Saison 1", "VF")];
    expect(pickVaQuickAutoChoice(pool, qp({ seasonNumber: 1 }), vaLabel)).toBeNull();
  });
});
