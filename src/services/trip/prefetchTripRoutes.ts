/**
 * Prefetch Walking-Routen für Trip-/Plan-Stops → Offline-Nav-Cache.
 */

import { useFuturePlanStore } from '../../module2/timeline/futurePlanState';
import { useGpsStore } from '../../store/useGpsStore';
import { useTripModeStore } from '../../store/useTripModeStore';
import { offsetDateKey, todayDateKey } from '../../utils/dateKeys';
import { isDeviceOffline } from '../navigation/networkState';
import {
  putCachedRoute,
  upsertCachedDestination,
} from '../navigation/offlineNavCache';
import {
  directionsToWaypoints,
  fetchRouteDirectionsResult,
  walkingDistanceFromSteps,
} from '../navigation/googleMapsNav';

let lastPrefetchAt = 0;
const COOLDOWN_MS = 45_000;

function dayKeysToPrefetch(): string[] {
  const today = todayDateKey();
  const keys = new Set<string>([today, offsetDateKey(1)]);
  const trip = useTripModeStore.getState();
  if (trip.active) {
    keys.add(trip.startDayKey);
    const idx = trip.getTripDayIndex(today);
    if (idx != null && idx < trip.dayCount) {
      keys.add(offsetDateKey(1));
    }
  }
  return [...keys];
}

/**
 * Online: bis zu 4 Plan-Stops cachen (heutiger GPS-Ursprung → Ziel).
 */
export async function prefetchTripRoutesSoon(): Promise<number> {
  const now = Date.now();
  if (now - lastPrefetchAt < COOLDOWN_MS) return 0;
  lastPrefetchAt = now;

  try {
    if (await isDeviceOffline()) return 0;
  } catch {
    return 0;
  }

  const gps = useGpsStore.getState();
  const originLat = gps.lat;
  const originLng = gps.lng;
  if (
    typeof originLat !== 'number' ||
    typeof originLng !== 'number' ||
    !Number.isFinite(originLat) ||
    !Number.isFinite(originLng)
  ) {
    return 0;
  }

  const stops: Array<{ title: string; lat: number; lng: number }> = [];
  const seen = new Set<string>();
  for (const dayKey of dayKeysToPrefetch()) {
    useFuturePlanStore.getState().ensureDay(dayKey);
    for (const s of useFuturePlanStore.getState().getPlanForDay(dayKey).stops) {
      if (s.kind === 'nav_leg') continue;
      if (typeof s.lat !== 'number' || typeof s.lng !== 'number') continue;
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
      const key = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stops.push({ title: s.title || 'Ziel', lat: s.lat, lng: s.lng });
      if (stops.length >= 4) break;
    }
    if (stops.length >= 4) break;
  }

  let cached = 0;
  for (const stop of stops) {
    try {
      const result = await fetchRouteDirectionsResult(
        { lat: originLat, lng: originLng },
        { lat: stop.lat, lng: stop.lng },
        'walking',
      );
      if (!result?.steps?.length) continue;
      const waypoints = directionsToWaypoints(result.steps);
      if (waypoints.length < 2) continue;
      await putCachedRoute({
        destName: stop.title,
        destLat: stop.lat,
        destLng: stop.lng,
        waypoints,
        stations: [],
        travelMode: 'walking',
        walkingDistanceM: walkingDistanceFromSteps(result.steps),
      });
      await upsertCachedDestination({
        name: stop.title,
        lat: stop.lat,
        lng: stop.lng,
        source: 'nav',
      });
      cached += 1;
    } catch (err) {
      if (__DEV__) console.warn('[tripPrefetch] route failed', err);
    }
  }
  return cached;
}
