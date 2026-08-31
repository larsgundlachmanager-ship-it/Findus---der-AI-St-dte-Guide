/**
 * Kosten-bewusste Wetter-Poll-Leiter (pro Gerät).
 * Trocken sparsam; nur bei nahendem Regen enger — nie pauschal jede Minute.
 *
 * 1000 User trocken @ 60 Min ≈ 1k Calls/h.
 * Nur die mit Regen ≤5 Min pollen @ 1 Min — der Rest bleibt grob.
 */

export const WEATHER_POLL = {
  /** Stabil trocken / kein Regen in Sicht */
  stableDryMs: 60 * 60_000,
  /** Regen erst in >2 h — bis Watch-Fenster warten (kein Dauerpoll) */
  watchFromBeforeRainMs: 2 * 60 * 60_000,
  /** Regen in 60 Min … 2 h */
  farMs: 30 * 60_000,
  /** Regen in 15 … 60 Min */
  approachingMs: 10 * 60_000,
  /** Regen in 5 … 15 Min */
  nearMs: 5 * 60_000,
  /** Regen in ≤5 Min */
  imminentMs: 60_000,
  /** Regnet schon — Ende nachziehen, nicht jede Minute */
  rainingMs: 5 * 60_000,
} as const;

/**
 * Nächster API-Check relativ zu now.
 * `untilRainMs` = nextRainAtMs - now (kann negativ sein wenn schon nass).
 */
export function nextWeatherPollDelayMs(opts: {
  rainingNow: boolean;
  dayStableDry: boolean;
  untilRainMs: number | null;
}): number {
  if (opts.rainingNow) return WEATHER_POLL.rainingMs;
  if (opts.dayStableDry || opts.untilRainMs == null) {
    return WEATHER_POLL.stableDryMs;
  }
  const until = opts.untilRainMs;
  if (until > WEATHER_POLL.watchFromBeforeRainMs) {
    // Bis 2h vor Regen schlafen — ein Call reicht, um das Fenster zu öffnen
    return until - WEATHER_POLL.watchFromBeforeRainMs;
  }
  if (until <= 5 * 60_000) return WEATHER_POLL.imminentMs;
  if (until <= 15 * 60_000) return WEATHER_POLL.nearMs;
  if (until <= 60 * 60_000) return WEATHER_POLL.approachingMs;
  return WEATHER_POLL.farMs;
}
