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
/** Ab hier: „Schauer möglich“ (ohne Countdown), wenn kein mm-Wert */
const RAIN_CALL_POP = 40;
/** Konkreter Countdown nur mit belegtem Niederschlag (mm), nicht nur %. */
const RAIN_TIMED_MIN_MM = 0.2;

/**
 * Baut eine klare Regen-Aussage aus Stundenwerten (bis Abend / Horizont).
 *
 * Wichtig: Hohe Regen-*Wahrscheinlichkeit* ohne mm ≠ „Regen in X Min“.
 * Modelle (Open-Meteo vs. Wetter Online) streuen stark bei Pop-only.
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
    const mm = h.precipMm;
    // Countdown nur bei echter mm-Prognose — Pop allein → unten „möglich“.
    const wet = mm != null && Number.isFinite(mm) && mm >= RAIN_TIMED_MIN_MM;
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

  // Hohe % ohne mm: ehrlich unsicher — kein Countdown (Modelle divergeieren).
  if (maxPop >= RAIN_CALL_POP) {
    return {
      speechSuffix: ` Schauer möglich (bis ca. ${maxPop} %) — kein sicheres Fenster.`,
      shortLabel: `Schauer möglich ~${maxPop}%`,
      kind: 'possible',
      nextRainAtMs: null,
      nextRainPopPct: maxPop,
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
    speechSuffix: ' Kein Regen bis zum Abend erwartet.',
    shortLabel: 'kein Regen bis Abend',
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
