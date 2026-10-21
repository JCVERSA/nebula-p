import fs from "fs";
import os from "os";
import path from "path";
import axios from "axios";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * ============================================================================
 *  9.18eee — encodage déporté sur GitHub Actions (idée owner 17/10)
 * ============================================================================
 *  « Et si les conversions tournaient sur des workflows GitHub ? » — oui :
 *  le repo public dédié (NEBULA_GH_REPO, ex. compte-bot/nebula-encoder) a
 *  des runners GRATUITS (repo public), 4 cœurs / 16 Go — contre 1 cœur /
 *  1 Go sur le VPS. Pendant l'encodage, le VPS ne fait RIEN : plus de sonde
 *  santé qui suffoque, le bot reste vif.
 *
 *  Flux (déclenché par .slim, jamais automatique) :
 *   1. POST /actions/workflows/slim-encode.yml/dispatches (inputs : lien
 *      /d/ du fichier, nom, kbps cible calculé par le VPS) — token PAT
 *      fine-grained du compte bot (Actions read/write sur CE repo seulement,
 *      NEBULA_GH_TOKEN dans .env, jamais dans le code) ;
 *   2. poll du run (15 s, cap NEBULA_GH_TIMEOUT_MS = 15 min) — un seul
 *      encodage GitHub à la fois (chaîne de promesses : l'identification
 *      du run par fenêtre temporelle est alors sans ambiguïté) ;
 *   3. téléchargement de l'artefact (zip), extraction de out.mp4 ;
 *   4. suppression de l'artefact côté GitHub (hygiène), livraison au bot.
 *
 *  TOUT échec (token absent/expiré, GitHub injoignable, run raté, délai
 *  dépassé) → return null → l'appelant bascule sur l'encodage LOCAL
 *  (2-pass 9.18ddd) : l'utilisateur ne voit jamais d'échec, les logs
 *  disent quel moteur a tourné ([GH] ou [SLIM]).
 */

const GH_API = "https://api.github.com";
const WORKFLOW_FILE = "slim-encode.yml";
const ARTIFACT_NAME = "slim-output";
const POLL_INTERVAL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

export interface GhEncoderConfig {
  token: string;
  repo: string; // "owner/repo"
}

/** Pur : config complète ? (token + repo présents dans l'env) */
export function ghEncoderConfig(): GhEncoderConfig | null {
  const token = (process.env.NEBULA_GH_TOKEN || "").trim();
  const repo = (process.env.NEBULA_GH_REPO || "").trim();
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  return { token, repo };
}

/** Pur : corps du dispatch (inputs du workflow). */
export function dispatchInputs(sourceUrl: string, filename: string, videoKbps: number): Record<string, string> {
  return { source_url: sourceUrl, filename, video_kbps: String(videoKbps) };
}

export interface GhRunLike {
  id: number;
  status?: string;
  conclusion?: string | null;
  event?: string;
  created_at?: string;
}

/**
 * Pur : retrouve NOTRE run parmi ceux listés. Contrat : un seul dispatch à
 * la fois (chaîne process-wide) → le plus récent run workflow_dispatch créé
 * dans la fenêtre [since − 30 s, …] est nécessairement le nôtre.
 */
export function pickCandidateRun(runs: GhRunLike[], sinceMs: number): GhRunLike | null {
  const floor = new Date(sinceMs - 30_000).getTime();
  let best: GhRunLike | null = null;
  let bestAt = -1;
  for (const r of runs) {
    if (!r || r.event !== "workflow_dispatch") continue;
    const at = r.created_at ? Date.parse(r.created_at) : NaN;
    if (!Number.isFinite(at) || at < floor) continue;
    if (at >= bestAt) {
      best = r;
      bestAt = at;
    }
  }
  return best;
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "nebula-slim-dispatcher"
  };
}

export interface GhEncodeResult {
  /** Chemin local du MP4 allégé extrait (à enregistrer par l'appelant). */
  path: string;
  bytes: number;
  runId: number;
}

function ghTimeoutMs(): number {
  const v = Number(process.env.NEBULA_GH_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 60_000 ? Math.floor(v) : DEFAULT_TIMEOUT_MS;
}

/** Extrait out.mp4 du zip d'artefact (unzip, repli python3 — Ubuntus modernes). */
async function extractArtifactMp4(zipPath: string, destDir: string): Promise<string> {
  const outPath = path.join(destDir, "out.mp4");
  try {
    await execFileAsync("unzip", ["-o", "-j", zipPath, "out.mp4", "-d", destDir], { timeout: 60_000 });
  } catch {
    await execFileAsync(
      "python3",
      ["-c", "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extract('out.mp4', sys.argv[2])", zipPath, destDir],
      { timeout: 60_000 }
    );
  }
  return outPath;
}

// ── Un seul encodage GitHub à la fois (identification sûre + quotas) ────────
let ghChain: Promise<unknown> = Promise.resolve();

function enqueueGh<T>(job: () => Promise<T>): Promise<T> {
  const run = ghChain.then(job, job);
  ghChain = run.catch(() => {});
  return run;
}

/**
 * Orchestration complète. Ne jette JAMAIS : null = « GitHub n'a pas pu » →
 * l'appelant encode en local (repli 9.18ddd).
 */
export async function githubSlimEncode(opts: {
  sourceUrl: string;
  filename: string;
  videoKbps: number;
  originalBytes: number;
  log?: (message: string) => void;
}): Promise<GhEncodeResult | null> {
  const cfg = ghEncoderConfig();
  if (!cfg) return null;
  const log = opts.log || (() => {});

  return enqueueGh(async (): Promise<GhEncodeResult | null> => {
    const deadline = Date.now() + ghTimeoutMs();
    const dispatchAt = Date.now();
    try {
      // 1) Dispatch
      const disp = await axios.post(
        `${GH_API}/repos/${cfg.repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
        { ref: "main", inputs: dispatchInputs(opts.sourceUrl, opts.filename, opts.videoKbps) },
        { headers: ghHeaders(cfg.token), timeout: 20_000, validateStatus: () => true }
      );
      if (disp.status !== 204) {
        log(`[GH] dispatch refusé (HTTP ${disp.status}) — repli local`);
        return null;
      }
      log(`[GH] run demandé pour « ${opts.filename} » (${opts.videoKbps} kbps)`);
    } catch (err: any) {
      log(`[GH] dispatch impossible : ${err?.message || err} — repli local`);
      return null;
    }

    // 2) Poll — la chaîne garantit qu'un seul run non attribué existe.
    let run: GhRunLike | null = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      try {
        const list = await axios.get(
          `${GH_API}/repos/${cfg.repo}/actions/runs?event=workflow_dispatch&per_page=10`,
          { headers: ghHeaders(cfg.token), timeout: 20_000 }
        );
        run = pickCandidateRun(list.data?.workflow_runs || [], dispatchAt);
        if (!run) continue; // pas encore visible
        const status = String(run.status || "");
        if (status === "queued" || status === "in_progress" || status === "waiting") continue;
        if (status === "completed" && run.conclusion === "success") break;
        log(`[GH] run terminé en ${run.conclusion || "?"} — repli local`);
        return null;
      } catch (err: any) {
        log(`[GH] poll : ${err?.message || err} (nouvel essai)`);
      }
    }
    if (!run || run.status !== "completed" || run.conclusion !== "success") {
      log(`[GH] délai dépassé (${Math.round(ghTimeoutMs() / 60000)} min) — repli local`);
      return null;
    }

    // 3) Artefact : téléchargement + extraction
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-slim-"));
    const zipPath = path.join(tmpDir, "artifact.zip");
    try {
      const arts = await axios.get(
        `${GH_API}/repos/${cfg.repo}/actions/runs/${run.id}/artifacts`,
        { headers: ghHeaders(cfg.token), timeout: 20_000 }
      );
      const art = (arts.data?.artifacts || []).find((a: any) => a?.name === ARTIFACT_NAME && !a?.expired);
      if (!art?.id) {
        log(`[GH] artefact introuvable — repli local`);
        return null;
      }
      // 9.18eeee : le champ de l'API artefacts est « archive_download_url » —
      // « archive_url » N'EXISTE PAS (vérifié sur l'API live). Terrain 21/10 :
      // axios.get(undefined) → « Invalid URL » APRÈS un run GitHub pourtant
      // réussi (dispatch + encodage + upload OK) — seul le rapport était cassé.
      // Repli : l'URL canonique est de toute façon de cette forme.
      const artifactZipUrl =
        typeof art.archive_download_url === "string" && /^https?:\/\//i.test(art.archive_download_url)
          ? art.archive_download_url
          : `${GH_API}/repos/${cfg.repo}/actions/artifacts/${art.id}/zip`;
      const zipResp = await axios.get(artifactZipUrl, {
        headers: ghHeaders(cfg.token),
        timeout: 120_000,
        responseType: "arraybuffer"
      });
      if (zipResp.status !== 200 || !zipResp.data || (zipResp.data as ArrayBuffer).byteLength < 1024) {
        log(`[GH] téléchargement artefact raté (HTTP ${zipResp.status}) — repli local`);
        return null;
      }
      fs.writeFileSync(zipPath, Buffer.from(zipResp.data));

      const mp4Path = await extractArtifactMp4(zipPath, tmpDir);
      const bytes = fs.statSync(mp4Path).size;
      if (bytes < 1024 * 1024 || bytes >= opts.originalBytes) {
        log(`[GH] sortie inutilisable (${(bytes / 1048576).toFixed(1)} Mo) — repli local`);
        return null;
      }

      // 4) Hygiène : l'artefact ne reste pas sur GitHub.
      try {
        await axios.delete(`${GH_API}/repos/${cfg.repo}/actions/artifacts/${art.id}`, {
          headers: ghHeaders(cfg.token),
          timeout: 20_000
        });
      } catch {}

      log(`[GH] ✔ artefact récupéré (${(bytes / 1048576).toFixed(1)} Mo, run ${run.id})`);
      return { path: mp4Path, bytes, runId: run.id };
    } catch (err: any) {
      log(`[GH] échec récupération : ${err?.message || err} — repli local`);
      return null;
    } finally {
      try {
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      } catch {}
    }
  });
}
