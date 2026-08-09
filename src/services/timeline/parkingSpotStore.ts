/**
 * Gespeicherter Parkplatz-Spot — Timeline + Live-HUD (seit / T− / drüber).
 */

import * as FileSystem from 'expo-file-system';
import { dateKeyFromMs, uid } from '../../utils/dateKeys';
import { upsertVisitFromStamp } from './visitLog';

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

/** Kompakte HUD-Zeile: „geparkt seit …“ / „T− …“ / „… schon drüber“. */
export function formatParkingHudCard(nowMs = Date.now()): {
  title: string;
  meta?: string;
} | null {
  void hydrateParkingSpot();
  if (!spot) return null;
  const elapsedMin = Math.max(
    0,
    Math.round((nowMs - spot.parkedAtMs) / 60_000),
  );
  const since = formatDurationDe(elapsedMin);

  if (spot.maxDurationMin != null && spot.maxDurationMin > 0) {
    const rem = spot.maxDurationMin - elapsedMin;
    if (rem > 0) {
      return {
        title: `🅿️ ${spot.label} · T− ${formatDurationDe(rem)}`,
        meta: `Geparkt seit ${since}`,
      };
    }
    const over = Math.abs(rem);
    return {
      title: `🅿️ ${spot.label} · ${formatDurationDe(over)} drüber`,
      meta: `Max ${formatDurationDe(spot.maxDurationMin)}`,
    };
  }

  return {
    title: `🅿️ ${spot.label}`,
    meta: `Geparkt seit ${since}`,
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
  if (
    /\bparkticket\b/iu.test(t) &&
    /\b(?:bis|gilt|läuft|laeuft|uhr|\d{1,2}[:.]\d{2})\b/iu.test(t)
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
