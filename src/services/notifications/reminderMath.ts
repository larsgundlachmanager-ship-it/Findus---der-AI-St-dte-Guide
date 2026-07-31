/**
 * Pure helpers for departure leave-by timing and reminder copy.
 * Trigger: T_departure − ETA_walk − Buffer_safety
 */

/** Default safety buffer before walking out (minutes). */
export const DEFAULT_SAFETY_BUFFER_MIN = 9;

/**
 * Clamp for safety buffer.
 * Default band ~8–10; explicit values may stretch 5–30 (Verspätung / großer Bahnhof).
 */
export function clampSafetyBufferMin(bufferMin?: number): number {
  if (bufferMin == null || !Number.isFinite(bufferMin)) {
    return DEFAULT_SAFETY_BUFFER_MIN;
  }
  return Math.min(30, Math.max(5, Math.round(bufferMin)));
}

/**
 * When the user should leave so they arrive with a safety buffer.
 * Returns null if the leave-by time is already in the past (or too soon to schedule).
 */
export function computeLeaveByMs(opts: {
  departureMs: number;
  walkEtaMinutes: number;
  safetyBufferMin?: number;
  nowMs?: number;
  /** Minimum lead time so we don't schedule a notification that fires immediately. */
  minLeadMs?: number;
}): { leaveByMs: number; leadMs: number; safetyBufferMin: number } | null {
  const now = opts.nowMs ?? Date.now();
  const safety = clampSafetyBufferMin(opts.safetyBufferMin);
  const walk = Math.max(0, Math.ceil(opts.walkEtaMinutes));
  const leaveByMs =
    opts.departureMs - (walk + safety) * 60_000;
  const leadMs = leaveByMs - now;
  const minLead = opts.minLeadMs ?? 15_000;
  if (leadMs < minLead) return null;
  return { leaveByMs, leadMs, safetyBufferMin: safety };
}

/** Minutes remaining until departure at fire time (approx). */
export function minutesUntilDepartureAtLeave(
  departureMs: number,
  leaveByMs: number,
): number {
  return Math.max(
    1,
    Math.round((departureMs - leaveByMs) / 60_000),
  );
}

export function buildTransitReminderBody(opts: {
  line: string;
  minutesUntilDeparture: number;
  stationName?: string;
}): string {
  const line = opts.line.replace(/\s+/g, ' ').trim() || 'Linie';
  const mins = Math.max(1, Math.round(opts.minutesUntilDeparture));
  const station = opts.stationName?.trim();
  const where = station ? ` zur Haltestelle ${station}` : '';
  return (
    `Hey! Zeit aufzubrechen. Dein Bus/Bahn [${line}] kommt in ${mins} Minuten` +
    `${where}. Hast du schon gezahlt?`
  );
}

export function buildFlightReminderBody(opts: {
  flightLabel: string;
  minutesUntilDeparture: number;
}): string {
  const label = opts.flightLabel.replace(/\s+/g, ' ').trim() || 'Flug';
  const mins = Math.max(1, Math.round(opts.minutesUntilDeparture));
  return (
    `Hey! Zeit aufzubrechen. Dein Flug [${label}] startet in ca. ${mins} Minuten. ` +
    `Hast du Boarding-Pass und Gepäck check?`
  );
}

/**
 * Parse a rough departure instant from free text (flight notes / chat).
 * Supports ISO timestamps and "HH:MM" / "H:MM Uhr" relative to `dayAnchor`.
 */
export function parseDepartureMsFromText(
  text: string,
  dayAnchorMs: number = Date.now(),
): number | null {
  const raw = (text ?? '').trim();
  if (!raw) return null;

  const iso = raw.match(
    /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/,
  );
  if (iso?.[1]) {
    const t = Date.parse(iso[1]);
    if (Number.isFinite(t)) return t;
  }

  const clock = raw.match(/\b(\d{1,2}):(\d{2})\s*(?:uhr)?\b/i);
  if (clock) {
    const h = Number(clock[1]);
    const m = Number(clock[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      const d = new Date(dayAnchorMs);
      d.setSeconds(0, 0);
      d.setHours(h, m, 0, 0);
      if (d.getTime() < dayAnchorMs - 2 * 60_000) {
        d.setDate(d.getDate() + 1);
      }
      return d.getTime();
    }
  }

  return null;
}
