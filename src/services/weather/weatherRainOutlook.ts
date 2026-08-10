/**
 * Klare Regen-Aussage für Speech/UI — kein „eher trocken“.
 * Entweder trocken, unsicher mit %, oder Regen ab Uhrzeit.
 */

export type RainHourSample = {
  atMs: number;
  /** 0–100 */
  popPct: number;
  precipMm?: number;
};

export type RainOutlook = {
  /** Satzfragment ab Großbuchstabe oder mit führendem Leerzeichen für Anhängen */
  speechSuffix: string;
  /** Kurz für HUD / Summary-Mitte */
  shortLabel: string;
  kind: 'raining' | 'rain_timed' | 'possible' | 'dry';
  nextRainAtMs: number | null;
  nextRainPopPct: number | null;
  maxPopUntilEvening: number;
};

function clockLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Lokal ~20:00 heute, sonst +12 h — „bis Abend“. */
export function eveningCutoffMs(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  const evening = new Date(d);
  evening.setHours(20, 0, 0, 0);
  if (evening.getTime() <= nowMs + 45 * 60_000) {
    return nowMs + 12 * 60 * 60_000;
  }
  return evening.getTime();
}

const DRY_MAX_POP = 20;
const POSSIBLE_MAX_POP = 39;
/** Ab hier: konkretes Regenfenster nennen */
const RAIN_CALL_POP = 40;

/**
 * Baut eine klare Regen-Aussage aus Stundenwerten (bis Abend / Horizont).
 */
export function buildRainOutlook(opts: {
  hours: RainHourSample[];
  nowMs?: number;
  untilMs?: number;
  rainingNow?: boolean;
  rainLabelNow?: string | null;
}): RainOutlook {
  const now = opts.nowMs ?? Date.now();
  const until = opts.untilMs ?? eveningCutoffMs(now);
  const window = opts.hours.filter(
    (h) =>
      Number.isFinite(h.atMs) &&
      h.atMs >= now - 20 * 60_000 &&
      h.atMs <= until + 30 * 60_000,
  );

  let maxPop = 0;
  for (const h of window) {
    maxPop = Math.max(maxPop, Math.round(h.popPct));
  }

  if (opts.rainingNow) {
    const label = (opts.rainLabelNow || 'Regen').trim();
    return {
      speechSuffix: ` Gerade ${label}.`,
      shortLabel: label,
      kind: 'raining',
      nextRainAtMs: now,
      nextRainPopPct: Math.max(maxPop, 80),
      maxPopUntilEvening: Math.max(maxPop, 80),
    };
  }

  let nextRainAtMs: number | null = null;
  let nextRainPopPct: number | null = null;
  for (const h of window) {
    const wet =
      h.popPct >= RAIN_CALL_POP || (h.precipMm != null && h.precipMm >= 0.2);
    if (!wet) continue;
    nextRainAtMs = h.atMs;
    nextRainPopPct = Math.round(h.popPct);
    break;
  }

  if (nextRainAtMs != null && nextRainPopPct != null) {
    const pct = nextRainPopPct;
    return {
      speechSuffix: ` Regen ab ca. ${clockLabel(nextRainAtMs)} (ca. ${pct} %).`,
      shortLabel: `Regen ab ~${clockLabel(nextRainAtMs)}`,
      kind: 'rain_timed',
      nextRainAtMs,
      nextRainPopPct: pct,
      maxPopUntilEvening: maxPop,
    };
  }

  if (maxPop >= DRY_MAX_POP + 1 && maxPop <= POSSIBLE_MAX_POP) {
    return {
      speechSuffix: ` Schauer möglich (bis ca. ${maxPop} %) — kein sicheres Trocken.`,
      shortLabel: `Schauer möglich ~${maxPop}%`,
      kind: 'possible',
      nextRainAtMs: null,
      nextRainPopPct: maxPop,
      maxPopUntilEvening: maxPop,
    };
  }

  return {
    speechSuffix: ' Trocken bis zum Abend.',
    shortLabel: 'trocken bis Abend',
    kind: 'dry',
    nextRainAtMs: null,
    nextRainPopPct: null,
    maxPopUntilEvening: maxPop,
  };
}

/** pop als 0–1 (OWM) → 0–100. */
export function pop01ToPct(pop: number | null | undefined): number {
  if (pop == null || !Number.isFinite(pop)) return 0;
  return pop <= 1 ? Math.round(pop * 100) : Math.round(pop);
}
