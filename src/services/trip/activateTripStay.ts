/**
 * Trip aktivieren: Store + Day-Skeletons + Itinerary + Calendar + Prefetch.
 */

import { useTripModeStore } from '../../store/useTripModeStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { useFuturePlanStore } from '../../module2/timeline/futurePlanState';
import { usePlanCalendarUiStore } from '../../module2/timeline/planCalendarUiStore';
import { getCachedUserProfile } from '../userProfileService';
import { offsetDateKey } from '../../utils/dateKeys';
import type { TripStayParse } from './parseTripStay';

export type ActivateTripResult = {
  ok: boolean;
  dayCount: number;
  startDayKey: string;
  endDayKey: string;
  cityName: string | null;
  cityId: string | null;
  speechHint: string;
};

function themeForDay(index0: number, dayCount: number): string {
  if (dayCount <= 1) return 'Tagestrip — Stadt erleben';
  if (index0 === 0) return 'Anreise & Orientieren';
  if (index0 === dayCount - 1) return 'Abreise & letzte Highlights';
  if (dayCount >= 4 && index0 === 1) return 'Erste Highlights';
  return 'Erkunden';
}

function wishTitleForDay(index0: number, dayCount: number): string {
  if (dayCount <= 1) return 'Highlights & Atmosphäre';
  if (index0 === 0) return 'Ankommen, Überblick, erstes Essen';
  if (index0 === dayCount - 1) return 'Letzte Spots / Heimreise';
  return 'Sehenswertes, Pause, Abendessen';
}

function resolveCityId(cityName: string | null): {
  cityId: string | null;
  cityName: string | null;
} {
  const profile = getCachedUserProfile();
  const profileId = profile?.cityId?.trim().toLowerCase() || null;
  const profileName = profile?.cityName?.trim() || null;
  if (!cityName) {
    return { cityId: profileId, cityName: profileName };
  }
  const want = cityName.trim().toLowerCase();
  if (profileName && profileName.toLowerCase().includes(want)) {
    return { cityId: profileId, cityName: profileName };
  }
  if (profileId && (profileId === want || profileId.includes(want))) {
    return { cityId: profileId, cityName: cityName };
  }
  // Slug-Heuristik (muenchen / münchen)
  const slug = want
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return { cityId: slug || null, cityName };
}

function seedTripDays(opts: {
  startDayKey: string;
  dayCount: number;
  cityName: string | null;
}): void {
  const store = useFuturePlanStore.getState();
  for (let i = 0; i < opts.dayCount; i++) {
    const dayKey =
      i === 0
        ? opts.startDayKey
        : offsetDateKey(i, Date.parse(`${opts.startDayKey}T12:00:00`));
    store.ensureDay(dayKey);
    const plan = store.getPlanForDay(dayKey);
    const wishId = `trip_frame_${dayKey}`;
    if (plan.stops.some((s) => s.id === wishId)) continue;
    store.upsertStopOnDay(dayKey, {
      id: wishId,
      title: wishTitleForDay(i, opts.dayCount),
      kind: 'wish',
      bufferMin: 0,
      transport: 'walk',
      planPriority: 5,
      openOrder: 0,
      notes: `${themeForDay(i, opts.dayCount)}${
        opts.cityName ? ` · ${opts.cityName}` : ''
      }`,
      status: 'planned',
    });
  }
}

/**
 * Startet Touristen-Trip aus geparster Äußerung.
 */
export function activateTripStay(parsed: TripStayParse): ActivateTripResult {
  const resolved = resolveCityId(parsed.cityName);
  const trip = useTripModeStore.getState().startTrip({
    cityId: resolved.cityId,
    cityName: resolved.cityName ?? parsed.cityName,
    startDayKey: parsed.startDayKey,
    dayCount: parsed.dayCount,
    source: 'voice',
  });

  seedTripDays({
    startDayKey: trip.startDayKey,
    dayCount: trip.dayCount,
    cityName: trip.cityName,
  });

  try {
    const checkOut = trip.endDayKey;
    useUserMemoryStore.getState().setTravelItinerary({
      rawText: parsed.sourceText,
      summary: trip.cityName
        ? `${trip.dayCount} Tage ${trip.cityName}`
        : `${trip.dayCount} Tage Trip`,
      uploadedAt: new Date().toISOString(),
      structured: {
        city: trip.cityName,
        hotelName: null,
        checkInLocal: `${trip.startDayKey}T15:00:00`,
        checkOutLocal: `${checkOut}T11:00:00`,
        deadlines: [],
        stops: [],
        blocks: [],
        todos: [],
        preferences: [],
      },
    });
    void useUserMemoryStore.getState().persist();
  } catch {
    /* soft */
  }

  try {
    usePlanCalendarUiStore.getState().setHeadlessPlanning(false);
    usePlanCalendarUiStore.getState().requestDayKey(trip.startDayKey);
    usePlanCalendarUiStore.getState().requestOpen();
    useFuturePlanStore.getState().ensureDay(trip.startDayKey);
  } catch {
    /* soft */
  }

  // Offline: Routen für heutige/morgige Stops vorwärmen (best effort)
  void import('./prefetchTripRoutes')
    .then((m) => m.prefetchTripRoutesSoon())
    .catch(() => undefined);

  const where = trip.cityName ? ` in ${trip.cityName}` : '';
  const speechHint =
    trip.dayCount === 1
      ? `Alles klar — Tagestrip${where}. Ich lege den Tag im Kalender an; sag mir, worauf du Lust hast.`
      : `Alles klar — ${trip.dayCount} Tage${where}. Ich habe Tag 1 bis ${trip.dayCount} im Kalender vorbereitet; wir füllen sie Schritt für Schritt.`;

  return {
    ok: true,
    dayCount: trip.dayCount,
    startDayKey: trip.startDayKey,
    endDayKey: trip.endDayKey,
    cityName: trip.cityName,
    cityId: trip.cityId,
    speechHint,
  };
}
