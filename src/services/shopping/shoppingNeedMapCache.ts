/**
 * Nearby buy-places for open shopping needs → map emoji pins.
 * Refreshed from Homescreen / shopping tick — city-agnostic.
 */

import { searchOpenPlacesAhead } from '../navigation/googleMapsNav';
import type { NeedMapPlace } from '../navigation/mapEmojiPins';
import {
  useShoppingTaskStore,
  type ShoppingPlaceCategory,
} from '../../store/useShoppingTaskStore';

const MAP_SEARCH_RADIUS_M = 900;
const MIN_REFRESH_MS = 45_000;
const MAX_PLACES_PER_TASK = 6;

let cache: NeedMapPlace[] = [];
let lastRefreshAtMs = 0;
let refreshing = false;
const listeners = new Set<() => void>();

export function getShoppingNeedMapPlaces(): NeedMapPlace[] {
  return cache;
}

export function subscribeShoppingNeedMapCache(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

/** Called when shopping tick already searched — keep map in sync. */
export function publishShoppingNeedPlaces(
  taskId: string,
  itemLabel: string,
  places: Array<{ placeId: string; name: string; lat: number; lng: number }>,
): void {
  const others = cache.filter((p) => p.taskId !== taskId);
  const next = places.slice(0, MAX_PLACES_PER_TASK).map((p) => ({
    placeId: p.placeId,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    itemLabel,
    taskId,
  }));
  cache = [...others, ...next];
  notify();
}

async function searchForTypes(
  types: ShoppingPlaceCategory[],
  lat: number,
  lng: number,
): Promise<
  Array<{ placeId: string; name: string; lat: number; lng: number; distanceM: number }>
> {
  const byId = new Map<
    string,
    { placeId: string; name: string; lat: number; lng: number; distanceM: number }
  >();
  for (const placeType of types) {
    const hits = await searchOpenPlacesAhead({
      lat,
      lng,
      placeType,
      radiusM: MAP_SEARCH_RADIUS_M,
      openNow: false,
    });
    for (const h of hits) {
      const prev = byId.get(h.placeId);
      if (!prev || h.distanceM < prev.distanceM) {
        byId.set(h.placeId, {
          placeId: h.placeId,
          name: h.name,
          lat: h.lat,
          lng: h.lng,
          distanceM: h.distanceM,
        });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.distanceM - b.distanceM);
}

/**
 * Refresh map pins for open store-anchor shopping tasks near GPS.
 * Safe to call often — internally rate-limited.
 */
export async function refreshShoppingNeedMapCache(
  lat: number,
  lng: number,
  opts?: { force?: boolean },
): Promise<NeedMapPlace[]> {
  const now = Date.now();
  if (!opts?.force && now - lastRefreshAtMs < MIN_REFRESH_MS) return cache;
  if (refreshing) return cache;

  const open = useShoppingTaskStore
    .getState()
    .getOpenTasks()
    .filter(
      (t) =>
        (t.anchor ?? 'store') === 'store' &&
        Array.isArray(t.placeTypes) &&
        t.placeTypes.length > 0,
    );

  if (open.length === 0) {
    if (cache.length) {
      cache = [];
      notify();
    }
    lastRefreshAtMs = now;
    return cache;
  }

  refreshing = true;
  lastRefreshAtMs = now;
  try {
    const next: NeedMapPlace[] = [];
    for (const task of open.slice(0, 3)) {
      const places = await searchForTypes(task.placeTypes, lat, lng);
      for (const p of places.slice(0, MAX_PLACES_PER_TASK)) {
        next.push({
          placeId: p.placeId,
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          itemLabel: task.itemLabel,
          taskId: task.id,
        });
      }
    }
    cache = next;
    notify();
    return cache;
  } catch {
    return cache;
  } finally {
    refreshing = false;
  }
}
