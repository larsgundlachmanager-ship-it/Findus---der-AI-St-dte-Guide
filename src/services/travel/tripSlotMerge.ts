/**
 * Gemeinsame Reise-Slots (Flug + später Bahn): mergen, nicht abhaken.
 * Pure — kein RN.
 */

import type { FlightBookingStance } from '../flights/flightTripIntent';
import {
  dateKeyFromMs,
  nextWeekdayDateKey,
  offsetDateKey,
} from '../../utils/dateKeys';

export type TravelMode = 'flight' | 'train';

export type DateFlex = 'week' | 'month' | 'cheapest' | null;

export type TripGap = 'dest' | 'date' | 'time' | 'luggage' | 'search' | 'ready';

/** Offene Yorro-Frage — nächste kurze Antwort bindet hier, nicht an den totigen Thread. */
export type FlightPendingAsk =
  | 'luggage'
  | 'when'
  | 'which'
  | 'ride'
  | 'buffer'
  | 'wake'
  | 'hotel'
  | null;

export type TripSlotState = {
  mode: TravelMode;
  destCity: string | null;
  destIata: string | null;
  originIata: string | null;
  originName: string | null;
  originCity: string | null;
  originLat: number | null;
  originLng: number | null;
  dateKey: string | null;
  dateLocked: boolean;
  /** true = User sagte morgen/heute/Wochentag — Nachbar-Tag-Fallback verboten */
  dateFromUserHint: boolean;
  dateFlex: DateFlex;
  monthIndex: number | null;
  clockHm: string | null;
  stance: FlightBookingStance;
  selectedIdent: string | null;
  luggage: 'carry' | 'checked' | 'unknown';
  leaveByAsk: boolean;
  pendingAsk: FlightPendingAsk;
  updatedAtMs: number;
};

export type TripSlotPatch = {
  nowMs: number;
  destCity?: string | null;
  destIata?: string | null;
  originIata?: string | null;
  originName?: string | null;
  originCity?: string | null;
  originLat?: number | null;
  originLng?: number | null;
  clockHm?: string | null;
  dateHint?: 'today' | 'tomorrow' | 'evening' | 'weekday' | null;
  weekdayDe?: string | null;
  monthIndex?: number | null;
  dateFlex?: DateFlex;
  /** Call-1 Kalendertag YYYY-MM-DD — schlägt Clock-Inferenz */
  dateKeyExplicit?: string | null;
  stance?: FlightBookingStance;
  alreadyBookedExplicit?: boolean;
  wantsHelpBooking?: boolean;
  luggage?: 'carry' | 'checked' | 'unknown';
  flightCode?: string | null;
  leaveByAsk?: boolean;
  pendingAsk?: FlightPendingAsk;
};

export const TRIP_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export function emptyTripSlots(
  mode: TravelMode,
  nowMs = Date.now(),
): TripSlotState {
  return {
    mode,
    destCity: null,
    destIata: null,
    originIata: null,
    originName: null,
    originCity: null,
    originLat: null,
    originLng: null,
    dateKey: null,
    dateLocked: false,
    dateFromUserHint: false,
    dateFlex: null,
    monthIndex: null,
    clockHm: null,
    stance: 'ambiguous',
    selectedIdent: null,
    luggage: 'unknown',
    leaveByAsk: false,
    pendingAsk: null,
    updatedAtMs: nowMs,
  };
}

export function sessionIsFresh(
  prev: TripSlotState | null,
  nowMs: number,
): boolean {
  if (!prev) return false;
  return nowMs - prev.updatedAtMs <= TRIP_SESSION_TTL_MS;
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export function inferDateKeyFromClock(
  clockHm: string,
  nowMs: number,
  timeZone = 'Europe/Berlin',
): string {
  let nowMin = new Date(nowMs).getHours() * 60 + new Date(nowMs).getMinutes();
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(new Date(nowMs))
        .map((p) => [p.type, p.value]),
    );
    nowMin = Number(parts.hour ?? 0) * 60 + Number(parts.minute ?? 0);
  } catch {
    /* device-local fallback */
  }
  if (hmToMinutes(clockHm) + 20 < nowMin) return offsetDateKey(1, nowMs);
  return dateKeyFromMs(nowMs, timeZone);
}

export function monthDateKey(monthIndex: number, nowMs: number): string {
  const d = new Date(nowMs);
  d.setHours(12, 0, 0, 0);
  d.setDate(15);
  d.setMonth(monthIndex - 1);
  if (d.getTime() < nowMs - 12 * 3600_000) {
    d.setFullYear(d.getFullYear() + 1);
  }
  return dateKeyFromMs(d.getTime());
}

function dateFromPatch(
  patch: TripSlotPatch,
  prev: TripSlotState | null,
): { dateKey: string | null; locked: boolean; fromHint: boolean } {
  const now = patch.nowMs;
  const explicit =
    typeof patch.dateKeyExplicit === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(patch.dateKeyExplicit.trim())
      ? patch.dateKeyExplicit.trim()
      : null;
  if (explicit) {
    return { dateKey: explicit, locked: true, fromHint: true };
  }
  if (patch.dateHint === 'tomorrow') {
    return { dateKey: offsetDateKey(1, now), locked: true, fromHint: true };
  }
  if (patch.dateHint === 'today' || patch.dateHint === 'evening') {
    // „heute Nacht / Abend“ + frühe Uhr (z. B. 02:30) = Kalendertag morgen,
    // wenn wir schon am Vorabend sind.
    if (
      patch.dateHint === 'evening' &&
      patch.clockHm &&
      hmToMinutes(patch.clockHm) < 6 * 60
    ) {
      const nowMin = (() => {
        try {
          const parts = Object.fromEntries(
            new Intl.DateTimeFormat('en-GB', {
              timeZone: 'Europe/Berlin',
              hour: '2-digit',
              minute: '2-digit',
              hourCycle: 'h23',
            })
              .formatToParts(new Date(now))
              .map((p) => [p.type, p.value]),
          );
          return Number(parts.hour ?? 0) * 60 + Number(parts.minute ?? 0);
        } catch {
          return new Date(now).getHours() * 60 + new Date(now).getMinutes();
        }
      })();
      if (nowMin >= 12 * 60) {
        return { dateKey: offsetDateKey(1, now), locked: true, fromHint: true };
      }
    }
    return {
      dateKey: dateKeyFromMs(now, 'Europe/Berlin'),
      locked: true,
      fromHint: true,
    };
  }
  if (patch.weekdayDe) {
    return {
      dateKey: nextWeekdayDateKey(patch.weekdayDe, now) ?? dateKeyFromMs(now),
      locked: true,
      fromHint: true,
    };
  }
  if (patch.monthIndex) {
    return {
      dateKey: monthDateKey(patch.monthIndex, now),
      locked: true,
      fromHint: true,
    };
  }
  if (patch.dateFlex === 'week') {
    return { dateKey: offsetDateKey(1, now), locked: true, fromHint: true };
  }
  // Explizites „morgen/heute“ aus Vorturn nicht durch reine Uhrzeit überschreiben
  // (sonst: „morgen fliegen“ → „um 14 Uhr“ → Clock-Inferenz = heute).
  if (prev?.dateLocked && prev.dateKey) {
    return {
      dateKey: prev.dateKey,
      locked: true,
      fromHint: Boolean(prev.dateFromUserHint),
    };
  }
  if (patch.clockHm) {
    return {
      dateKey: inferDateKeyFromClock(patch.clockHm, now, 'Europe/Berlin'),
      locked: true,
      fromHint: false,
    };
  }
  return {
    dateKey: prev?.dateKey ?? null,
    locked: Boolean(prev?.dateLocked),
    fromHint: Boolean(prev?.dateFromUserHint),
  };
}

function mergeStance(
  prev: FlightBookingStance,
  patch: TripSlotPatch,
): FlightBookingStance {
  if (patch.alreadyBookedExplicit || patch.leaveByAsk) return 'booked';
  if (patch.wantsHelpBooking) return 'wish';
  if (patch.dateFlex) return 'wish';
  if (patch.stance === 'booked' || patch.stance === 'wish') return patch.stance;
  if (patch.dateHint) return 'booked';
  return prev === 'ambiguous' ? patch.stance ?? prev : prev;
}

/** Ein Turn füllt/korrigiert Slots. Neues Ziel oder neuer Tag = neuer Flug (Uhr/Nummer neu). */
export function mergeTripSlots(
  prevIn: TripSlotState | null,
  patch: TripSlotPatch,
  mode: TravelMode = 'flight',
): TripSlotState {
  const prev = sessionIsFresh(prevIn, patch.nowMs) ? prevIn : null;
  const destChanged =
    Boolean(patch.destIata) &&
    Boolean(prev?.destIata) &&
    patch.destIata !== prev?.destIata;

  const date = dateFromPatch(patch, prev);
  const dateChanged =
    Boolean(date.dateKey) &&
    Boolean(prev?.dateKey) &&
    date.dateKey !== prev?.dateKey &&
    date.locked;
  const newTrip = destChanged || dateChanged;

  const next = emptyTripSlots(mode, patch.nowMs);

  next.destCity = patch.destCity ?? prev?.destCity ?? null;
  next.destIata = patch.destIata ?? prev?.destIata ?? null;
  next.originIata = patch.originIata ?? prev?.originIata ?? null;
  next.originName = patch.originName ?? prev?.originName ?? null;
  next.originCity = patch.originCity ?? prev?.originCity ?? null;
  next.originLat = patch.originLat ?? prev?.originLat ?? null;
  next.originLng = patch.originLng ?? prev?.originLng ?? null;
  next.dateKey = date.dateKey;
  next.dateLocked = date.locked;
  next.dateFromUserHint = date.fromHint;
  next.dateFlex = patch.dateFlex
    ? patch.dateFlex
    : date.locked
      ? null
      : prev?.dateFlex ?? null;
  next.monthIndex = patch.monthIndex ?? prev?.monthIndex ?? null;
  next.clockHm = patch.clockHm ?? (newTrip ? null : prev?.clockHm ?? null);
  next.stance = mergeStance(prev?.stance ?? 'ambiguous', patch);
  next.selectedIdent = newTrip
    ? patch.flightCode ?? null
    : patch.flightCode ?? prev?.selectedIdent ?? null;
  next.luggage =
    patch.luggage && patch.luggage !== 'unknown'
      ? patch.luggage
      : prev?.luggage ?? 'unknown';
  next.leaveByAsk = Boolean(patch.leaveByAsk || prev?.leaveByAsk);
  next.pendingAsk = newTrip
    ? null
    : patch.pendingAsk !== undefined
      ? patch.pendingAsk
      : patch.luggage && patch.luggage !== 'unknown'
        ? null
        : prev?.pendingAsk ?? null;
  next.updatedAtMs = patch.nowMs;
  return next;
}

/**
 * Die eine Lücke, die Suche/Match blockiert — keine feste Checklisten-Reihenfolge.
 */
export function largestTripGap(state: TripSlotState): TripGap {
  if (!state.destIata && !state.destCity) return 'dest';
  const hasWhen =
    Boolean(state.clockHm) ||
    Boolean(state.selectedIdent) ||
    state.dateFlex === 'week' ||
    state.dateFlex === 'month' ||
    state.dateFlex === 'cheapest';
  if (!state.dateLocked && !hasWhen) return 'date';

  if (state.stance === 'wish' || (state.dateFlex && state.stance !== 'booked')) {
    return 'search';
  }

  if (!state.clockHm && !state.selectedIdent) return 'time';
  if (state.luggage === 'unknown') return 'luggage';
  return 'ready';
}
