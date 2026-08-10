/**
 * Pure helpers for departure leave-by timing and reminder copy.
 * Trigger: T_departure − ETA_walk − Buffer_safety
 */

import type { LogisticsMode } from '../logistics/logisticsTriggerMath';

/** Default safety buffer before walking out (minutes). */
export const DEFAULT_SAFETY_BUFFER_MIN = 9;

/**
 * Clamp for safety buffer.
 * Default ~9; explicit values 2–30 (Fuß/Rad oft 2, großer Bahnhof bis 30).
 */
export function clampSafetyBufferMin(bufferMin?: number): number {
  if (bufferMin == null || !Number.isFinite(bufferMin)) {
    return DEFAULT_SAFETY_BUFFER_MIN;
  }
  return Math.min(30, Math.max(2, Math.round(bufferMin)));
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
  const leaveByMs = opts.departureMs - (walk + safety) * 60_000;
  const leadMs = leaveByMs - now;
  const minLead = opts.minLeadMs ?? 15_000;
  if (leadMs < minLead) return null;
  return { leaveByMs, leadMs, safetyBufferMin: safety };
}

/** Minutes remaining until departure/arrival target at fire time (approx). */
export function minutesUntilDepartureAtLeave(
  departureMs: number,
  leaveByMs: number,
): number {
  return Math.max(1, Math.round((departureMs - leaveByMs) / 60_000));
}

export function cleanLeaveDestLabel(raw?: string | null): string {
  return (raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(los\s+zum|los\s+zur|los\s+zu|auf\s+zum|auf\s+zur)\s+/i, '')
    .replace(/^essen:\s*/i, '')
    .trim();
}

function isTransitMode(mode: LogisticsMode | string | undefined): boolean {
  return (
    mode === 'bus' ||
    mode === 'train' ||
    mode === 'ferry' ||
    mode === 'transit'
  );
}

/**
 * Mode-aware leave-by Push/TTS copy.
 * Fuß/Rad: kein Bus/Bahn, kein „gezahlt“.
 * ÖPNV nur bei echtem Transit-Mode.
 * Kontext-Hints (bezahlt / Checkout) nur wenn explizit übergeben.
 * Optional: Minuten bis Leave + Reisekette (Bahn → Theater).
 */
export function buildLeaveReminderBody(opts: {
  mode?: LogisticsMode | 'transit' | string | null;
  /** Zielort (Restaurant, POI, …) — nicht Haltestelle, außer bei Transit. */
  destName?: string | null;
  /** Linie / Flugnummer bei Transit/Flight. */
  line?: string | null;
  stationName?: string | null;
  /** Minuten bis wir spätestens am Ziel / an der Abfahrt sein müssen. */
  minutesUntilArrive: number;
  /** Minuten bis Leave-by (Vorwarnung) — wenn gesetzt: „in X Minuten los“. */
  minutesUntilLeave?: number | null;
  /** Nächstes Etappenziel nach Transit (z. B. Theater nach Bahn). */
  chainDestName?: string | null;
  /** Nur wenn live zutreffend: „Hast du schon bezahlt?“ etc. */
  contextHint?: string | null;
  /** true = Soft-Vorwarnung, kürzerer Ton. */
  soft?: boolean;
}): string {
  const mins = Math.max(1, Math.round(opts.minutesUntilArrive));
  const leaveIn =
    opts.minutesUntilLeave != null && Number.isFinite(opts.minutesUntilLeave)
      ? Math.max(1, Math.round(opts.minutesUntilLeave))
      : null;
  const mode = (opts.mode ?? 'generic') as string;
  const dest = cleanLeaveDestLabel(opts.destName);
  const station = cleanLeaveDestLabel(opts.stationName);
  const chain = cleanLeaveDestLabel(opts.chainDestName);
  const line = (opts.line ?? '').replace(/\s+/g, ' ').trim();
  const hint = opts.contextHint?.replace(/\s+/g, ' ').trim() || '';

  const lead =
    leaveIn != null
      ? `In etwa ${leaveIn} Minuten musst du los`
      : 'Zeit aufzubrechen — du musst jetzt los';

  let core: string;

  if (mode === 'flight') {
    const label = line || dest || 'Flug';
    core =
      `${lead} zum Flug ${label}` +
      (leaveIn == null ? ` (Start in ca. ${mins} Minuten)` : '') +
      '.';
  } else if (isTransitMode(mode)) {
    const conn =
      line && !/^los\b/i.test(line)
        ? line
        : mode === 'train'
          ? 'Bahn'
          : mode === 'ferry'
            ? 'Fähre'
            : 'Bus';
    const where = station
      ? ` zur Haltestelle ${station}`
      : dest
        ? ` nach ${dest}`
        : '';
    const after =
      chain && chain.toLowerCase() !== (dest || '').toLowerCase()
        ? ` — danach fahren wir gemeinsam nach ${chain}`
        : dest && !station
          ? ''
          : dest
            ? ` — dann weiter nach ${dest}`
            : '';
    core = `${lead}${where || ` zur ${conn}`}${after}. Bist du bereit?`;
  } else {
    const how =
      mode === 'bike'
        ? ' mit dem Fahrrad'
        : mode === 'car'
          ? ' mit dem Auto'
          : mode === 'taxi'
            ? ' mit dem Taxi'
            : mode === 'walk'
              ? ' zu Fuß'
              : '';
    const where = dest ? ` nach ${dest}` : '';
    const after =
      chain && chain.toLowerCase() !== (dest || '').toLowerCase()
        ? ` — danach ${chain}`
        : '';
    core =
      leaveIn != null
        ? `${lead}${how}${where}${after}. Bist du bereit?`
        : `Hey — ${lead}${how}${where}. In ${mins} Minuten müssen wir spätestens dahin.${after ? ` ${after}.` : ''} Bist du bereit?`;
  }

  return hint ? `${core} ${hint}` : core;
}

/** @deprecated Prefer buildLeaveReminderBody — kept for transit callers. */
export function buildTransitReminderBody(opts: {
  line: string;
  minutesUntilDeparture: number;
  stationName?: string;
  destName?: string;
  contextHint?: string | null;
}): string {
  return buildLeaveReminderBody({
    mode: 'bus',
    line: opts.line,
    stationName: opts.stationName,
    destName: opts.destName,
    minutesUntilArrive: opts.minutesUntilDeparture,
    contextHint: opts.contextHint,
  });
}

export function buildFlightReminderBody(opts: {
  flightLabel: string;
  minutesUntilDeparture: number;
  contextHint?: string | null;
}): string {
  return buildLeaveReminderBody({
    mode: 'flight',
    line: opts.flightLabel,
    minutesUntilArrive: opts.minutesUntilDeparture,
    contextHint:
      opts.contextHint ??
      'Boarding-Pass und Gepäck kurz checken?',
  });
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
