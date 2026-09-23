import { describe, it, expect, vi, beforeAll } from "vitest";
import type { AnimeSession } from "../src/bot/commands/novabox.js";

/**
 * Régression 8.78 — bug « isVf codé dur » (audit session 3) :
 *
 * fillVoiranimePlayers() labelait la liste de miroirs voir-anime « VF » par
 * construction (vestige audit 8.9, époque où seul le VF va existait dans le
 * pipeline). Pour une saison va VOSTFR (support structurel depuis 8.69),
 * splitMirrorsByLanguage() classait alors le SEUL vrai miroir va en
 * secondaire (rattrapé de justesse par le fallback « primary vide »).
 *
 * Le label doit porter la langue RÉELLE de la saison câblée.
 */

const PLAYER_URL = "https://voembed.xyz/embed-abc123.html";

vi.mock("../src/bot/services/voiranimeClient.js", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    voiranimeEpisodePlayer: vi.fn(async () => PLAYER_URL),
  };
});

// Import APRÈS le mock (hoisting vi.mock géré par vitest).
const { fillVoiranimePlayers, splitMirrorsByLanguage } = await import("../src/bot/commands/novabox.js");

function makeSession(selectedLanguage: string): AnimeSession {
  return {
    source: "va",
    selectedLanguage,
    voiranimeAnimeUrl: "https://voir-anime.to/anime/mushoku-tensei-s3-vostfr/",
    voiranimeEpisodes: [
      { n: 1, url: "https://voir-anime.to/anime/mushoku-tensei-s3-vostfr/1/" },
      { n: 2, url: "https://voir-anime.to/anime/mushoku-tensei-s3-vostfr/2/" },
    ],
    episodes: { 1: ["", ""] },
    episodeListLabels: {},
  } as unknown as AnimeSession;
}

describe("fillVoiranimePlayers — label de langue réel (bug isVf 8.78)", () => {
  beforeAll(() => {
    vi.resetModules();
  });

  it("étiquette la liste va avec la langue VOSTFR de la saison (pas VF codé dur)", async () => {
    const session = makeSession("VOSTFR");
    await fillVoiranimePlayers(session, [0, 1]);
    expect(session.episodeListLabels?.[1]?.language).toBe("VOSTFR");
    expect(session.episodeListLabels?.[1]?.host).toBe("voembed.xyz");
    // Les deux lecteurs d'épisodes sont résolus dans la liste 1.
    expect(session.episodes?.[1]).toEqual([PLAYER_URL, PLAYER_URL]);
  });

  it("étiquette VF pour une saison VF (comportement historique préservé)", async () => {
    const session = makeSession("VF");
    await fillVoiranimePlayers(session, [0]);
    expect(session.episodeListLabels?.[1]?.language).toBe("VF");
  });

  it("le miroir va VOSTFR est PRIMAIRE pour une demande VOSTFR (fin du classement en secondaire)", async () => {
    const session = makeSession("VOSTFR");
    await fillVoiranimePlayers(session, [0]);
    const { primary, secondary } = splitMirrorsByLanguage(
      session.episodes,
      session.episodeListLabels,
      0,
      "VOSTFR",
    );
    expect(primary).toContain(PLAYER_URL);
    expect(secondary).not.toContain(PLAYER_URL);
  });

  it("le miroir va VF reste primaire pour une demande VF", async () => {
    const session = makeSession("VF");
    await fillVoiranimePlayers(session, [0]);
    const { primary, secondary } = splitMirrorsByLanguage(
      session.episodes,
      session.episodeListLabels,
      0,
      "VF",
    );
    expect(primary).toContain(PLAYER_URL);
    expect(secondary).not.toContain(PLAYER_URL);
  });

  it("sans langue de session (défense), le label retombe sur VF (défaut historique)", async () => {
    const session = makeSession("");
    await fillVoiranimePlayers(session, [0]);
    expect(session.episodeListLabels?.[1]?.language).toBe("VF");
  });
});
