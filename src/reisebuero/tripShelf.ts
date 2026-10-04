/**
 * Gespeicherte Reisebüro-Trips (Flipchart-Shelf).
 * AsyncStorage lazy — Node-Smoke ohne RN.
 */

import { composeTripShelfTitle } from './composeTripTitle';
import type { ReiseTrip } from './types';
import { looksLikeTripTypePurpose, looksLikeWishDumpPurpose } from './tripPurpose';

const STORAGE_KEY = 'findus.reisebuero.trips.v1';
const MAX_SAVED = 12;

async function getStorage(): Promise<{
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
} | null> {
  try {
    const mod = require('@react-native-async-storage/async-storage');
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

export function tripWorthSaving(trip: ReiseTrip): boolean {
  if (!trip) return false;
  // Akt 1 (Planen/briefing) nie speichern — erst ab Akt 2 Kurzcheck.
  try {
    const { phaseToAct } = require('./acts') as {
      phaseToAct: (p: ReiseTrip['phase']) => string;
    };
    if (phaseToAct(trip.phase) === 'collect') return false;
  } catch {
    if (trip.phase === 'briefing') return false;
  }
  if ((trip.options?.length ?? 0) > 0) return true;
  if (
    trip.phase === 'recap' ||
    trip.phase === 'research' ||
    trip.phase === 'results' ||
    trip.phase === 'detail' ||
    trip.phase === 'verify'
  ) {
    const l = trip.ledger;
    return Boolean(
      l?.purpose ||
        l?.adults ||
        l?.budgetEur ||
        l?.dateStart ||
        l?.dateEnd ||
        l?.destinationHint ||
        (l?.mustHaves?.value?.length ?? 0) > 0 ||
        (l?.wishHaves?.value?.length ?? 0) > 0 ||
        (trip.chat?.length ?? 0) > 0,
    );
  }
  return false;
}

/** Hub-Karte: greifbarer Reise-Name (Hook · Ort · Akzent). */
export function tripShelfTitle(trip: ReiseTrip): string {
  return composeTripShelfTitle(trip);
}

/** Header-Titel: Brand solange unklar; sonst Reise-Titel (Zweck / Ziel). */
export function reiseHeaderTitle(
  trip: ReiseTrip,
  opts?: { showLegend?: boolean },
): string {
  const l = trip.ledger;
  const purpose = l.purpose?.value?.trim();
  if (purpose && purpose.length >= 3 && !looksLikeWishDumpPurpose(purpose)) {
    return purpose.slice(0, 34);
  }
  if (purpose && looksLikeTripTypePurpose(purpose)) return purpose.slice(0, 34);

  const showLegend = opts?.showLegend !== false;
  // Legende noch an → Brand behalten, außer Zweck ist klar (oben)
  if (showLegend) return 'Yorros Reisebüro';

  // Nach Legende: voller Trip-Titel (Ort + Vibe), nicht nur Dest
  const composed = composeTripShelfTitle(trip);
  if (composed && composed !== 'Reise' && composed !== 'Neue Reise') {
    return composed.slice(0, 34);
  }

  const dest = l.destinationHint?.value?.trim();
  if (dest && dest !== 'offen' && dest !== 'egal') {
    const n = l.adults?.value;
    return (n ? `${dest} · ${n}` : dest).slice(0, 34);
  }
  const bits: string[] = [];
  if (l.dateMonth?.value) {
    const mm = l.dateMonth.value.slice(5, 7);
    const MONTH: Record<string, string> = {
      '01': 'Jan',
      '02': 'Feb',
      '03': 'Mär',
      '04': 'Apr',
      '05': 'Mai',
      '06': 'Jun',
      '07': 'Jul',
      '08': 'Aug',
      '09': 'Sep',
      '10': 'Okt',
      '11': 'Nov',
      '12': 'Dez',
    };
    bits.push(MONTH[mm] || mm);
  }
  if (l.adults?.value) bits.push(`${l.adults.value} Leute`);
  if (l.stayNights?.value && l.stayNightsMax?.value) {
    bits.push(`${l.stayNights.value}–${l.stayNightsMax.value} Nächte`);
  } else if (l.stayNights?.value) {
    bits.push(`${l.stayNights.value} Nächte`);
  }
  if (bits.length) return bits.join(' · ').slice(0, 34);
  return 'Yorros Reisebüro';
}

export async function loadSavedTrips(): Promise<ReiseTrip[]> {
  try {
    const AsyncStorage = await getStorage();
    if (!AsyncStorage) return [];
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as { trips?: ReiseTrip[] };
    return Array.isArray(p?.trips)
      ? p.trips
          .filter((t) => t?.id && t?.ledger)
          .map((t) => {
            const withSparks = { ...t, researchSparks: t.researchSparks ?? [] };
            return { ...withSparks, name: tripShelfTitle(withSparks) };
          })
      : [];
  } catch {
    return [];
  }
}

export async function persistSavedTrips(trips: ReiseTrip[]): Promise<void> {
  try {
    const AsyncStorage = await getStorage();
    if (!AsyncStorage) return;
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ trips: trips.slice(0, MAX_SAVED), updatedAtMs: Date.now() }),
    );
  } catch {
    /* soft */
  }
}

export function upsertSavedTrip(list: ReiseTrip[], trip: ReiseTrip): ReiseTrip[] {
  const next = list.filter((t) => t.id !== trip.id);
  next.unshift({
    ...trip,
    researchSparks: trip.researchSparks ?? [],
    name: tripShelfTitle(trip),
    updatedAtMs: Date.now(),
    frozen: false,
    thinking: false,
    searching: false,
  });
  return next.slice(0, MAX_SAVED);
}
