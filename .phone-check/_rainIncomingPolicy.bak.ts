/**
 * Proaktiver Regen: nur warnen wenn es JETZT trocken ist und Regen noch kommt.
 * HUD-Minuten immer live aus nextRainAtMs (nicht eingefrorener rainStartsInMin).
 */

export type RainWindow = { startMs: number; endMs: number; pop?: number };

/** Schon nass oder Start in unter 2 Min → Voice-Warnung stumm (User merkt es). */
export const RAIN_ALREADY_FALLING_MAX_MIN = 2;

/** HUD zeigt Countdown bis hier; darunter „Aktuell Regen“. */
export const RAIN_HUD_MAX_MIN = 90;

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
 * HUD / Regenradar-Zeile (SSOT Radar-Nowcast Timing):
 * - fällt: „Regen noch X Min“ (≤60) bzw. „Regen bis HH:MM“ (>60)
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

/** True wenn die Zeile akuten Regen meint (jetzt / noch / in ≤60 Min). */
export function isRainHudUrgent(line: string | null | undefined): boolean {
  if (!line) return false;
  return /^(Regen jetzt|Regen noch |Regen in )/i.test(line.trim());
}

/** True wenn die Zeile belegtes Radar-Timing trägt (auch „ab HH:MM“). */
export function isRainHudRadarLine(line: string | null | undefined): boolean {
  if (!line) return false;
  return /^(Regen jetzt|Regen noch |Regen in |Regen ab |Regen bis )/i.test(
    line.trim(),
  );
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
