/**
 * Proaktiver Regen: nur warnen wenn es JETZT trocken ist und Regen noch kommt.
 * HUD-Minuten immer live aus nextRainAtMs (nicht eingefrorener rainStartsInMin).
 */

import { formatClockSpokenDe } from '../../utils/dateKeys';

export type RainWindow = { startMs: number; endMs: number; pop?: number };

/** Schon nass oder Start in unter 2 Min → Voice-Warnung stumm (User merkt es). */
export const RAIN_ALREADY_FALLING_MAX_MIN = 2;

/** HUD zeigt Countdown bis hier; darunter „Aktuell Regen“. */
export const RAIN_HUD_MAX_MIN = 90;

/**
 * Trockenlücke darunter = noch derselbe Schauer.
 * Erst ab ≥ dieser Pause gilt „Regen hört auf“ (nicht 5–10 Min Flatterpause).
 */
export const RAIN_END_MIN_DRY_GAP_MS = 30 * 60_000;

/**
 * Nasse Runs zusammenführen, wenn die Pause dazwischen unter minDryGapMs liegt.
 * `endAtMs` = Zeitpunkt des letzten nassen Samples (oder Fensterende).
 */
export function mergeWetRunsByDryGap<T extends { startAtMs: number; endAtMs: number }>(
  runs: T[],
  minDryGapMs: number = RAIN_END_MIN_DRY_GAP_MS,
): T[] {
  if (!runs.length) return [];
  const sorted = [...runs].sort((a, b) => a.startAtMs - b.startAtMs);
  const out: T[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const prev = out[out.length - 1]!;
    const gapMs = cur.startAtMs - prev.endAtMs;
    if (gapMs < minDryGapMs) {
      out[out.length - 1] = {
        ...prev,
        endAtMs: Math.max(prev.endAtMs, cur.endAtMs),
      };
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/** Hourly-/Fenster-Liste: kurze Pausen mergen. */
export function mergeRainWindowsByDryGap(
  windows: RainWindow[] | null | undefined,
  minDryGapMs: number = RAIN_END_MIN_DRY_GAP_MS,
): RainWindow[] {
  if (!windows?.length) return [];
  const merged = mergeWetRunsByDryGap(
    windows.map((w) => ({
      startAtMs: w.startMs,
      endAtMs: w.endMs,
      pop: w.pop,
    })),
    minDryGapMs,
  );
  return merged.map((w) => ({
    startMs: w.startAtMs,
    endMs: w.endAtMs,
    pop: (w as { pop?: number }).pop,
  }));
}

/**
 * Ende eines nassen Blocks in einer Zeitreihe.
 * Kurze Trockenlöcher (< minDryGapMs) zählen nicht als Ende.
 * samples chronologisch; wet = Niederschlag spürbar.
 */
export function findSeriesRainEndMs(opts: {
  samples: Array<{ atMs: number; wet: boolean }>;
  fromIdx?: number;
  minDryGapMs?: number;
}): number | null {
  const samples = opts.samples;
  if (!samples.length) return null;
  const minGap = opts.minDryGapMs ?? RAIN_END_MIN_DRY_GAP_MS;
  const fromIdx = Math.max(0, opts.fromIdx ?? 0);
  let seenWet = false;
  for (let j = fromIdx; j < samples.length; j++) {
    const s = samples[j]!;
    if (s.wet) {
      seenWet = true;
      continue;
    }
    if (!seenWet) continue;
    const dryAt = s.atMs;
    let resumes = false;
    for (let k = j; k < samples.length; k++) {
      const t = samples[k]!;
      if (t.atMs - dryAt >= minGap) break;
      if (t.wet) {
        resumes = true;
        break;
      }
    }
    if (!resumes) return dryAt;
  }
  return null;
}


/**
 * Intensität für Live-HUD (Fakt, kein Ratschlag).
 * Nur belegte Codes / mm / isHeavyRain — sonst neutrales „Regen“.
 */
export function rainHudIntensityNoun(opts: {
  weatherCode?: number | null;
  isHeavyRain?: boolean | null;
  currentPrecipMm?: number | null;
}): 'Starker Regen' | 'Leichter Regen' | 'Regen' {
  if (opts.isHeavyRain) return 'Starker Regen';
  const mm = opts.currentPrecipMm;
  if (mm != null && Number.isFinite(mm) && mm > 2) return 'Starker Regen';
  const c =
    opts.weatherCode != null && Number.isFinite(opts.weatherCode)
      ? Math.round(opts.weatherCode)
      : null;
  if (c != null) {
    // WMO / Open-Meteo
    if (
      c === 65 ||
      c === 67 ||
      c === 81 ||
      c === 82 ||
      (c >= 95 && c <= 99)
    ) {
      return 'Starker Regen';
    }
    if ((c >= 51 && c <= 57) || c === 61 || c === 66 || c === 80) {
      return 'Leichter Regen';
    }
    // OWM
    if ((c >= 200 && c <= 232) || (c >= 502 && c <= 531)) {
      return 'Starker Regen';
    }
    if ((c >= 300 && c <= 321) || c === 500) return 'Leichter Regen';
  }
  if (mm != null && Number.isFinite(mm) && mm >= 0.1 && mm < 0.5) {
    return 'Leichter Regen';
  }
  return 'Regen';
}

/** Strip emoji / whitespace for rain-line parsers. */
export function stripRainHudPrefix(line: string): string {
  return line.replace(/^🌧\s*/u, '').trim();
}

/** True wenn die HUD-Zeile schon fallenden Regen meint (nicht nur Forecast). */
export function isRainHudFallingLine(line: string | null | undefined): boolean {
  if (!line) return false;
  const t = stripRainHudPrefix(line);
  return /^(Aktuell\s+)?(Starker\s+|Leichter\s+)?Regen(\s+(jetzt|noch|bis)\b|$)/i.test(
    t,
  );
}

function clockLabel(ms: number): string {
  return formatClockSpokenDe(ms) || '';
}

/**
 * Niederschlags-Wettercode: OWM (2xx–6xx) oder WMO/Open-Meteo (51+).
 * Bewölkt (OWM 80x / WMO 1–3) zählt nicht — sonst False-Positive.
 */
export function isPrecipWeatherCode(code: number | null | undefined): boolean {
  if (code == null || !Number.isFinite(code)) return false;
  if (code >= 200 && code < 700) return true; // OWM Regen/Schnee/Gewitter
  if (code >= 51 && code <= 67) return true; // WMO Niesel/Regen
  if (code >= 71 && code <= 77) return true; // WMO Schnee
  if (code >= 80 && code <= 82) return true; // WMO Schauer
  if (code >= 95 && code <= 99) return true; // WMO Gewitter
  return false;
}

export function isRainAlreadyFalling(opts: {
  nowMs?: number;
  currentPrecipMm?: number | null;
  rainStartsInMin?: number | null;
  nextRainAtMs?: number | null;
  weatherCode?: number | null;
  isHeavyRain?: boolean | null;
}): boolean {
  const now = opts.nowMs ?? Date.now();
  if (opts.isHeavyRain) return true;
  if (
    opts.currentPrecipMm != null &&
    Number.isFinite(opts.currentPrecipMm) &&
    opts.currentPrecipMm >= 0.1
  ) {
    return true;
  }
  // Explizit 0 mm → Wettercode allein nicht als „regnet jetzt“ (Open-Meteo 80 + 0 mm).
  if (
    isPrecipWeatherCode(opts.weatherCode) &&
    !(
      opts.currentPrecipMm != null &&
      Number.isFinite(opts.currentPrecipMm) &&
      opts.currentPrecipMm < 0.1
    )
  ) {
    return true;
  }
  if (
    opts.nextRainAtMs != null &&
    Number.isFinite(opts.nextRainAtMs) &&
    opts.nextRainAtMs <= now + RAIN_ALREADY_FALLING_MAX_MIN * 60_000
  ) {
    return true;
  }
  // Nur als Fallback wenn kein absoluter Start — Snapshot kann sonst „kleben“.
  if (
    opts.nextRainAtMs == null &&
    opts.rainStartsInMin != null &&
    Number.isFinite(opts.rainStartsInMin) &&
    opts.rainStartsInMin <= RAIN_ALREADY_FALLING_MAX_MIN
  ) {
    return true;
  }
  return false;
}

/**
 * Live-Minuten bis Regen.
 * Prefer nextRainAtMs (tickt jede Sekunde / nach API-Shift), rainStartsInMin nur Fallback.
 */
export function minutesUntilIncomingRain(opts: {
  nowMs?: number;
  rainStartsInMin?: number | null;
  nextRainAtMs?: number | null;
  currentPrecipMm?: number | null;
  weatherCode?: number | null;
  isHeavyRain?: boolean | null;
}): number | null {
  if (isRainAlreadyFalling(opts)) return null;
  const now = opts.nowMs ?? Date.now();
  if (opts.nextRainAtMs != null && Number.isFinite(opts.nextRainAtMs)) {
    const mins = Math.round((opts.nextRainAtMs - now) / 60_000);
    if (mins > RAIN_ALREADY_FALLING_MAX_MIN) return mins;
    return null;
  }
  if (
    opts.rainStartsInMin != null &&
    Number.isFinite(opts.rainStartsInMin) &&
    opts.rainStartsInMin > RAIN_ALREADY_FALLING_MAX_MIN
  ) {
    return Math.round(opts.rainStartsInMin);
  }
  return null;
}

/** Ende des aktuellen / nächsten Regenfensters (belegt). */
export function activeRainEndMs(
  windows: RainWindow[] | null | undefined,
  opts?: {
    nowMs?: number;
    rainEndsAtMs?: number | null;
    nextRainAtMs?: number | null;
  },
): number | null {
  const now = opts?.nowMs ?? Date.now();
  const merged = mergeRainWindowsByDryGap(windows);
  const fromWindows = (() => {
    if (!merged.length) return null;
    const active = merged.find(
      (w) => w.startMs <= now + 2 * 60_000 && w.endMs > now,
    );
    if (active) return active.endMs;
    const anchor = opts?.nextRainAtMs ?? now;
    const upcoming = merged.find(
      (w) => w.endMs > anchor && w.startMs <= anchor + 30 * 60_000,
    );
    return upcoming?.endMs ?? null;
  })();
  const fromTip =
    opts?.rainEndsAtMs != null &&
    Number.isFinite(opts.rainEndsAtMs) &&
    opts.rainEndsAtMs > now + 60_000
      ? opts.rainEndsAtMs
      : null;
  if (fromTip == null) return fromWindows;
  if (fromWindows == null) return fromTip;
  // Tip zu früh (Flatterpause): Fensterende nehmen, wenn es weiterregnet.
  if (fromWindows > fromTip && fromWindows - fromTip < RAIN_END_MIN_DRY_GAP_MS * 4) {
    // Wenn Fenster deutlich länger als Tip → Tip war nur kurze Lücke
    return fromWindows;
  }
  // Tip später als Fenster → Tip (Radar) gewinnen, außer Fenster endet erst viel später
  return Math.max(fromTip, fromWindows);
}

/** Belegte Dauer des nächsten Regenfensters (Minuten). */
export function rainDurationMin(
  windows: RainWindow[] | null | undefined,
  startMs: number | null | undefined,
  nowMs = Date.now(),
): number | null {
  const windowsM = mergeRainWindowsByDryGap(windows);
  if (!windowsM.length) return null;
  const anchor = startMs ?? nowMs;
  const hit =
    windowsM.find((w) => w.endMs > anchor && w.startMs <= anchor + 20 * 60_000) ??
    windowsM.find((w) => w.startMs >= anchor - 5 * 60_000);
  if (!hit || hit.endMs <= hit.startMs) return null;
  const from = Math.max(hit.startMs, anchor);
  const mins = Math.round((hit.endMs - from) / 60_000);
  if (mins < 5) return mins >= 1 ? mins : null;
  return mins;
}

/** HUD: Countdown in Minuten bis einschließlich 60 Min; darüber Uhrzeit. */
export const RAIN_CLOCK_AFTER_MIN = 60;

/**
 * HUD / Regenradar-Zeile (SSOT Radar-Nowcast Timing) — nur Fakt, kein Schirm/Indoor:
 * - fällt: „Aktuell [starker/leichter] Regen“ bzw. „… noch X Min“ / „… bis HH:MM“
 * - kommt ≤60 Min: Countdown „Regen in X Min“ (+ optional „Dauer ca. Y Min“)
 * - kommt >60 Min: nur „Regen ab HH:MM“ — keine Dauer
 */
export function formatRainHudLine(opts: {
  nowMs?: number;
  currentPrecipMm?: number | null;
  rainStartsInMin?: number | null;
  nextRainAtMs?: number | null;
  rainEndsAtMs?: number | null;
  rainWindows?: RainWindow[] | null;
  weatherCode?: number | null;
  isHeavyRain?: boolean | null;
  /** Max. Horizont für „Regen ab …“ (Default: bis Abend ~12 h). */
  maxHorizonMin?: number;
}): string | null {
  const now = opts.nowMs ?? Date.now();
  const horizon = opts.maxHorizonMin ?? 12 * 60;
  const falling = isRainAlreadyFalling(opts);
  if (falling) {
    const noun = rainHudIntensityNoun(opts);
    const endMs = activeRainEndMs(opts.rainWindows, {
      nowMs: now,
      rainEndsAtMs: opts.rainEndsAtMs,
      nextRainAtMs: opts.nextRainAtMs,
    });
    if (endMs != null && endMs > now + 60_000) {
      const leftMin = Math.max(1, Math.round((endMs - now) / 60_000));
      if (leftMin <= RAIN_CLOCK_AFTER_MIN) {
        return `${noun} noch ${leftMin} Min`;
      }
      return `${noun} bis ${clockLabel(endMs)}`;
    }
    if (noun === 'Regen') return 'Aktuell Regen';
    return `Aktuell ${noun.charAt(0).toLowerCase()}${noun.slice(1)}`;
  }
  const mins = minutesUntilIncomingRain(opts);
  if (mins == null) return null;
  const endMs = activeRainEndMs(opts.rainWindows, {
    nowMs: now,
    rainEndsAtMs: opts.rainEndsAtMs,
    nextRainAtMs: opts.nextRainAtMs,
  });
  const durMin =
    endMs != null && opts.nextRainAtMs != null && Number.isFinite(opts.nextRainAtMs)
      ? Math.max(1, Math.round((endMs - opts.nextRainAtMs) / 60_000))
      : rainDurationMin(opts.rainWindows, opts.nextRainAtMs ?? now, now);
  if (mins <= RAIN_CLOCK_AFTER_MIN) {
    // Countdown bis Start; Dauer nur hier und klar als Länge markiert.
    if (durMin != null && durMin >= 5 && durMin <= 180) {
      return `Regen in ${mins} Min · Dauer ca. ${durMin} Min`;
    }
    return `Regen in ${mins} Min`;
  }
  if (mins > horizon) return null;
  if (opts.nextRainAtMs != null && Number.isFinite(opts.nextRainAtMs)) {
    // >1 h: nur Start-Uhrzeit — Dauer verwässert den Lesefluss.
    return `Regen ab ${clockLabel(opts.nextRainAtMs)}`;
  }
  return null;
}

/** True wenn die Zeile akuten Regen meint (aktuell / noch / in ≤60 Min). */
export function isRainHudUrgent(line: string | null | undefined): boolean {
  if (!line) return false;
  const t = stripRainHudPrefix(line);
  if (isRainHudFallingLine(t)) return true;
  return /^(Starker\s+|Leichter\s+)?Regen in /i.test(t);
}

/** True wenn die Zeile belegtes Radar-Timing trägt (auch „ab HH:MM“). */
export function isRainHudRadarLine(line: string | null | undefined): boolean {
  if (!line) return false;
  const t = stripRainHudPrefix(line);
  if (isRainHudFallingLine(t)) return true;
  return /^(Starker\s+|Leichter\s+)?Regen (in |ab )/i.test(t);
}

export function isRainDontCareUtterance(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (/regen ist mir egal/.test(t)) return true;
  if (/\bist mir egal\b/.test(t) && /\bregen\b/.test(t)) return true;
  if (/weiter wie geplant/.test(t) && /\bregen\b/.test(t)) return true;
  return false;
}

export function isRainShelterUtterance(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (isRainDontCareUtterance(t)) return false;
  return (
    /\b(unterstell|unterstand|indoor|trocken bleiben|café|cafe in der nähe wegen regen|schauer|regen.{0,24}(café|cafe|museum|kino))\b/.test(
      t,
    ) || /\bwegen regen\b/.test(t)
  );
}
