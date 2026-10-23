/**
 * ============================================================================
 *  progressMessenger — barre de progression LIVE des téléchargements (9.18hhhh)
 * ============================================================================
 *  Idée owner 22/10 : quand une vidéo (anime, YouTube, Instagram, TikTok) se
 *  télécharge, l'utilisateur voit UN message WhatsApp qui se MODIFIE en
 *  temps réel — comme la boîte de transfert de fichiers Windows : barre,
 *  pourcentage, vitesse, Mo téléchargés et temps restant estimé. Zéro spam :
 *  c'est une ÉDITION du même message (Baileys : sendMessage { text, edit }),
 *  jamais un nouveau message par étape.
 *
 *  Règles UX appliquées (recherche 22/10) :
 *   - jamais de pourcentage inventé : phase sans mesure = message indéterminé
 *     (« ⏳ Résolution… »), pas de fausse barre ;
 *   - ETA sur vitesse LISSÉE (EWMA), jamais instantanée — l'ETA qui saute
 *     de 1 min à 15 min est le défaut classique des boîtes de copie ;
 *   - l'unité de progression est réelle : octets/segments comptés ;
 *   - pas de barre éclair : un téléchargement < firstSendDelayMs n'envoie
 *     AUCUN message de progression (règle « no flash ») ;
 *   - la fenêtre d'édition WhatsApp est ~15 min : au-delà de 13 min sur la
 *     même ancre, un NOUVEAU message prend le relais (re-ancrage, au plus
 *     1 message / 13 min pour un lot de plusieurs heures).
 *
 *  Robustesse (invariants du repo) : une édition échouée ne JAMAIS faire
 *  échouer le téléchargement — tout send est catché, et après 3 échecs
 *  consécutifs le reporter se tait pour le reste du téléchargement.
 *  Kill-switch opérateur : NEBULA_PROGRESS_DISABLED=1 (tout est inerte).
 */

// ------------------------------------------------------------------ formatting

/** Octets → « 820 Ko » / « 10,4 Mo » / « 1,24 Go » (virgule française). */
export function formatProgressBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 Mo";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2).replace(".", ",")} Go`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1).replace(".", ",")} Mo`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${Math.round(bytes)} o`;
}

/** Octets/s → « 2,4 Mo/s ». */
export function formatProgressSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "—";
  return `${formatProgressBytes(bps)}/s`;
}

/** Secondes → « 45 s » / « 1 min 12 s » / « 1 h 05 min ». */
export function formatProgressDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const s = Math.round(totalSeconds);
  if (s < 60) return `${Math.max(s, 0)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rest = s % 60;
    return rest ? `${m} min ${String(rest).padStart(2, "0")} s` : `${m} min`;
  }
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} min`;
}

/** Barre ASCII monospace : ▰ plein, ▰ vide. Le ratio est borné [0,1]. */
export function renderProgressBar(ratio: number, width = 24): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const filled = Math.round(clamped * width);
  return "▰".repeat(filled) + "▱".repeat(Math.max(0, width - filled));
}

// ----------------------------------------------------------------------- math

/** Lissage exponentiel (EWMA) — alpha = poids de l'instantané (0.2 par défaut). */
export function computeEwma(prev: number | null, instant: number, alpha = 0.2): number {
  if (!Number.isFinite(instant)) return prev ?? 0;
  if (prev === null || !Number.isFinite(prev)) return instant;
  return alpha * instant + (1 - alpha) * prev;
}

/** Total estimé depuis l'avancement : null tant que < 5 % (estimation trop bruitée). */
export function estimateBytesTotal(bytesDone: number, percent: number): number | null {
  if (!Number.isFinite(bytesDone) || bytesDone <= 0) return null;
  if (!Number.isFinite(percent) || percent < 5 || percent >= 100) return null;
  return Math.round(bytesDone / (percent / 100));
}

/**
 * Ligne de progression yt-dlp (sortie --newline, sur stderr) :
 *   [download]  12.3% of ~45.67MiB at 1.23MiB/s ETA 00:32
 * Retourne null pour toute autre ligne (titre, warnings, merge…).
 */
const YTDL_PROGRESS_RE =
  /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?(\d+(?:\.\d+)?)(KiB|MiB|GiB)(?:\s+at\s+(\d+(?:\.\d+)?)(KiB|MiB|GiB)\/s)?(?:\s+ETA\s+(\d+:\d+(?::\d+)?))?/;
const YTDL_UNIT: Record<string, number> = { KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 };

export interface YtDlpProgressSample {
  percent: number;
  bytesTotal: number | null;
  speedBps: number | null;
  etaSeconds: number | null;
}

export function parseYtDlpProgressLine(line: string): YtDlpProgressSample | null {
  const m = YTDL_PROGRESS_RE.exec(line || "");
  if (!m) return null;
  const percent = parseFloat(m[1]);
  const bytesTotal = m[2] && m[3] ? parseFloat(m[2]) * (YTDL_UNIT[m[3]] || 1) : null;
  const speedBps = m[4] && m[5] ? parseFloat(m[4]) * (YTDL_UNIT[m[5]] || 1) : null;
  let etaSeconds: number | null = null;
  if (m[6]) {
    const parts = m[6].split(":").map(Number);
    if (parts.length === 3) etaSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) etaSeconds = parts[0] * 60 + parts[1];
  }
  return { percent, bytesTotal, speedBps, etaSeconds };
}

// ------------------------------------------------------------------- message

export interface ProgressDashboardSpec {
  /** Ligne de titre (rendue en gras par l'appelant via *…*). */
  title: string;
  /** Étiquette de la phase en cours (« Téléchargement », « Média 2/3 »…). */
  phaseLabel: string;
  /** null/undefined = phase indéterminée : PAS de barre (jamais de faux %). */
  percent?: number | null;
  bytesDone?: number | null;
  /** Total fourni par la source (content-length, yt-dlp) — sinon estimé « ≈ ». */
  bytesTotal?: number | null;
  speedBps?: number | null;
  etaSeconds?: number | null;
  /** Mode lot : épisodes/médias comptés + libellé de l'élément en cours. */
  batch?: { done: number; total: number; currentLabel?: string; activeCount?: number; totalLabel?: string };
}

/** Construit le message WhatsApp (monospace implicite via la barre). */
export function buildProgressMessage(spec: ProgressDashboardSpec): string {
  const lines: string[] = [`*${spec.title}*`, ""];
  const hasPercent = typeof spec.percent === "number" && Number.isFinite(spec.percent!) && spec.percent! >= 0;
  if (!hasPercent) {
    lines.push(`⏳ ${spec.phaseLabel}…`);
    return lines.join("\n");
  }
  const pct = Math.min(100, Math.floor(spec.percent!));
  lines.push(`${renderProgressBar(pct / 100)}  ${pct} %`);
  if (spec.batch) {
    const b = spec.batch;
    const parts: string[] = [`${b.done}/${b.total}`];
    if (b.currentLabel) parts.push(`${b.currentLabel} en cours`);
    if (b.totalLabel) parts.push(b.totalLabel);
    lines.push(`⚡ ${parts.join(" · ")}`);
  } else {
    const detail: string[] = [];
    if (typeof spec.speedBps === "number" && spec.speedBps > 0) detail.push(formatProgressSpeed(spec.speedBps));
    if (typeof spec.bytesDone === "number" && spec.bytesDone > 0) {
      const known = typeof spec.bytesTotal === "number" && spec.bytesTotal! > 0;
      const totalStr = known ? formatProgressBytes(spec.bytesTotal!) : estimateBytesTotalStr(spec.bytesDone!, pct);
      detail.push(`${formatProgressBytes(spec.bytesDone!)} / ${totalStr}`);
    }
    if (detail.length) lines.push(detail.join(" · "));
  }
  const eta: string[] = [];
  if (typeof spec.etaSeconds === "number" && spec.etaSeconds! > 0 && spec.etaSeconds! < 99 * 60) {
    eta.push(`Reste ≈ ${formatProgressDuration(spec.etaSeconds!)}`);
  }
  if (spec.batch?.activeCount && spec.batch.activeCount > 1) eta.push(`${spec.batch.activeCount} en parallèle`);
  if (eta.length) lines.push(`⏱️ ${eta.join(" · ")}`);
  lines.push(`🔧 ${spec.phaseLabel}`);
  return lines.join("\n");
}

function estimateBytesTotalStr(bytesDone: number, percent: number): string {
  const est = estimateBytesTotal(bytesDone, percent);
  return est ? `≈ ${formatProgressBytes(est)}` : "—";
}

// ------------------------------------------------------------------ throttle

export interface ThrottleState {
  lastEditAtMs: number | null;
  lastPercent: number | null;
  phaseChanged: boolean;
  force: boolean;
}

/**
 * Décision d'éditer MAINTENANT : au moins minIntervalMs depuis la dernière
 * édition ET un saut de pourcentage perceptible — sauf changement de phase ou
 * édition finale (force), qui passent toujours.
 */
export function shouldEditProgress(
  state: ThrottleState,
  newPercent: number | null,
  nowMs: number,
  minIntervalMs = 3000,
  minPercentStep = 2
): boolean {
  if (state.force) return true;
  if (state.phaseChanged) return true;
  if (state.lastEditAtMs === null) return true;
  if (nowMs - state.lastEditAtMs < minIntervalMs) return false;
  if (newPercent === null) return true;
  if (state.lastPercent === null) return true;
  return Math.abs(newPercent - state.lastPercent) >= minPercentStep;
}

/** Fenêtre d'édition WhatsApp ≈ 15 min : on re-ancrage à 13 min (marge). */
export const PROGRESS_ANCHOR_MAX_MS = 13 * 60 * 1000;

export function needsReanchor(anchorAtMs: number, nowMs: number, maxAnchorAgeMs = PROGRESS_ANCHOR_MAX_MS): boolean {
  return nowMs - anchorAtMs >= maxAnchorAgeMs;
}

// ------------------------------------------------------------------ reporter

export type ProgressSendFn = (text: string, editKey?: unknown) => Promise<unknown>;

export interface ProgressReporterOptions {
  /** Envoi réel (le command fournit : socket vivant + edit: key). */
  send: ProgressSendFn;
  /** Clé du message existant à éditer (ancre fournie) — sinon envoi différé. */
  anchorKey?: unknown;
  title: string;
  /** Différé avant le PREMIER envoi quand aucune ancre (règle « pas de barre éclair »). */
  firstSendDelayMs?: number;
  /** Intervalle min entre deux éditions (défaut 3 s). */
  minIntervalMs?: number;
  /** Phase initiale (indéterminée jusqu'au premier update). */
  initialPhaseLabel?: string;
  now?: () => number;
}

interface Sample {
  tMs: number;
  percent: number | null;
  bytesDone: number | null;
}

/**
 * Reporter d'un téléchargement. Toutes les méthodes sont sûres : elles ne
 * lancent JAMAIS (un échec d'édition ne touche pas le téléchargement).
 */
export class ProgressReporter {
  private readonly send: ProgressSendFn;
  private readonly anchorKeyInitial: unknown;
  private readonly title: string;
  private readonly firstSendDelayMs: number;
  private readonly minIntervalMs: number;
  private readonly now: () => number;

  private disabled = process.env.NEBULA_PROGRESS_DISABLED === "1";
  private createdMs: number;
  private currentKey: unknown = null;
  private anchorAtMs: number | null = null;
  private phaseLabel: string;
  private lastPercent: number | null = null;
  private lastEditAtMs: number | null = null;
  private lastEditText = "";
  private lastSample: Sample | null = null;
  private ewmaPercentRate: number | null = null;
  private ewmaBytesRate: number | null = null;
  private editFailures = 0;
  private finished = false;

  // Mode lot : fractions par élément (epNum → 0..1), complétés à part.
  private readonly batchFractions = new Map<string, number>();
  private readonly batchCompleted = new Set<string>();
  private batchDone = 0;
  private batchTotal = 0;
  private batchCurrentLabel = "";
  private batchExtraLabel = "";

  constructor(opts: ProgressReporterOptions) {
    this.send = opts.send;
    this.anchorKeyInitial = opts.anchorKey ?? null;
    this.title = opts.title;
    this.firstSendDelayMs = opts.firstSendDelayMs ?? 0;
    this.minIntervalMs = opts.minIntervalMs ?? 3000;
    this.phaseLabel = opts.initialPhaseLabel || "Préparation";
    this.now = opts.now || (() => Date.now());
    this.createdMs = this.now();
    if (this.anchorKeyInitial) {
      this.currentKey = this.anchorKeyInitial;
      this.anchorAtMs = this.createdMs;
    }
  }

  /** Change de phase (étiquette) — force l'édition suivante. */
  setPhase(label: string, currentLabel?: string): void {
    if (this.disabled || this.finished) return;
    this.phaseLabel = label;
    if (currentLabel !== undefined) this.batchCurrentLabel = currentLabel;
    void this.maybeEdit(true);
  }

  /** Avancement d'un téléchargement unique (percent 0-100 + octets réels). */
  update(sample: { percent?: number | null; bytesDone?: number | null }): void {
    if (this.disabled || this.finished) return;
    const nowMs = this.now();
    const percent = typeof sample.percent === "number" && Number.isFinite(sample.percent) ? sample.percent : null;
    const bytesDone = typeof sample.bytesDone === "number" && Number.isFinite(sample.bytesDone) ? sample.bytesDone : null;
    this.ingestSample({ tMs: nowMs, percent, bytesDone });
    void this.maybeEdit(false);
  }

  /** Mode lot : déclare le total d'éléments (une fois). */
  startBatch(total: number, extraLabel?: string): void {
    if (this.disabled) return;
    this.batchTotal = total;
    this.batchDone = 0;
    this.batchFractions.clear();
    if (extraLabel) this.batchExtraLabel = extraLabel;
  }

  /** Mode lot : fraction d'un élément en cours (0..1). */
  updateBatchItem(itemId: string | number, fraction: number, label?: string): void {
    if (this.disabled || this.finished) return;
    const nowMs = this.now();
    this.batchFractions.set(String(itemId), Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)));
    if (label) this.batchCurrentLabel = label;
    this.ingestSample({ tMs: nowMs, percent: this.batchPercent(), bytesDone: null });
    void this.maybeEdit(false);
  }

  /** Mode lot : élément terminé (succès OU échec — l'avancement global avance). */
  completeBatchItem(itemId: string | number, label?: string): void {
    if (this.disabled || this.finished) return;
    const key = String(itemId);
    if (!this.batchCompleted.has(key)) {
      this.batchCompleted.add(key);
      this.batchFractions.delete(key);
      this.batchDone += 1;
    }
    if (label) this.batchCurrentLabel = label;
    void this.maybeEdit(true);
  }

  /**
   * Édition finale : remplace le tableau de bord par un texte de clôture.
   * Si AUCUN message n'existe (téléchargement éclair, pas d'ancre), rien
   * n'est envoyé — règle « pas de barre éclair ».
   */
  async finish(finalText?: string): Promise<void> {
    if (this.disabled || this.finished) return;
    this.finished = true;
    if (!this.currentKey) return;
    const text =
      finalText ||
      (this.batchTotal > 0
        ? `*${this.title}*\n✅ ${this.batchDone}/${this.batchTotal} traités — préparation de la livraison…`
        : `*${this.title}*\n✅ Téléchargement terminé — préparation de l'envoi…`);
    try {
      await this.send(text, this.currentKey);
    } catch {}
  }

  /** Coupe le reporter (erreur en cascade côté appelant) — silencieux. */
  abort(): void {
    this.finished = true;
  }

  /** Vrai si un message de progression existe (ancre ou envoyé). */
  get isLive(): boolean {
    return !this.disabled && this.currentKey != null;
  }

  private batchPercent(): number | null {
    if (this.batchTotal <= 0) return null;
    let sum = this.batchDone;
    for (const f of this.batchFractions.values()) sum += f;
    return Math.min(100, (sum / this.batchTotal) * 100);
  }

  private ingestSample(s: Sample): void {
    const prev = this.lastSample;
    this.lastSample = s;
    if (!prev) return;
    const dtSec = (s.tMs - prev.tMs) / 1000;
    if (dtSec < 0.4) return; // trop rapproché : bruit, l'EWMA n'en veut pas
    if (prev.percent !== null && s.percent !== null && s.percent > prev.percent) {
      const instantPctRate = (s.percent - prev.percent) / dtSec;
      this.ewmaPercentRate = computeEwma(this.ewmaPercentRate, instantPctRate);
    }
    if (prev.bytesDone !== null && s.bytesDone !== null && s.bytesDone > prev.bytesDone) {
      const instantByteRate = (s.bytesDone - prev.bytesDone) / dtSec;
      this.ewmaBytesRate = computeEwma(this.ewmaBytesRate, instantByteRate);
    }
  }

  private etaSeconds(): number | null {
    if (this.ewmaPercentRate === null || this.ewmaPercentRate <= 0) return null;
    const pct = this.lastSample?.percent ?? null;
    if (pct === null || pct >= 100) return null;
    return (100 - pct) / this.ewmaPercentRate;
  }

  private buildText(): string {
    const pct = this.lastSample?.percent ?? null;
    const bytesDone = this.lastSample?.bytesDone ?? null;
    if (this.batchTotal > 0) {
      return buildProgressMessage({
        title: this.title,
        phaseLabel: this.phaseLabel,
        percent: pct,
        etaSeconds: this.etaSeconds(),
        batch: {
          done: this.batchDone,
          total: this.batchTotal,
          currentLabel: this.batchCurrentLabel || undefined,
          activeCount: this.batchFractions.size || undefined,
          totalLabel: this.batchExtraLabel || undefined
        }
      });
    }
    return buildProgressMessage({
      title: this.title,
      phaseLabel: this.phaseLabel,
      percent: pct,
      bytesDone,
      speedBps: this.ewmaBytesRate,
      etaSeconds: this.etaSeconds()
    });
  }

  private async maybeEdit(phaseChanged: boolean): Promise<void> {
    if (this.disabled || this.finished || this.editFailures >= 3) return;
    const nowMs = this.now();
    const pct = this.lastSample?.percent ?? null;

    // Premier envoi différé : la règle « pas de barre éclair » — un
    // téléchargement rapide ne doit laisser AUCUN message derrière lui.
    if (!this.currentKey) {
      if (nowMs - this.createdMs < this.firstSendDelayMs) return;
    }

    const text = this.buildText();
    // Un texte IDENTIQUE ne justifie JAMAIS une édition (anti-spam) — même
    // sur un changement de phase, l'utilisateur ne verrait aucune différence.
    if (this.currentKey && text === this.lastEditText) return;

    if (
      !shouldEditProgress(
        { lastEditAtMs: this.lastEditAtMs, lastPercent: this.lastPercent, phaseChanged, force: false },
        pct,
        nowMs,
        this.minIntervalMs
      )
    ) {
      return;
    }

    // Re-ancrage : la fenêtre d'édition WhatsApp (~15 min) est proche de la
    // fin → un NOUVEAU message prend le relais (au plus 1 / 13 min).
    let editKey = this.currentKey ?? undefined;
    if (this.anchorAtMs !== null && needsReanchor(this.anchorAtMs, nowMs)) {
      editKey = undefined;
    }

    try {
      const sent = await this.send(text, editKey);
      this.editFailures = 0;
      this.lastEditAtMs = nowMs;
      this.lastPercent = pct;
      this.lastEditText = text;
      if (!editKey) {
        // Nouvelle ancre (premier envoi ou re-ancrage).
        this.currentKey = (sent as { key?: unknown })?.key ?? null;
        this.anchorAtMs = nowMs;
        if (!this.currentKey) this.editFailures = 3; // pas de clé → on ne pourra jamais éditer
      }
    } catch {
      this.editFailures += 1;
    }
  }
}

/** Factory : reporter inerte quand la progression est coupée (kill-switch). */
export function createProgressReporter(opts: ProgressReporterOptions): ProgressReporter {
  return new ProgressReporter(opts);
}
