/**
 * AeroAPI-Kosten: enge Zeitfenster, CLK-Resolve-Abstand.
 * Keine RN-/Fetch-Imports — smoke-testbar.
 */

/** Civil local time — never ISO-without-TZ (Hermes treats that as UTC). */
function civilLocal(dateKey: string, h: number, min: number, s = 0): Date | null {
  const [y, mo, d] = dateKey.split('-').map(Number);
  if (!y || !mo || !d) return null;
  const dt = new Date(y, mo - 1, d, h, min, s, 0);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

/**
 * Zeitfenster für scheduled_departures: ±90 Min um die Uhr (lokal), sonst der Kalendertag.
 * Enges Fenster = der 11:05-Flieger steht auf Seite 1 (HAM hat morgens zu viele Abflüge).
 */
export function aeroScheduleWindow(opts: {
  dateKey: string;
  clockHm?: string | null;
  afterMs?: number;
}): { start: string; end: string } | null {
  if (opts.afterMs != null && Number.isFinite(opts.afterMs)) {
    return {
      start: new Date(opts.afterMs).toISOString(),
      end: new Date(opts.afterMs + 12 * 3600_000).toISOString(),
    };
  }
  const clock = (opts.clockHm || '').trim();
  if (/^\d{1,2}:\d{2}$/.test(clock)) {
    const [h, m] = clock.split(':').map(Number);
    const center = civilLocal(opts.dateKey, h ?? 0, m ?? 0);
    if (center) {
      return {
        start: new Date(center.getTime() - 90 * 60_000).toISOString(),
        end: new Date(center.getTime() + 90 * 60_000).toISOString(),
      };
    }
  }
  const dayStart = civilLocal(opts.dateKey, 0, 0, 0);
  const dayEnd = civilLocal(opts.dateKey, 23, 59, 59);
  if (!dayStart || !dayEnd) return null;
  return { start: dayStart.toISOString(), end: dayEnd.toISOString() };
}

export type FlightWatchPollCtx = {
  leaveMs?: number | null;
  nearAirport?: boolean;
  distM?: number | null;
  departed?: boolean;
  arrived?: boolean;
};

const H = 3600_000;
const WEEK_MS = 7 * 24 * H;

export function isFlightWatchOnTheWay(
  nowMs: number,
  ctx?: FlightWatchPollCtx,
): boolean {
  if (ctx?.nearAirport) return true;
  if (ctx?.leaveMs != null && nowMs >= ctx.leaveMs - 8 * 60_000) return true;
  return false;
}

/**
 * Live-Watch: Ruhe bis 1 Woche vorher, dann einzelne Meilensteine,
 * ab 2 h vor Abflug alle 15 Min bis T−15. Kein 3-Stunden-Dauerfeuer.
 */
export function flightWatchShouldPoll(opts: {
  dep: Date | null;
  now: number;
  lastPollMs: number;
  departed?: boolean;
  arrived?: boolean;
}): boolean {
  const { now, lastPollMs: last } = opts;
  if (opts.arrived || opts.departed) {
    return last <= 0 || now - last >= 15 * 60_000;
  }
  if (!opts.dep) return false;
  const until = opts.dep.getTime() - now;
  if (until > WEEK_MS) return false;

  const cadence = 15 * 60_000;
  if (until <= 2 * H && until > 15 * 60_000) {
    return last <= 0 || now - last >= cadence;
  }
  if (until <= 15 * 60_000 && until > -20 * 60_000) {
    return last <= 0 || now - last >= cadence;
  }

  const marks = [WEEK_MS, 3 * 24 * H, 24 * H, 12 * H, 6 * H, 3 * H, 2 * H];
  const untilLast =
    last <= 0 ? Number.POSITIVE_INFINITY : opts.dep.getTime() - last;
  for (const m of marks) {
    if (untilLast > m && until <= m) return true;
  }
  if (last <= 0 && until <= WEEK_MS) return true;
  return false;
}

/**
 * AeroAPI nur wenn die Origin-Tafel fehlt — oder ab T−6 h
 * (Landung, Band, airborne). Gate/Check-in/Ausfall vorher über FIDS.
 */
export function flightWatchShouldPollAero(opts: {
  dep: Date | null;
  now: number;
  lastPollMs: number;
  departed?: boolean;
  arrived?: boolean;
  hasOriginBoard?: boolean;
}): boolean {
  if (opts.arrived || opts.departed) {
    return flightWatchShouldPoll(opts);
  }
  if (!opts.dep) return false;
  if (opts.hasOriginBoard) {
    const until = opts.dep.getTime() - opts.now;
    if (until > 6 * H) return false;
  }
  return flightWatchShouldPoll(opts);
}
