/**
 * ============================================================================
 *  NEBULA - Candidate API Probe (new commands viability, owner request 8.65)
 * ============================================================================
 *  Run ON THE SERVER where the bot lives (datacenter IP realism matters):
 *
 *      npm run api:probe            # fast checks (~30s)
 *      npm run api:probe -- --full  # + trace.moe live search + yt-dlp metadata
 *
 *  Probes the candidate sources for future commands approved for scouting:
 *    CORE   1. trace.moe  (anime scene reverse-search, keyless, ~1k/mo per IP)
 *           2. ESPN hidden API (live soccer/basketball scores, keyless)
 *           3. yt-dlp (universal downloader: facebook/twitter/tiktok/...)
 *    BONUS  4. BBC Afrique RSS (.news)   5. CoinGecko (.crypto)
 *           6. is.gd (.short)            7. waifu.pics (anime gifs)
 *           8. Jikan v4 (.animeinfo - client already integrated)
 *
 *  Read-only network diagnostics: no files written, nothing installed.
 *  Exit code: 1 only when EVERY core probe is unusable (nothing to build on).
 */

import "dotenv/config";
import axios from "axios";
import { spawnSync } from "child_process";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FULL = process.argv.includes("--full");

const hr = () => console.log("─".repeat(78));
type Status = "PASS" | "WARN" | "FAIL" | "SKIP";
const rows: Array<{ group: string; name: string; status: Status; detail: string; hint?: string }> =
  [];
function row(group: string, name: string, status: Status, detail: string, hint?: string) {
  rows.push({ group, name, status, detail, hint });
}
async function getJson(url: string, timeoutMs = 12000): Promise<{ status: number; data: any }> {
  const res = await axios.get(url, {
    headers: { "User-Agent": UA, Accept: "application/json, text/*, */*" },
    timeout: timeoutMs,
    validateStatus: () => true,
  });
  return { status: res.status, data: res.data };
}
const evCount = (d: any): number => (Array.isArray(d?.events) ? d.events.length : -1);

// ── CORE 1: trace.moe ────────────────────────────────────────────────────────
async function probeTraceMoe() {
  try {
    const me = await getJson("https://api.trace.moe/me");
    if (me.status !== 200) {
      row(
        "CORE 1/3",
        "trace.moe reachability",
        "FAIL",
        `HTTP ${me.status}`,
        "API injoignable depuis cette IP — commande .trace non viable ici.",
      );
      return;
    }
    let quota = "";
    const remain = (me.data as any)?.user?.quota ?? (me.data as any)?.quota;
    if (typeof remain === "number") quota = ` (quota restant ce mois : ${remain})`;
    row(
      "CORE 1/3",
      "trace.moe reachability",
      "PASS",
      `HTTP 200${quota}`,
      "Reverse-search d'images anime SANS clé (~1000 req/mois par IP en anonyme).",
    );
    if (!FULL) {
      row(
        "CORE 1/3",
        "trace.moe live search",
        "SKIP",
        "lancé avec --full",
        "Recherche réelle sur l'image de démo officielle.",
      );
      return;
    }
    const search = await getJson(
      "https://api.trace.moe/search?url=https%3A%2F%2Ftrace.moe%2Fmozai.png",
      20000,
    );
    if (
      search.status === 200 &&
      Array.isArray(search.data?.result) &&
      search.data.result.length > 0
    ) {
      const best = search.data.result[0];
      const at =
        typeof best.from === "number"
          ? `${Math.floor(best.from / 60)}:${String(Math.floor(best.from % 60)).padStart(2, "0")}`
          : "?";
      row(
        "CORE 1/3",
        "trace.moe live search (--full)",
        "PASS",
        `Match: ${best.anime?.title ?? "?"} (ép. ${best.episode ?? "?"} à ${at}, similarité ${Math.round((best.similarity || 0) * 100)}%)`,
        "Le pipeline complet fonctionne depuis ce VPS.",
      );
    } else {
      row(
        "CORE 1/3",
        "trace.moe live search (--full)",
        "WARN",
        `HTTP ${search.status} / résultat vide`,
        "Atteignable mais la recherche de démo n'a rien renvoyé — réessayer plus tard.",
      );
    }
  } catch (e: any) {
    row(
      "CORE 1/3",
      "trace.moe reachability",
      "FAIL",
      e?.message || String(e),
      "API injoignable depuis cette IP — commande .trace non viable ici.",
    );
  }
}

// ── CORE 2: ESPN hidden API ──────────────────────────────────────────────────
async function probeEspn() {
  const targets: Array<[string, string]> = [
    ["soccer eng.1 (Premier League)", "soccer/eng.1"],
    ["soccer fifa.world (Mondial)", "soccer/fifa.world"],
    ["basketball nba", "basketball/nba"],
  ];
  let ok = 0;
  for (const [label, path] of targets) {
    try {
      const r = await getJson(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`);
      const n = evCount(r.data);
      if (r.status === 200 && n >= 0) {
        ok++;
        row(
          "CORE 2/3",
          `ESPN ${label}`,
          "PASS",
          `HTTP 200, ${n} événement(s)`,
          n === 0
            ? "Atteignable — aucun match dans la fenêtre (normal hors matchs)."
            : "Scores live exploitables SANS clé.",
        );
      } else {
        row(
          "CORE 2/3",
          `ESPN ${label}`,
          "WARN",
          `HTTP ${r.status}, events=${n}`,
          "Endpoint instable ou format changé.",
        );
      }
    } catch (e: any) {
      row("CORE 2/3", `ESPN ${label}`, "FAIL", e?.message || String(e));
    }
  }
  if (ok === 0)
    row(
      "CORE 2/3",
      "ESPN global",
      "FAIL",
      "aucune ligue atteinte",
      "Commande .foot non viable depuis cette IP.",
    );
}

// ── CORE 3: yt-dlp ───────────────────────────────────────────────────────────
function probeYtDlp() {
  const candidates: Array<[string, string[]]> = [
    ["yt-dlp", ["--version"]],
    ["python3 -m yt_dlp", ["-m", "yt_dlp", "--version"]],
  ];
  for (const [label, args] of candidates) {
    const r = spawnSync(label.split(" ")[0], args, { timeout: 10000, encoding: "utf8" });
    if (r.status === 0 && (r.stdout || "").trim()) {
      row(
        "CORE 3/3",
        `yt-dlp (${label})`,
        "PASS",
        `v${(r.stdout || "").trim()}`,
        "Téléchargeur universel présent : .facebook/.twitter + secours tiktok/instagram/youtube possible.",
      );
      if (FULL) {
        const meta = spawnSync(
          label.split(" ")[0],
          [
            ...(args.length > 1 ? args.slice(0, -1) : []),
            "-J",
            "--no-warnings",
            "--no-playlist",
            "--socket-timeout",
            "15",
            "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
          ],
          { timeout: 45000, encoding: "utf8" },
        );
        if (meta.status === 0 && meta.stdout) {
          try {
            const j = JSON.parse(meta.stdout);
            row(
              "CORE 3/3",
              "yt-dlp metadata probe (--full)",
              "PASS",
              `Extraction OK: « ${j.title} » (${j.extractor})`,
              "L'extraction de métadonnées fonctionne (téléchargement réel non testé).",
            );
          } catch {
            row(
              "CORE 3/3",
              "yt-dlp metadata probe (--full)",
              "WARN",
              "sortie non-JSON",
              "Vérifier manuellement.",
            );
          }
        } else {
          row(
            "CORE 3/3",
            "yt-dlp metadata probe (--full)",
            "WARN",
            `exit ${meta.status}: ${(meta.stderr || "").trim().split("\n").slice(-1)[0] || ""}`,
            "Binaire présent mais l'extraction a échoué (YouTube bride parfois les IP datacenter).",
          );
        }
      }
      return;
    }
  }
  row(
    "CORE 3/3",
    "yt-dlp",
    "WARN",
    "binaire absent du PATH",
    "Installation VPS : sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp (ou pip install yt-dlp). Puis relancer la sonde.",
  );
}

// ── BONUS probes ─────────────────────────────────────────────────────────────
async function probeBonus() {
  try {
    const r = await getJson("https://feeds.bbci.co.uk/french/rss.xml", 10000);
    const hasItems = typeof r.data === "string" && r.data.includes("<item");
    row(
      "BONUS",
      "BBC Afrique RSS (.news)",
      r.status === 200 && hasItems ? "PASS" : "WARN",
      `HTTP ${r.status}${hasItems ? ", <item> présents" : ", format inattendu"}`,
    );
  } catch (e: any) {
    row("BONUS", "BBC Afrique RSS (.news)", "FAIL", e?.message || String(e));
  }
  try {
    const r = await getJson(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=xaf,usd",
    );
    const xaf = r.data?.bitcoin?.xaf;
    row(
      "BONUS",
      "CoinGecko (.crypto)",
      r.status === 200 && typeof xaf === "number" ? "PASS" : "WARN",
      r.status === 200 ? `BTC = ${xaf?.toLocaleString("fr-FR")} XAF` : `HTTP ${r.status}`,
      "Gratuit sans clé (limites ~10-30 req/min).",
    );
  } catch (e: any) {
    row("BONUS", "CoinGecko (.crypto)", "FAIL", e?.message || String(e));
  }
  try {
    const r = await getJson("https://is.gd/create.php?format=json&url=https://example.com/");
    row(
      "BONUS",
      "is.gd (.short)",
      r.status === 200 && r.data?.shorturl ? "PASS" : "WARN",
      r.data?.shorturl ? `exemple → ${r.data.shorturl}` : `HTTP ${r.status}`,
    );
  } catch (e: any) {
    row("BONUS", "is.gd (.short)", "FAIL", e?.message || String(e));
  }
  try {
    const r = await getJson("https://api.waifu.pics/sfw/waifu", 10000);
    row(
      "BONUS",
      "waifu.pics (.waifu)",
      r.status === 200 && r.data?.url ? "PASS" : "WARN",
      r.data?.url ? String(r.data.url).slice(0, 60) + "…" : `HTTP ${r.status}`,
    );
  } catch (e: any) {
    row("BONUS", "waifu.pics (.waifu)", "FAIL", e?.message || String(e));
  }
  try {
    const r = await getJson("https://api.jikan.moe/v4/top/anime?limit=1");
    row(
      "BONUS",
      "Jikan v4 (.animeinfo)",
      r.status === 200 && r.data?.data?.length ? "PASS" : "WARN",
      r.status === 200 ? "top anime OK" : `HTTP ${r.status}`,
      "Client déjà intégré au bot — juste à exposer.",
    );
  } catch (e: any) {
    row("BONUS", "Jikan v4 (.animeinfo)", "FAIL", e?.message || String(e));
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
(async () => {
  console.log("NEBULA — Sondes APIs candidates (8.65)");
  console.log(`node ${process.version} · mode ${FULL ? "--full" : "rapide"} (rapide = ~30 s)`);
  hr();
  await probeTraceMoe();
  await probeEspn();
  probeYtDlp();
  await probeBonus();

  hr();
  console.log("RESULTS");
  hr();
  const icon: Record<Status, string> = {
    PASS: "[PASS]",
    WARN: "[WARN]",
    FAIL: "[FAIL]",
    SKIP: "[SKIP]",
  };
  for (const r of rows) {
    console.log(`${icon[r.status]} [${r.group}] ${r.name}`);
    console.log(`        ${r.detail}`);
    if (r.hint) console.log(`        -> ${r.hint}`);
  }
  const corePass = rows.filter((r) => r.group.startsWith("CORE") && r.status === "PASS").length;
  hr();
  console.log(
    `Summary: ${rows.filter((r) => r.status === "PASS").length} pass, ${rows.filter((r) => r.status === "WARN").length} warn, ${rows.filter((r) => r.status === "FAIL").length} fail`,
  );
  if (corePass === 0) {
    console.log(
      "\nDiagnosis: aucune sonde CORE accessible — pas de base viable pour les nouvelles commandes depuis cet hôte.",
    );
    process.exit(1);
  }
  console.log(
    `\nDiagnosis: ${corePass} source(s) CORE viable(s) depuis cet hôte — envoie ce rapport à l'agent pour décider quelles commandes implémenter.`,
  );
})().catch((e) => {
  console.error("Sonde interrompue:", e?.message || e);
  process.exit(1);
});
