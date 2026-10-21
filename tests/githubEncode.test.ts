import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  dispatchInputs,
  ghEncoderConfig,
  pickCandidateRun,
  type GhRunLike
} from "../src/bot/services/githubEncode.js";

// 9.18eee — encodage déporté sur GitHub Actions (idée owner 17/10) :
// config, corps du dispatch, identification du run. L'orchestration réseau
// (dispatch → poll → artefact) est couverte par le repli local : tout échec
// GitHub rend null et .slim encode en local — testée par wiring.

describe("9.18eee — ghEncoderConfig (activation)", () => {
  beforeEach(() => {
    delete process.env.NEBULA_GH_TOKEN;
    delete process.env.NEBULA_GH_REPO;
  });
  afterEach(() => {
    delete process.env.NEBULA_GH_TOKEN;
    delete process.env.NEBULA_GH_REPO;
  });

  it("sans token ni repo → null (toujours local)", () => {
    expect(ghEncoderConfig()).toBeNull();
  });

  it("token sans repo (ou repo malformé) → null", () => {
    process.env.NEBULA_GH_TOKEN = "github_pat_abc";
    expect(ghEncoderConfig()).toBeNull();
    process.env.NEBULA_GH_REPO = "pas-un-slash";
    expect(ghEncoderConfig()).toBeNull();
  });

  it("token + repo owner/repo → config complète", () => {
    process.env.NEBULA_GH_TOKEN = "github_pat_abc";
    process.env.NEBULA_GH_REPO = "bot-encoder/nebula-encoder";
    expect(ghEncoderConfig()).toEqual({ token: "github_pat_abc", repo: "bot-encoder/nebula-encoder" });
  });
});

describe("9.18eee — dispatchInputs (corps du workflow_dispatch)", () => {
  it("les inputs du workflow, en chaînes", () => {
    expect(dispatchInputs("https://dash2.example/api/media/download/tok", "Mushoku_E13.mp4", 988)).toEqual({
      source_url: "https://dash2.example/api/media/download/tok",
      filename: "Mushoku_E13.mp4",
      video_kbps: "988"
    });
  });
});

describe("9.18eee — pickCandidateRun (identification du run)", () => {
  const T0 = Date.parse("2026-10-17T04:00:00Z");

  it("prend le plus récent run workflow_dispatch dans la fenêtre", () => {
    const runs: GhRunLike[] = [
      { id: 101, event: "workflow_dispatch", status: "completed", created_at: new Date(T0 - 3600_000).toISOString() },
      { id: 102, event: "push", status: "completed", created_at: new Date(T0 + 1000).toISOString() },
      { id: 103, event: "workflow_dispatch", status: "in_progress", created_at: new Date(T0 + 2000).toISOString() },
      { id: 104, event: "workflow_dispatch", status: "queued", created_at: new Date(T0 + 3000).toISOString() }
    ];
    // 101 = trop vieux (avant le dispatch), 102 = mauvais événement.
    expect(pickCandidateRun(runs, T0)?.id).toBe(104);
  });

  it("tolère 30 s d'horloge décalée (run créé juste avant le dispatch vu par l'API)", () => {
    const runs: GhRunLike[] = [
      { id: 105, event: "workflow_dispatch", status: "in_progress", created_at: new Date(T0 - 25_000).toISOString() }
    ];
    expect(pickCandidateRun(runs, T0)?.id).toBe(105);
  });

  it("rien de valide → null (pas de faux positif)", () => {
    expect(pickCandidateRun([], T0)).toBeNull();
    expect(
      pickCandidateRun([{ id: 106, event: "workflow_dispatch", status: "queued", created_at: "pas-une-date" }], T0)
    ).toBeNull();
    expect(
      pickCandidateRun([{ id: 107, event: "workflow_dispatch", status: "queued", created_at: new Date(T0 - 3600_000).toISOString() }], T0)
    ).toBeNull();
  });
});

describe("9.18eee — wiring (l'idée owner, câblée de bout en bout)", () => {
  const readSrc = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

  it(".slim essaie GitHub AVANT le local, et retombe toujours sur le local", () => {
    const slim = readSrc("src/bot/commands/slim.ts");
    const ghIdx = slim.indexOf("githubSlimEncode(");
    const localIdx = slim.indexOf('mode: "aggressive"');
    expect(ghIdx).toBeGreaterThan(-1);
    expect(localIdx).toBeGreaterThan(ghIdx); // GitHub d'abord, local en repli
    expect(slim).toContain("ghEncoderConfig()");
    expect(slim).toContain("slimAggressiveKbps"); // le kbps cible est calculé par le VPS
    expect(slim).toContain("keepOriginal: true"); // l'original (et son lien) restent
  });

  it("l'offre transporte le lien /d/ que le runner télécharge", () => {
    const offer = readSrc("src/bot/services/slimOffer.ts");
    expect(offer).toContain("sourceUrl");
    const novabox = readSrc("src/bot/commands/novabox.ts");
    expect(novabox).toContain("sourceUrl: tempDownloadLink");
  });

  it("un seul encodage GitHub à la fois (chaîne process-wide)", () => {
    const svc = readSrc("src/bot/services/githubEncode.ts");
    expect(svc).toContain("let ghChain");
    expect(svc).toContain("enqueueGh");
  });

  it("le token ne vit QUE dans l'env — jamais dans le code ni le repo", () => {
    const svc = readSrc("src/bot/services/githubEncode.ts");
    expect(svc).toContain("process.env.NEBULA_GH_TOKEN");
    expect(svc).not.toMatch(/github_pat_[A-Za-z0-9]{10,}/); // aucun token en dur
  });

  it("opérationneur : env documenté + panneau + copie de référence du workflow", () => {
    expect(readSrc(".env.example")).toContain("NEBULA_GH_TOKEN");
    expect(readSrc(".env.example")).toContain("NEBULA_GH_REPO");
    expect(readSrc("src/panel/envRoutes.ts")).toContain("NEBULA_GH_TOKEN");
    expect(readSrc("src/panel/envRoutes.ts")).toContain("NEBULA_GH_REPO");
    const wf = readSrc("docs/slim-encode.workflow.yml");
    expect(wf).toContain("workflow_dispatch");
    expect(wf).toContain("tune animation");
    expect(wf).toContain("slim-output");
  });
});

describe("9.18eeee — retrieval de l'artefact (terrain 21/10 : Invalid URL APRES un run GitHub reussi)", () => {
  const readSrc = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

  it("l'URL du zip utilise archive_download_url — archive_url n'existe PAS dans l'API artefacts (verifie live)", () => {
    const svc = readSrc("src/bot/services/githubEncode.ts");
    expect(svc).toContain("archive_download_url");
    // Terrain : art.archive_url = undefined -> axios.get(undefined) -> Invalid URL
    // -> « echec recuperation » alors que le run avait REUSSI.
    expect(svc).not.toContain("art.archive_url");
  });

  it("repli : l'URL canonique du zip est construite si le champ est absent ou mal forme", () => {
    const svc = readSrc("src/bot/services/githubEncode.ts");
    expect(svc).toContain("actions/artifacts/${art.id}/zip");
    expect(svc).toContain("/^https?:\\/\\//i.test(art.archive_download_url)");
  });
});
