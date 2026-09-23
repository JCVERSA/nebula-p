import { describe, expect, it } from "vitest";
import {
  applyLanguagePolicy,
  classifyByLanguage,
  foldTitleDiacritics,
  languagesOf,
  otherFlagOf,
  samaSubPathLanguage,
  searchEmptyMessage,
  vaDisabledMessage,
  voiranimeSlugLanguage
} from "../src/bot/services/animeSources.js";
import { parseQuickDownloadParams } from "../src/bot/utils/quickAnimeParser.js";

/**
 * 8.69 (refonte sources choisies) — unit coverage of the source model:
 * catalog flags, structural language detection, mono-source language
 * policy (strict VF, VOSTFR guide) and anonymized messages.
 */

const PRIVACY_RE = /nakanime|voir[- ]?anime|franime|anime[- ]?sama/i;

describe("parseQuickDownloadParams — catalog flag (8.69)", () => {
  it("strips a leading `as`/`va` flag and reports it", () => {
    expect(parseQuickDownloadParams(["as", "solo", "leveling"]).source).toBe("as");
    expect(parseQuickDownloadParams(["va", "solo", "leveling"]).source).toBe("va");
    expect(parseQuickDownloadParams(["VA", "solo"]).source).toBe("va");
    expect(parseQuickDownloadParams(["as=", "jjk"]).source).toBe("as");
  });

  it("flag only counts as the FIRST token, with a title after it", () => {
    // "as" mid-title is part of the title
    expect(parseQuickDownloadParams(["as", "the", "gods", "will"]).source).toBe("as");
    expect(parseQuickDownloadParams(["the", "as", "gods"]).source).toBeUndefined();
    // `.a as` alone is not a flag (usage screen), and neither is a bare title
    expect(parseQuickDownloadParams(["as"]).source).toBeUndefined();
    expect(parseQuickDownloadParams(["astray", "s1"]).source).toBeUndefined();
    expect(parseQuickDownloadParams(["solo", "leveling"]).source).toBeUndefined();
  });

  it("combines with language, season, episodes and resolution (quick syntax)", () => {
    const p = parseQuickDownloadParams(["va", "jjk", "s3", "ep6", "r2", "vostfr"]);
    expect(p.source).toBe("va");
    expect(p.animeQuery).toBe("jjk");
    expect(p.seasonNumber).toBe(3);
    expect(p.language).toBe("VOSTFR");
    expect(p.resolutionChoice).toBe("r2");
  });

  it("the title keeps its own words when no flag is present", () => {
    const p = parseQuickDownloadParams(["vanitas", "no", "carte", "s1"]);
    expect(p.source).toBeUndefined();
    expect(p.animeQuery).toBe("vanitas no carte");
  });
});

describe("structural language detection (8.69)", () => {
  it("samaSubPathLanguage reads the season sub-path", () => {
    expect(samaSubPathLanguage("saison1/vostfr")).toBe("VOSTFR");
    expect(samaSubPathLanguage("saison2/vf")).toBe("VF");
    expect(samaSubPathLanguage("film/vf")).toBe("VF");
    expect(samaSubPathLanguage("oav/vostfr")).toBe("VOSTFR");
    expect(samaSubPathLanguage("saison1")).toBeNull();
    expect(samaSubPathLanguage("")).toBeNull();
  });

  it("voiranimeSlugLanguage reads the entry slug", () => {
    expect(voiranimeSlugLanguage("tomb-raider-king-vf")).toBe("VF");
    expect(voiranimeSlugLanguage("tomb-raider-king-vostfr")).toBe("VOSTFR");
    expect(voiranimeSlugLanguage("https://voir-anime.to/anime/solo-leveling-vf/")).toBe("VF");
    expect(voiranimeSlugLanguage("solo-leveling")).toBeNull();
  });

  it("classifyByLanguage + languagesOf split honestly", () => {
    const items = [
      { name: "S1 VF", language: "VF" as const },
      { name: "S1 VOSTFR", language: "VOSTFR" as const },
      { name: "S?", language: null }
    ];
    const c = classifyByLanguage(items);
    expect(c.vf).toHaveLength(1);
    expect(c.vostfr).toHaveLength(1);
    expect(c.other).toHaveLength(1);
    expect(languagesOf(items)).toEqual(["VF", "VOSTFR"]);
    expect(languagesOf([{ language: "VF" as const }])).toEqual(["VF"]);
    expect(languagesOf([{ language: null }])).toEqual(["VOSTFR"]);
  });
});

describe("applyLanguagePolicy — mono-source, strict (8.69)", () => {
  const vf = { name: "Saison 1", language: "VF" as const };
  const vostfr = { name: "Saison 1", language: "VOSTFR" as const };

  it("VF requested with VF seasons → VF, no header", () => {
    const r = applyLanguagePolicy([vf, vostfr], "VF", "as");
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.language).toBe("VF");
      expect(r.seasons).toEqual([vf]);
      expect(r.header).toBeUndefined();
    }
  });

  it("VF requested, none exists → VOSTFR seasons LISTED with a clear header (display decision)", () => {
    const r = applyLanguagePolicy([vostfr], "VF", "as");
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.language).toBe("VOSTFR");
      expect(r.seasons).toEqual([vostfr]);
      expect(r.header).toContain("Aucune VF");
      expect(r.guideHint).toContain("`.a va <titre>`");
    }
  });

  it("VOSTFR requested, none exists → honest failure + other-flag guide", () => {
    const r = applyLanguagePolicy([vf], "VOSTFR", "as");
    expect(r.status).toBe("missing");
    if (r.status === "missing") {
      expect(r.message).toContain("Aucun VOSTFR");
      expect(r.message).toContain("`.a va <titre> vostfr`");
      expect(r.message).toContain("existe en VF");
    }
  });

  it("VOSTFR requested, none exists, no VF either → guide without the VF note", () => {
    const r = applyLanguagePolicy([], "VOSTFR", "va");
    expect(r.status).toBe("missing");
    if (r.status === "missing") {
      expect(r.message).toContain("`.a as <titre> vostfr`");
      expect(r.message).not.toContain("existe en VF");
    }
  });

  it("unlabeled seasons surface as language-unknown, never guessed", () => {
    const r = applyLanguagePolicy([{ name: "S1", language: null }], "VF", "as");
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.language).toBe("VOSTFR");
      expect(r.header).toContain("ne précise pas la langue");
    }
  });
});

describe("anonymized messages (8.42, extended 8.69)", () => {
  it("searchEmptyMessage guides spelling + the other flag, without naming any site", () => {
    const m1 = searchEmptyMessage("sololeveling", "va");
    const m2 = searchEmptyMessage("vinland", "as");
    expect(m1).toContain("Vérifie l'orthographe");
    expect(m1).toContain("sépare bien les mots");
    expect(m2).toContain("`.a va <titre>`");
    expect(PRIVACY_RE.test(m1)).toBe(false);
    expect(PRIVACY_RE.test(m2)).toBe(false);
  });

  it("vaDisabledMessage never names the source", () => {
    expect(PRIVACY_RE.test(vaDisabledMessage())).toBe(false);
  });

  it("otherFlagOf inverts", () => {
    expect(otherFlagOf("as")).toBe("va");
    expect(otherFlagOf("va")).toBe("as");
  });
});

describe("foldTitleDiacritics (moved to animeSources, 8.69)", () => {
  it("still folds macrons to Hepburn and strips diacritics", () => {
    expect(foldTitleDiacritics("Komyushō")).toBe("Komyushou");
    expect(foldTitleDiacritics("Komi-san wa, Komyushou desu.")).toBe("Komi-san wa, Komyushou desu.");
    expect(foldTitleDiacritics("Frieren")).toBe("Frieren");
  });
});
