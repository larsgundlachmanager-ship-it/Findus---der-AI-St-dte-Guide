/**
 * Gespeicherter Parkplatz-Spot — Timeline + Live-HUD (seit / T− / drüber).
 */

import * as FileSystem from 'expo-file-system';
import { dateKeyFromMs, uid } from '../../utils/dateKeys';
import { upsertVisitFromStamp } from './visitLog';
import { isParkingSearchIntent } from '../concierge/timeCareIntent';
import { parkingTicketAtArrival } from './parkingTicketMath';

export { isParkingSearchIntent } from '../concierge/timeCareIntent';
export { parkingTicketAtArrival } from './parkingTicketMath';

export type ParkingSpot = {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
  parkedAtMs: number;
  /** Max. Parkdauer in Minuten (z. B. 180 = 3 h), optional */
  maxDurationMin: number | null;
  dateKey: string;
};

const PATH = `${FileSystem.documentDirectory}findus-parking-spot-v1.json`;

let spot: ParkingSpot | null = null;
let hydrated = false;
let hydratePromise: Promise<void> | null = null;

async function persist(): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      PATH,
      JSON.stringify({ spot, savedAt: Date.now() }),
    );
  } catch {
    /* soft */
  }
}

export async function hydrateParkingSpot(): Promise<void> {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const info = await FileSystem.getInfoAsync(PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(PATH);
        const parsed = JSON.parse(raw) as { spot?: ParkingSpot | null };
        spot = parsed.spot ?? null;
      }
    } catch {
      spot = null;
    } finally {
      hydrated = true;
      hydratePromise = null;
    }
  })();
  return hydratePromise;
}

export function getParkingSpot(): ParkingSpot | null {
  void hydrateParkingSpot();
  return spot;
}

export function saveParkingSpot(opts: {
  label?: string;
  lat?: number | null;
  lng?: number | null;
  parkedAtMs?: number;
  maxDurationMin?: number | null;
}): ParkingSpot {
  void hydrateParkingSpot();
  const at = opts.parkedAtMs ?? Date.now();
  const next: ParkingSpot = {
    id: uid('park'),
    label: (opts.label ?? 'Parkplatz').trim() || 'Parkplatz',
    lat: opts.lat ?? null,
    lng: opts.lng ?? null,
    parkedAtMs: at,
    maxDurationMin:
      opts.maxDurationMin != null && opts.maxDurationMin > 0
        ? Math.round(opts.maxDurationMin)
        : null,
    dateKey: dateKeyFromMs(at),
  };
  spot = next;
  void persist();

  try {
    upsertVisitFromStamp({
      name: next.label,
      lat: next.lat,
      lng: next.lng,
      arrivedAtMs: at,
      dwellMin: 0,
      source: 'manual',
      onTimeline: true,
    });
  } catch {
    /* soft */
  }

  return next;
}

export function clearParkingSpot(): void {
  spot = null;
  void persist();
}

function formatDurationDe(totalMin: number): string {
  const m = Math.max(0, Math.round(totalMin));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h <= 0) return `${rest} Min`;
  if (rest === 0) return `${h} Std`;
  return `${h} Std ${rest} Min`;
}

function resolveTravelMinToSpot(spot: ParkingSpot): {
  travelMin: number;
  modeLabel: string;
} | null {
  try {
    const {
      getLastParkingWalkMinEstimate,
    } = require('./parkingCareEngine') as {
      getLastParkingWalkMinEstimate: () => number | null;
    };
    const cached = getLastParkingWalkMinEstimate();
    if (cached != null && cached > 0) {
      let modeLabel = 'Fuß';
      try {
        const { resolveActiveTravelMode } = require('../navigation/travelModeContext') as {
          resolveActiveTravelMode: () => { mode: string };
        };
        if (resolveActiveTravelMode().mode === 'bike') modeLabel = 'Rad';
      } catch {
        /* soft */
      }
      return { travelMin: cached, modeLabel };
    }
  } catch {
    /* soft */
  }
  if (spot.lat == null || spot.lng == null) return null;
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => {
          lastGpsLat: number | null;
          lastGpsLng: number | null;
        };
      };
    };
    const { haversineMeters } = require('../../db/database') as {
      haversineMeters: (
        aLat: number,
        aLng: number,
        bLat: number,
        bLng: number,
      ) => number;
    };
    const gps = useFinnusStore.getState();
    if (
      gps.lastGpsLat == null ||
      gps.lastGpsLng == null ||
      !Number.isFinite(gps.lastGpsLat) ||
      !Number.isFinite(gps.lastGpsLng)
    ) {
      return null;
    }
    const dist = haversineMeters(
      gps.lastGpsLat,
      gps.lastGpsLng,
      spot.lat,
      spot.lng,
    );
    let travelMin = Math.max(1, Math.ceil(dist / 80));
    let modeLabel = 'Fuß';
    try {
      const { resolveActiveTravelMode } = require('../navigation/travelModeContext') as {
        resolveActiveTravelMode: () => { mode: string };
      };
      const { walkMinutesForDistanceM, bikeMinutesForDistanceM } = require('../navigation/travelEta') as {
        walkMinutesForDistanceM: (m: number) => number;
        bikeMinutesForDistanceM: (m: number) => number;
      };
      const mode = resolveActiveTravelMode().mode;
      if (mode === 'bike') {
        travelMin = bikeMinutesForDistanceM(dist);
        modeLabel = 'Rad';
      } else {
        travelMin = walkMinutesForDistanceM(dist);
        modeLabel = 'Fuß';
      }
    } catch {
      /* keep fallback */
    }
    return { travelMin, modeLabel };
  } catch {
    return null;
  }
}

export type ParkingHudCardLine = {
  title: string;
  meta?: string;
  tellMorePrompt: string;
  navDest?: { name: string; lat: number; lng: number };
};

/** Kompakte HUD-Zeile: Wegzeit + Restzeit bei Ankunft / drüber. */
export function formatParkingHudCard(nowMs = Date.now()): ParkingHudCardLine | null {
  void hydrateParkingSpot();
  if (!spot) return null;
  const travel = resolveTravelMinToSpot(spot);
  const ticket = parkingTicketAtArrival({
    nowMs,
    parkedAtMs: spot.parkedAtMs,
    maxDurationMin: spot.maxDurationMin,
    travelMin: travel?.travelMin ?? 0,
  });
  const since = formatDurationDe(ticket.elapsedMin);
  const navDest =
    spot.lat != null &&
    spot.lng != null &&
    Number.isFinite(spot.lat) &&
    Number.isFinite(spot.lng)
      ? { name: spot.label || 'Parkplatz', lat: spot.lat, lng: spot.lng }
      : undefined;

  const travelBit = travel
    ? `~${travel.travelMin} Min ${travel.modeLabel}`
    : null;

  let arrivalBit: string | null = null;
  if (ticket.remAtArrivalMin != null && travel) {
    if (ticket.remAtArrivalMin > 0) {
      arrivalBit = `bei Ankunft noch ${formatDurationDe(ticket.remAtArrivalMin)}`;
    } else if (ticket.remAtArrivalMin === 0) {
      arrivalBit = 'bei Ankunft gerade abgelaufen';
    } else {
      arrivalBit = `bei Ankunft ${formatDurationDe(Math.abs(ticket.remAtArrivalMin))} drüber`;
    }
  } else if (ticket.remNowMin != null) {
    if (ticket.remNowMin > 0) {
      arrivalBit = `noch ${formatDurationDe(ticket.remNowMin)}`;
    } else {
      arrivalBit = `${formatDurationDe(Math.abs(ticket.remNowMin))} drüber`;
    }
  }

  const metaParts = [
    travelBit,
    arrivalBit,
    !travelBit && !arrivalBit ? `Geparkt seit ${since}` : null,
    travelBit && ticket.remAtArrivalMin == null ? `seit ${since}` : null,
  ].filter(Boolean) as string[];

  let title: string;
  if (ticket.remNowMin != null) {
    if (ticket.remNowMin > 0) {
      title = `🅿️ ${spot.label} · T− ${formatDurationDe(ticket.remNowMin)}`;
    } else {
      title = `🅿️ ${spot.label} · ${formatDurationDe(Math.abs(ticket.remNowMin))} drüber`;
    }
  } else {
    title = `🅿️ ${spot.label}`;
  }

  const tellBits: string[] = [];
  if (travel) {
    tellBits.push(
      `Route zurück zum ${spot.label || 'Parkplatz'} — ca. ${travel.travelMin} Min ${travel.modeLabel}`,
    );
  } else {
    tellBits.push(`Route zurück zum ${spot.label || 'Parkplatz'}`);
  }
  if (ticket.remAtArrivalMin != null && travel) {
    if (ticket.remAtArrivalMin > 0) {
      tellBits.push(
        `bei Ankunft noch ca. ${formatDurationDe(ticket.remAtArrivalMin)} Ticketzeit`,
      );
    } else if (ticket.remAtArrivalMin === 0) {
      tellBits.push('bei Ankunft wäre das Ticket gerade abgelaufen');
    } else {
      tellBits.push(
        `bei Ankunft ca. ${formatDurationDe(Math.abs(ticket.remAtArrivalMin))} über der Zeit`,
      );
    }
  } else if (ticket.remNowMin != null) {
    if (ticket.remNowMin > 0) {
      tellBits.push(`Ticket noch ${formatDurationDe(ticket.remNowMin)}`);
    } else {
      tellBits.push(
        `Ticket schon ${formatDurationDe(Math.abs(ticket.remNowMin))} drüber`,
      );
    }
  }
  tellBits.push('Navigation starten und Leave-by klar sagen.');

  return {
    title,
    meta: metaParts.length ? metaParts.join(' · ') : `Geparkt seit ${since}`,
    tellMorePrompt: tellBits.join(' — '),
    navDest,
  };
}

/** Voice: „3 Stunden“ / „180 Minuten“ / „nur 2 h“ / „bis 17:42“. */
export function parseParkingMaxDurationMin(text: string): number | null {
  const t = text.replace(/\s+/g, ' ').trim();
  // Absolute Uhrzeit: „Parkticket bis 17:42“ → Minuten bis dahin
  const untilClock = t.match(
    /\b(?:bis|gilt\s+bis|läuft\s+bis|laeuft\s+bis|ticket\s+bis)\s*(\d{1,2})[:.](\d{2})\b/iu,
  );
  if (untilClock?.[1] != null && untilClock[2] != null) {
    const hh = Number(untilClock[1]);
    const mm = Number(untilClock[2]);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      const now = new Date();
      const end = new Date(now);
      end.setHours(hh, mm, 0, 0);
      if (end.getTime() <= now.getTime()) {
        end.setDate(end.getDate() + 1);
      }
      const mins = Math.round((end.getTime() - now.getTime()) / 60_000);
      if (mins > 0 && mins <= 24 * 60) return mins;
    }
  }
  const hours =
    t.match(
      /\b(?:max(?:imal)?|nur|höchstens|hoechstens|bis)\s*(\d{1,2})\s*(?:stunden|stunde|std|h)\b/iu,
    ) ?? t.match(/\b(\d{1,2})\s*(?:stunden|stunde|std)\b/iu);
  if (hours?.[1]) {
    const h = Number(hours[1]);
    if (h > 0 && h <= 24) return h * 60;
  }
  const mins = t.match(
    /\b(?:max(?:imal)?|nur|höchstens|hoechstens)?\s*(\d{1,3})\s*(?:minuten|minute|min)\b/iu,
  );
  if (mins?.[1]) {
    const m = Number(mins[1]);
    if (m > 0 && m <= 24 * 60) return m;
  }
  return null;
}

export function isParkingSpotSaveIntent(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (isParkingSearchIntent(t)) return false;
  if (
    /\bparkticket\b/iu.test(t) &&
    /\b(?:bis|gilt|läuft|laeuft|uhr|\d{1,2}[:.]\d{2}|stunden|stunde)\b/iu.test(t)
  ) {
    return true;
  }
  // „Mein Auto — darf nur 3 Stunden parken“ — nicht „mit dem Auto … Parkplatz suchen“
  if (
    /\b(?:mein(?:en)?\s+)?auto\b/iu.test(t) &&
    /\b(?:park(?:en|platz|ticket)|ticket)\b/iu.test(t) &&
    /\b(speicher|merk|hier|geparkt|darf\s+nur|maximale\s+park)\b/iu.test(t)
  ) {
    return true;
  }
  if (
    /\bpark(?:en|platz|ticket)\b/iu.test(t) &&
    parseParkingMaxDurationMin(t) != null &&
    /\b(speicher|merk|ticket|darf\s+nur|max\.?)\b/iu.test(t)
  ) {
    return true;
  }
  return (
    /\b(?:mein(?:en)?\s+)?parkplatz(?:[\s-]?spot)?\b/iu.test(t) &&
    /\b(?:speicher(?:n|e)?|merk(?:en|e)?|das\s+ist|hier\s+(?:ist|park)|geparkt|parken\s+hier)\b/iu.test(
      t,
    )
  ) ||
    /\b(?:parkplatz(?:[\s-]?spot)?\s+(?:speicher(?:n|e)?|merk(?:en|e)?)|speicher(?:n|e)?\s+(?:den\s+)?parkplatz)\b/iu.test(
      t,
    ) ||
    /\b(?:hier\s+(?:ist\s+)?mein\s+parkplatz|das\s+ist\s+(?:mein|unser)\s+parkplatz)\b/iu.test(
      t,
    );
}
