/**
 * Zwei Sunset-Spots mit freiem Horizont (OSM) — HUD + Pitch.
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import { searchOsmPlacesNearby } from '../navigation/overpassService';
import { walkMinutesForDistanceM } from '../navigation/travelEta';
import { fitHudMeta } from './hudTextFit';

export type SunsetHorizonSpot = {
  name: string;
  lat: number;
  lng: number;
  walkMin: number;
  distanceM: number;
};

export type SunsetHorizonCache = {
  atMs: number;
  lat: number;
  lng: number;
  spots: SunsetHorizonSpot[];
};

const TTL_MS = 40 * 60_000;
const CELL_M = 220;

let cache: SunsetHorizonCache | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function subscribeSunsetHud(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

function cellKey(lat: number, lng: number): string {
  const latStep = CELL_M / 111_000;
  const lngStep = CELL_M / (111_000 * Math.cos((lat * Math.PI) / 180));
  return `${(lat / latStep).toFixed(0)},${(lng / lngStep).toFixed(0)}`;
}

export function getSunsetHorizonCache(): SunsetHorizonCache | null {
  if (!cache) return null;
  if (Date.now() - cache.atMs > TTL_MS) return null;
  return cache;
}

function scoreSpot(
  lat: number,
  lng: number,
  hit: { name: string; lat: number; lng: number; distanceM: number; types: string[] },
): number {
  const types = hit.types.join(' ').toLowerCase();
  let s = 0;
  if (/viewpoint/.test(types)) s += 40;
  if (/peak|cliff|beach|pier|marina/.test(types)) s += 28;
  if (/park|garden/.test(types)) s += 8;
  if (hit.lng <= lng) s += 12; // westlich (Abendsonne)
  s += Math.max(0, 22 - hit.distanceM / 120);
  if (!hit.name.trim()) s -= 20;
  return s;
}

export async function ensureSunsetHudFresh(opts?: {
  force?: boolean;
}): Promise<SunsetHorizonCache | null> {
  const store = useFinnusStore.getState();
  const lat = store.lastGpsLat;
  const lng = store.lastGpsLng;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return getSunsetHorizonCache();
  }

  const existing = getSunsetHorizonCache();
  if (
    !opts?.force &&
    existing &&
    cellKey(existing.lat, existing.lng) === cellKey(lat, lng)
  ) {
    return existing;
  }

  if (inFlight) {
    await inFlight;
    return getSunsetHorizonCache();
  }

  inFlight = (async () => {
    try {
      const [views, parks] = await Promise.all([
        searchOsmPlacesNearby({
          lat,
          lng,
          placeType: 'viewpoint',
          radiusM: 2800,
        }),
        searchOsmPlacesNearby({
          lat,
          lng,
          placeType: 'park',
          radiusM: 1600,
        }),
      ]);
      const merged = [...views, ...parks];
      const seen = new Set<string>();
      const ranked = merged
        .filter((h) => {
          const key = `${h.lat.toFixed(4)},${h.lng.toFixed(4)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((h) => ({
          hit: h,
          score: scoreSpot(lat, lng, h),
        }))
        .sort((a, b) => b.score - a.score);

      const spots: SunsetHorizonSpot[] = ranked.slice(0, 2).map((r) => ({
        name: r.hit.name.trim() || 'Aussichtspunkt',
        lat: r.hit.lat,
        lng: r.hit.lng,
        walkMin: walkMinutesForDistanceM(r.hit.distanceM),
        distanceM: Math.round(r.hit.distanceM),
      }));

      cache = {
        atMs: Date.now(),
        lat,
        lng,
        spots,
      };
      notify();
    } catch {
      /* soft */
    } finally {
      inFlight = null;
    }
  })();

  await inFlight;
  return getSunsetHorizonCache();
}

export function formatSunsetSpotMeta(spots: SunsetHorizonSpot[]): string {
  if (!spots.length) return '';
  return fitHudMeta(
    spots.map((s) => `${s.name} · ${s.walkMin} Min`).join('\n'),
  );
}
