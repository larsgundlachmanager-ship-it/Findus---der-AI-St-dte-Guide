/**
 * Proaktiver Regen: nur warnen wenn es JETZT trocken ist und Regen noch kommt.
 * HUD-Minuten immer live aus nextRainAtMs (nicht eingefrorener rainStartsInMin).
 */

export type RainWindow = { startMs: number; endMs: number; pop?: number };

/** Schon nass oder Start in unter 2 Min → Voice-Warnung stumm (User merkt es). */
export const RAIN_ALREADY_FALLING_MAX_MIN = 2;

/** HUD zeigt Countdown bis hier; darunter „Regen jetzt“. */
export const RAIN_HUD_MAX_MIN = 90;

function clockLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
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
  if (
    opts?.rainEndsAtMs != null &&
    Number.isFinite(opts.rainEndsAtMs) &&
    opts.rainEndsAtMs > now + 60_000
  ) {
    return opts.rainEndsAtMs;
  }
  if (!windows?.length) return null;
  const active = windows.find((w) => w.startMs <= now + 2 * 60_000 && w.endMs > now);
  if (active) return active.endMs;
  const anchor = opts?.nextRainAtMs ?? now;
  const upcoming = windows.find(
    (w) => w.endMs > anchor && w.startMs <= anchor + 30 * 60_000,
  );
  return upcoming?.endMs ?? null;
}

/** Belegte Dauer des nächsten Regenfensters (Minuten). */
export function rainDurationMin(
  windows: RainWindow[] | null | undefined,
  startMs: number | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!windows?.length) return null;
  const anchor = startMs ?? nowMs;
  const hit =
    windows.find((w) => w.endMs > anchor && w.startMs <= anchor + 20 * 60_000) ??
    windows.find((w) => w.startMs >= anchor - 5 * 60_000);
  if (!hit || hit.endMs <= hit.startMs) return null;
  const from = Math.max(hit.startMs, anchor);
  const mins = Math.round((hit.endMs - from) / 60_000);
  if (mins < 5) return mins >= 1 ? mins : null;
  return mins;
}

/** HUD: Countdown in Minuten bis einschließlich 60 Min; darüber Uhrzeit. */
export const RAIN_CLOCK_AFTER_MIN = 60;

/**
 * HUD / Regenradar-Zeile:
 * - fällt: „Regen noch X Min“ (≤60) bzw. „Regen bis HH:MM“ (>60)
 * - kommt: „Regen in X Min“ (≤60) bzw. „Regen ab HH:MM“ (>60)
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
    const endMs = activeRainEndMs(opts.rainWindows, {
      nowMs: now,
      rainEndsAtMs: opts.rainEndsAtMs,
      nextRainAtMs: opts.nextRainAtMs,
    });
    if (endMs != null && endMs > now + 60_000) {
      const leftMin = Math.max(1, Math.round((endMs - now) / 60_000));
      if (leftMin <= RAIN_CLOCK_AFTER_MIN) {
        return `Regen noch ${leftMin} Min`;
      }
      return `Regen bis ${clockLabel(endMs)}`;
    }
    return 'Regen jetzt';
  }
  const mins = minutesUntilIncomingRain(opts);
  if (mins == null) return null;
  if (mins <= RAIN_CLOCK_AFTER_MIN) {
    return `Regen in ${mins} Min`;
  }
  if (mins > horizon) return null;
  if (opts.nextRainAtMs != null && Number.isFinite(opts.nextRainAtMs)) {
    return `Regen ab ${clockLabel(opts.nextRainAtMs)}`;
  }
  return null;
}

/** True wenn die Zeile akuten Regen meint (jetzt / noch / in ≤60 Min). */
export function isRainHudUrgent(line: string | null | undefined): boolean {
  if (!line) return false;
  return /^(Regen jetzt|Regen noch |Regen in )/i.test(line.trim());
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
