import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  formatProgressBytes,
  formatProgressSpeed,
  formatProgressDuration,
  renderProgressBar,
  computeEwma,
  estimateBytesTotal,
  parseYtDlpProgressLine,
  buildProgressMessage,
  shouldEditProgress,
  needsReanchor,
  PROGRESS_ANCHOR_MAX_MS,
  createProgressReporter,
  type ProgressSendFn
} from "../src/bot/services/progressMessenger.js";

// ------------------------------------------------------------------ formatting

describe("progressMessenger — formatting", () => {
  it("formatProgressBytes: Ko/Mo/Go with French decimal comma", () => {
    expect(formatProgressBytes(0)).toBe("0 Mo");
    expect(formatProgressBytes(820 * 1024)).toBe("820 Ko");
    expect(formatProgressBytes(10.4 * 1024 * 1024)).toBe("10,4 Mo");
    expect(formatProgressBytes(1.24 * 1024 ** 3)).toBe("1,24 Go");
    expect(formatProgressBytes(-5)).toBe("0 Mo");
  });
  it("formatProgressSpeed derives from bytes", () => {
    expect(formatProgressSpeed(2.4 * 1024 * 1024)).toBe("2,4 Mo/s");
    expect(formatProgressSpeed(0)).toBe("—");
    expect(formatProgressSpeed(NaN)).toBe("—");
  });
  it("formatProgressDuration: seconds, minutes+seconds, hours", () => {
    expect(formatProgressDuration(45)).toBe("45 s");
    expect(formatProgressDuration(72)).toBe("1 min 12 s");
    expect(formatProgressDuration(300)).toBe("5 min");
    expect(formatProgressDuration(3900)).toBe("1 h 05 min");
    expect(formatProgressDuration(-1)).toBe("—");
  });
  it("renderProgressBar: width, fill and clamping", () => {
    expect(renderProgressBar(0, 4)).toBe("▱▱▱▱");
    expect(renderProgressBar(0.5, 4)).toBe("▰▰▱▱");
    expect(renderProgressBar(1, 4)).toBe("▰▰▰▰");
    expect(renderProgressBar(1.5, 4)).toBe("▰▰▰▰"); // clamp > 1
    expect(renderProgressBar(-1, 4)).toBe("▱▱▱▱"); // clamp < 0
    expect(renderProgressBar(0.38).length).toBe(24); // largeur par défaut
  });
});

// ----------------------------------------------------------------------- math

describe("progressMessenger — math", () => {
  it("computeEwma: first sample passes through, then smooths", () => {
    expect(computeEwma(null, 10)).toBe(10);
    expect(computeEwma(10, 20, 0.5)).toBe(15);
    expect(computeEwma(10, 20, 0.2)).toBeCloseTo(12, 5);
  });
  it("estimateBytesTotal: null below 5% (too noisy), linear estimate after", () => {
    expect(estimateBytesTotal(5 * 1024 * 1024, 2)).toBeNull();
    expect(estimateBytesTotal(10 * 1024 * 1024, 40)).toBe(25 * 1024 * 1024);
    expect(estimateBytesTotal(0, 50)).toBeNull();
  });
});

// ------------------------------------------------------------------- yt-dlp

describe("parseYtDlpProgressLine", () => {
  it("parses the full [download] line (percent, total, speed, ETA)", () => {
    const s = parseYtDlpProgressLine("[download]  12.3% of ~45.67MiB at 1.23MiB/s ETA 00:32");
    expect(s).not.toBeNull();
    expect(s!.percent).toBeCloseTo(12.3, 5);
    expect(s!.bytesTotal).toBeCloseTo(45.67 * 1024 * 1024, 0);
    expect(s!.speedBps).toBeCloseTo(1.23 * 1024 * 1024, 0);
    expect(s!.etaSeconds).toBe(32);
  });
  it("parses HH:MM:SS ETA and lines without speed/ETA", () => {
    const s = parseYtDlpProgressLine("[download]  55.0% of 1.00GiB at 2.00MiB/s ETA 00:01:05");
    expect(s!.etaSeconds).toBe(65);
    const bare = parseYtDlpProgressLine("[download]  55.0% of 1.00GiB");
    expect(bare!.speedBps).toBeNull();
    expect(bare!.etaSeconds).toBeNull();
  });
  it("returns null for non-progress lines", () => {
    expect(parseYtDlpProgressLine("[youtube] Extracting URL: https://x")).toBeNull();
    expect(parseYtDlpProgressLine("Some video title")).toBeNull();
    expect(parseYtDlpProgressLine("")).toBeNull();
  });
});

// ------------------------------------------------------------------- message

describe("buildProgressMessage", () => {
  it("single: bar + %, speed, bytes with estimated total, ETA, phase", () => {
    const msg = buildProgressMessage({
      title: "📥 JJK — ÉP 3 (1080P)",
      phaseLabel: "Téléchargement direct",
      percent: 38,
      bytesDone: 10.4 * 1024 * 1024,
      speedBps: 2.4 * 1024 * 1024,
      etaSeconds: 72
    });
    expect(msg).toContain("📥 JJK — ÉP 3 (1080P)");
    expect(msg).toContain("38 %");
    expect(msg).toContain("2,4 Mo/s");
    expect(msg).toContain("10,4 Mo / ≈ 27,4 Mo");
    expect(msg).toContain("Reste ≈ 1 min 12 s");
    expect(msg).toContain("🔧 Téléchargement direct");
    expect(msg).toContain("▰");
    expect(msg).toContain("▱");
  });
  it("indeterminate phase: NO bar, NO invented percent (jamais de faux %)", () => {
    const msg = buildProgressMessage({ title: "T", phaseLabel: "Résolution du flux", percent: null });
    expect(msg).toContain("⏳ Résolution du flux…");
    expect(msg).not.toContain("%");
    expect(msg).not.toContain("▰");
  });
  it("batch: episodes counter, current label, parallel count, cumulative label", () => {
    const msg = buildProgressMessage({
      title: "📦 JJK S2",
      phaseLabel: "Téléchargement des épisodes",
      percent: 33,
      etaSeconds: 1680,
      batch: { done: 8, total: 24, currentLabel: "ÉP 9", activeCount: 2, totalLabel: "1,2 Go téléchargés" }
    });
    expect(msg).toContain("33 %");
    expect(msg).toContain("⚡ 8/24 · ÉP 9 en cours · 1,2 Go téléchargés");
    expect(msg).toContain("2 en parallèle");
    expect(msg).toContain("Reste ≈ 28 min");
  });
  it("huge or missing ETA stays honest (no bar-adjacent lie)", () => {
    const noEta = buildProgressMessage({ title: "T", phaseLabel: "P", percent: 10 });
    expect(noEta).not.toContain("Reste");
    const huge = buildProgressMessage({ title: "T", phaseLabel: "P", percent: 10, etaSeconds: 999 * 60 });
    expect(huge).not.toContain("Reste");
  });
});

// ------------------------------------------------------------------ throttle

describe("shouldEditProgress + needsReanchor", () => {
  it("no edit before minInterval; percent step required after it", () => {
    const t0 = 1000000;
    expect(shouldEditProgress({ lastEditAtMs: null, lastPercent: null, phaseChanged: false, force: false }, 10, t0)).toBe(true);
    expect(shouldEditProgress({ lastEditAtMs: t0, lastPercent: 40, phaseChanged: false, force: false }, 41, t0 + 1000)).toBe(false);
    expect(shouldEditProgress({ lastEditAtMs: t0, lastPercent: 40, phaseChanged: false, force: false }, 41, t0 + 4000)).toBe(false); // pas assez de pas
    expect(shouldEditProgress({ lastEditAtMs: t0, lastPercent: 40, phaseChanged: false, force: false }, 43, t0 + 4000)).toBe(true);
  });
  it("phase change and force always pass", () => {
    const t0 = 1000000;
    expect(shouldEditProgress({ lastEditAtMs: t0, lastPercent: 40, phaseChanged: true, force: false }, 40, t0 + 100)).toBe(true);
    expect(shouldEditProgress({ lastEditAtMs: t0, lastPercent: 40, phaseChanged: false, force: true }, 40, t0 + 1)).toBe(true);
  });
  it("re-anchor past 13 minutes (WhatsApp edit window ~15 min)", () => {
    const t0 = 1000000;
    expect(needsReanchor(t0, t0 + 12 * 60 * 1000)).toBe(false);
    expect(needsReanchor(t0, t0 + PROGRESS_ANCHOR_MAX_MS + 1)).toBe(true);
  });
});

// ------------------------------------------------------------------ reporter

describe("ProgressReporter", () => {
  beforeEach(() => {
    delete process.env.NEBULA_PROGRESS_DISABLED;
  });
  afterEach(() => {
    delete process.env.NEBULA_PROGRESS_DISABLED;
    vi.restoreAllMocks();
  });

  const key = { id: "K1" };
  const makeSend = () => {
    const calls: Array<{ text: string; editKey?: unknown }> = [];
    const send: ProgressSendFn = async (text, editKey) => {
      calls.push({ text, editKey });
      return { key };
    };
    return { send, calls };
  };

  it("anchored: edits the anchor in place, throttled by interval + percent step", async () => {
    vi.useFakeTimers();
    try {
      let now = 1000000;
      const { send, calls } = makeSend();
      const r = createProgressReporter({
        send,
        anchorKey: key,
        title: "T",
        initialPhaseLabel: "Téléchargement",
        minIntervalMs: 3000,
        now: () => now
      });
      r.update({ percent: 10, bytesDone: 1024 });
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.length).toBe(1); // première édition immédiate (ancre)
      expect(calls[0].editKey).toBe(key);
      expect(calls[0].text).toContain("10 %");

      now += 500;
      r.update({ percent: 12, bytesDone: 2048 }); // trop tôt
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.length).toBe(1);

      now += 2500; // intervalle écoulé (3000 ms)…
      r.update({ percent: 11, bytesDone: 3072 }); // …mais pas assez de pas (1 < 2)
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.length).toBe(1);

      r.update({ percent: 14, bytesDone: 6144 }); // +4 % → édite
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.length).toBe(2);
      expect(calls[1].text).toContain("14 %");

      await r.finish("FIN");
      expect(calls.length).toBe(3);
      expect(calls[2]).toEqual({ text: "FIN", editKey: key });
    } finally {
      vi.useRealTimers();
    }
  });

  it("deferred (yt/tiktok/insta): NO message before firstSendDelayMs — a fast download leaves nothing behind", async () => {
    vi.useFakeTimers();
    try {
      let now = 1000000;
      const { send, calls } = makeSend();
      const r = createProgressReporter({
        send,
        title: "📺 Vidéo",
        initialPhaseLabel: "Téléchargement",
        firstSendDelayMs: 4000,
        now: () => now
      });
      r.update({ percent: 30, bytesDone: 1024 });
      now += 1000;
      r.update({ percent: 60, bytesDone: 2048 });
      now += 1000;
      r.update({ percent: 100, bytesDone: 4096 });
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.length).toBe(0); // < 4 s : AUCUN message (règle pas de barre éclair)

      await r.finish("FIN");
      expect(calls.length).toBe(0); // jamais ancré → la clôture n'envoie rien
    } finally {
      vi.useRealTimers();
    }
  });

  it("deferred: a SLOW download sends one message which then gets edited", async () => {
    vi.useFakeTimers();
    try {
      let now = 1000000;
      const { send, calls } = makeSend();
      const r = createProgressReporter({
        send,
        title: "📺 Vidéo",
        initialPhaseLabel: "Téléchargement",
        firstSendDelayMs: 4000,
        minIntervalMs: 3000,
        now: () => now
      });
      r.update({ percent: 20, bytesDone: 1024 });
      now += 5000;
      r.update({ percent: 40, bytesDone: 2048 }); // > 4 s → premier envoi
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.length).toBe(1);
      expect(calls[0].editKey).toBeUndefined();
      expect(calls[0].text).toContain("40 %");

      now += 3000;
      r.update({ percent: 70, bytesDone: 4096 });
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.length).toBe(2);
      expect(calls[1].editKey).toBe(key); // édition du message envoyé
    } finally {
      vi.useRealTimers();
    }
  });

  it("3 failed edits disable the reporter silently (never throws, download unaffected)", async () => {
    let now = 1000000;
    let failures = 0;
    const send: ProgressSendFn = async () => {
      failures += 1;
      throw new Error("edit rejected");
    };
    const r = createProgressReporter({ send, anchorKey: key, title: "T", initialPhaseLabel: "P", now: () => now });
    r.update({ percent: 10 });
    await new Promise((res) => setTimeout(res, 0));
    now += 4000;
    r.update({ percent: 20 });
    await new Promise((res) => setTimeout(res, 0));
    now += 4000;
    r.update({ percent: 30 });
    await new Promise((res) => setTimeout(res, 0));
    now += 4000;
    r.update({ percent: 40 });
    await new Promise((res) => setTimeout(res, 0));
    expect(failures).toBe(3); // coupé après 3 échecs
    await expect(r.finish("FIN")).resolves.toBeUndefined(); // ne jette jamais
  });

  it("re-anchors with a fresh message past 13 minutes on the same key", async () => {
    vi.useFakeTimers();
    try {
      let now = 1000000;
      const { send, calls } = makeSend();
      const r = createProgressReporter({
        send,
        anchorKey: key,
        title: "📦 Lot long",
        initialPhaseLabel: "Téléchargement",
        minIntervalMs: 3000,
        now: () => now
      });
      r.update({ percent: 10 });
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.length).toBe(1);
      expect(calls[0].editKey).toBe(key);

      now += PROGRESS_ANCHOR_MAX_MS + 4000; // fenêtre ~15 min dépassée
      r.update({ percent: 50 });
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.length).toBe(2);
      expect(calls[1].editKey).toBeUndefined(); // NOUVEAU message, pas une édition
      expect(calls[1].text).toContain("50 %");

      now += 5000; // la nouvelle ancre est éditable
      r.update({ percent: 60 });
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.length).toBe(3);
      expect(calls[2].editKey).toBe(key);
    } finally {
      vi.useRealTimers();
    }
  });

  it("batch mode: overall percent = completed + in-flight fractions, deduped completions", async () => {
    vi.useFakeTimers();
    try {
      let now = 1000000;
      const { send, calls } = makeSend();
      const r = createProgressReporter({
        send,
        anchorKey: key,
        title: "📦 S2",
        initialPhaseLabel: "Téléchargement des épisodes",
        now: () => now
      });
      r.startBatch(4);
      r.updateBatchItem(1, 1.0, "ÉP 1");
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.length).toBe(1);
      expect(calls[0].text).toContain("25 %"); // fraction 1.0/4
      expect(calls[0].text).toContain("⚡ 0/4 · ÉP 1 en cours");

      r.completeBatchItem(1); // 1/4 traité
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.length).toBe(2);
      expect(calls[1].text).toContain("⚡ 1/4");

      r.completeBatchItem(1); // doublon : texte IDENTIQUE → aucune édition
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.length).toBe(2);

      now += 4000;
      r.updateBatchItem(2, 0.5, "ÉP 2"); // 1 + 0.5 = 1.5/4 = 37.5 %
      await vi.advanceTimersByTimeAsync(0);
      expect(calls[calls.length - 1].text).toContain("37 %");
      expect(calls[calls.length - 1].text).toContain("⚡ 1/4 · ÉP 2 en cours");
      expect(r.isLive).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("NEBULA_PROGRESS_DISABLED=1 → fully inert reporter", async () => {
    process.env.NEBULA_PROGRESS_DISABLED = "1";
    const { send, calls } = makeSend();
    const r = createProgressReporter({ send, anchorKey: key, title: "T", initialPhaseLabel: "P" });
    r.update({ percent: 50 });
    r.updateBatchItem(1, 0.5);
    r.completeBatchItem(1);
    await r.finish("FIN");
    expect(calls.length).toBe(0);
    expect(r.isLive).toBe(false);
  });
});

// ---------------------------------------------------------------- source pins

describe("progressMessenger — wiring pins (9.18hhhh)", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src/bot", p), "utf8");

  it("hlsDownloader passes real bytes through the progress callback", () => {
    const src = read("services/hlsDownloader.ts");
    expect(src).toContain("progressCallback(pct, {");
    expect(src).toContain("bytesDone: downloadedBytes");
  });
  it("anime mirror chain threads onProgress (extractor + novabox single & batch)", () => {
    const extractor = read("services/animeStreamExtractor.ts");
    expect(extractor).toContain("onProgress?: (percent: number, bytesDone?: number) => void");
    expect(extractor).toContain("executeDirectOrFfmpegDownload(targetStream, outputPath, timeoutMs, onProgress)");
    const novabox = read("commands/novabox.ts");
    expect(novabox).toContain("anchorKey: (singleAnchor as any)?.key");
    expect(novabox).toContain("anchorKey: (batchAnchor as any)?.key");
    expect(novabox).toContain("onDlProgress");
    expect(novabox).toContain("batchProgress.updateBatchItem(epNum, pct / 100");
    expect(novabox).toContain("batchProgress.completeBatchItem(indices[currentIdx] + 1)");
    expect(novabox).toContain("await batchProgress.finish(");
    // le plâtre « 35 % figés » est remplacé par la progression réelle au panneau
    expect(novabox).toContain("updateEpisodeProgress(batchJob.id, epNum, { progressPercent: Math.min(99, Math.floor(pct)) })");
  });
  it("yt-dlp: --newline when a progress consumer exists, lines parsed and forwarded", () => {
    const ytDlp = read("services/ytDlp.ts");
    expect(ytDlp).toContain('opts.onProgress ? "--newline" : "--no-progress"');
    expect(ytDlp).toContain("onStderrLine?: (line: string) => void");
    expect(ytDlp).toContain("parseYtDlpProgressLine(line)");
  });
  it("ytvideo: playlist anchor + deferred single-video reporter + early-return aborts", () => {
    const src = read("commands/ytvideo.ts");
    expect(src).toContain("anchorKey: (playlistAnchor as any)?.key");
    expect(src).toContain("firstSendDelayMs: 4000");
    expect(src).toContain("playlistProgress.completeBatchItem(n)");
    expect(src).toContain("videoProgress.abort()");
    expect(src).toContain("onProgress: (s) => videoProgress.update({ percent: s.percent, bytesDone: null })");
  });
  it("tiktok + instagram: deferred reporters fed by fetchMediaToTempFile(received, total)", () => {
    const tt = read("commands/tiktok.ts");
    expect(tt).toContain("firstSendDelayMs: 4000");
    expect(tt).toContain("ttProgress.update({ percent: pct, bytesDone: received })");
    const ig = read("commands/instagram.ts");
    expect(ig).toContain("igProgress.updateBatchItem(mediaIndex, pct !== null ? pct / 100 : 0");
    expect(ig).toContain("igProgress.completeBatchItem(i + 1)");
    const mld = read("services/mediaLinkDelivery.ts");
    expect(mld).toContain("onProgress?: (receivedBytes: number, totalBytes: number) => void");
    expect(mld).toContain("onProgress(received, totalBytes)");
  });
  it("kill-switch documented in .env.example", () => {
    const env = fs.readFileSync(path.resolve(__dirname, "../.env.example"), "utf8");
    expect(env).toContain("NEBULA_PROGRESS_DISABLED");
  });
});

// 9.18kkkk — retour terrain : la progression live n'apparaissait pas sur le
// flux « .a r N » (choix de qualité). Cause : les DEUX chemins principaux de
// sendFinalEpisode (selectedVariantUrl direct + fallback legacy VidMoly)
// téléchargeaient SANS passer onDlProgress — seul progress.finish() éditait
// le message, jamais la barre. Ces pins garantissent que CHAQUE appel de
// téléchargement de novabox passe un callback de progression.
describe("progressMessenger — pins anti-régression kkkk (tout appel de téléchargement est câblé)", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src/bot", p), "utf8");

  it("sendFinalEpisode : les deux chemins réparés passent onDlProgress", () => {
    const novabox = read("commands/novabox.ts");
    expect(novabox).toContain(
      "executeDirectOrFfmpegDownload(streamToDownload, localPath, 240000, onDlProgress)",
    );
    expect(novabox).toContain(
      "executeFfmpegDownload(targetHlsUrl, downloadSourceUrl, originUrl, localPath, 240000, onDlProgress)",
    );
  });

  it("AUCUN appel de téléchargement novabox sans callback de progression", () => {
    const novabox = read("commands/novabox.ts");
    const callRegex = /await (executeDirectOrFfmpegDownload|executeFfmpegDownload|downloadWithAllMirrorsFallback)\(/g;
    const lines = novabox.split("\n");
    const offenders: string[] = [];
    for (const line of lines) {
      callRegex.lastIndex = 0;
      if (!callRegex.test(line)) continue;
      // Import et définitions exclus ; chaque APPEL doit câbler la progression.
      if (!/on(Dl|BatchEp)Progress/.test(line)) offenders.push(line.trim());
    }
    expect(offenders, `Appels sans progression : ${JSON.stringify(offenders)}`).toEqual([]);
  });
});
