/**
 * Live-HUD Nearby-Amenities — locker, nur wenn wirklich nah.
 * Toilette · Trinkwasser · Eis bei Hitze (kein Dauer-Spam).
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import { searchOpenPlacesAhead } from '../navigation/googleMapsNav';
import { walkMinutesForDistanceM } from '../navigation/travelEta';
import { getCachedWeatherSnapshot } from '../weatherService';
import { fitHudMeta } from './hudTextFit';
import { isActivitySuggestionWindow } from './nachtruhePolicy';

export type NearbyAmenityKind = 'toilet' | 'drinking_water' | 'ice_cream';

export type NearbyAmenityHit = {
  kind: NearbyAmenityKind;
  name: string;
  distanceM: number;
  walkMin: number;
};

export type NearbyAmenityHudCard = {
  id: string;
  kind: NearbyAmenityKind;
  title: string;
  meta: string;
  tellMorePrompt: string;
  /** 0–100 für Carousel-Priorität */
  score: number;
};

type Cache = {
  atMs: number;
  lat: number;
  lng: number;
  hits: NearbyAmenityHit[];
  cards: NearbyAmenityHudCard[];
};

const TTL_MS = 18 * 60_000;
const CELL_M = 160;
/** Nur zeigen wenn wirklich „um die Ecke“. */
const MAX_M: Record<NearbyAmenityKind, number> = {
  toilet: 420,
  drinking_water: 480,
  ice_cream: 900,
};

let cache: Cache | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function subscribeNearbyAmenityHud(listener: () => void): () => void {
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
  return `${(lat / (CELL_M / 111_000)).toFixed(0)},${(
    lng /
    (CELL_M / (111_000 * Math.cos((lat * Math.PI) / 180)))
  ).toFixed(0)}`;
}

function formatDist(m: number): string {
  if (m < 1000) return `${Math.max(40, Math.round(m / 20) * 20)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** Hitze aus Wetterzeile — kein Extra-API-Feld nötig. */
export function inferHotWeather(nowMs = Date.now()): boolean {
  const snap = getCachedWeatherSnapshot();
  const line = (snap?.summaryLine ?? '').toLowerCase();
  const h = new Date(nowMs).getHours();
  if (h < 10 || h > 20) return false;
  const m = line.match(/(\d{1,2})\s*grad/i);
  if (m) {
    const t = Number(m[1]);
    if (Number.isFinite(t) && t >= 26) return true;
  }
  if (/heiß|hitze|schwül|sehr warm|knackig warm/.test(line)) return true;
  if (/sonnig|klar/.test(line) && h >= 12 && h <= 17) {
    // sonnig mittags → weiche Hitze-Annahme nur wenn nicht „kühl“
    return !/kühl|kalt|frisch|windig kühl/.test(line);
  }
  return false;
}

function cardFor(hit: NearbyAmenityHit): NearbyAmenityHudCard {
  const dist = formatDist(hit.distanceM);
  const walk =
    hit.walkMin <= 1 ? '1 Min zu Fuß' : `${hit.walkMin} Min zu Fuß`;

  if (hit.kind === 'toilet') {
    return {
      id: `amenity-toilet-${Math.round(hit.distanceM)}`,
      kind: 'toilet',
      title: 'Klo in der Nähe?',
      meta: fitHudMeta(`${hit.name} · ${dist} · ${walk}`),
      tellMorePrompt:
        `Öffentliche Toilette „${hit.name}“ (~${dist}) — Route dahin und ob sie offen wirkt.`,
      score: hit.distanceM <= 180 ? 64 : hit.distanceM <= 320 ? 56 : 48,
    };
  }

  if (hit.kind === 'drinking_water') {
    return {
      id: `amenity-water-${Math.round(hit.distanceM)}`,
      kind: 'drinking_water',
      title: 'Trinkwasser um die Ecke?',
      meta: fitHudMeta(`${hit.name} · ${dist} · ${walk}`),
      tellMorePrompt:
        `Trinkwasser / Brunnen „${hit.name}“ (~${dist}) — Route und kurz sagen, wie ich hinfinde.`,
      score: hit.distanceM <= 200 ? 62 : hit.distanceM <= 350 ? 54 : 46,
    };
  }

  return {
    id: `amenity-ice-${Math.round(hit.distanceM)}`,
    kind: 'ice_cream',
    title: 'Heiß heute — Eis gefällig?',
    meta: fitHudMeta(`${hit.name} · ${dist} · ${walk}`),
    tellMorePrompt:
      `Nächste Eisdiele „${hit.name}“ (~${dist}) — kurz warum sie passt und Route-Button.`,
    score: hit.distanceM <= 400 ? 68 : hit.distanceM <= 700 ? 58 : 50,
  };
}

export function getNearbyAmenityHudCards(nowMs = Date.now()): NearbyAmenityHudCard[] {
  if (!isActivitySuggestionWindow(nowMs)) return [];
  if (!cache) return [];
  if (Date.now() - cache.atMs > TTL_MS) return [];
  return cache.cards;
}

async function searchKind(
  kind: NearbyAmenityKind,
  lat: number,
  lng: number,
): Promise<NearbyAmenityHit | null> {
  const radius = MAX_M[kind];
  const placeType =
    kind === 'ice_cream'
      ? 'ice_cream'
      : kind === 'drinking_water'
        ? 'drinking_water'
        : 'toilet';
  const openNow = kind === 'ice_cream' ? true : false;

  const hits = await searchOpenPlacesAhead({
    lat,
    lng,
    placeType,
    radiusM: radius,
    openNow,
  }).catch(() => []);

  const best = hits
    .filter((h) => h.distanceM <= radius)
    .sort((a, b) => a.distanceM - b.distanceM)[0];
  if (!best) return null;

  const name =
    (best.name ?? '').trim() ||
    (kind === 'toilet'
      ? 'Öffentliches WC'
      : kind === 'drinking_water'
        ? 'Trinkbrunnen'
        : 'Eisdiele');

  return {
    kind,
    name,
    distanceM: Math.round(best.distanceM),
    walkMin: walkMinutesForDistanceM(best.distanceM),
  };
}

export async function ensureNearbyAmenityHudFresh(opts?: {
  nowMs?: number;
  force?: boolean;
}): Promise<NearbyAmenityHudCard[]> {
  const nowMs = opts?.nowMs ?? Date.now();
  if (!isActivitySuggestionWindow(nowMs)) {
    return [];
  }

  const store = useFinnusStore.getState();
  const lat = store.lastGpsLat;
  const lng = store.lastGpsLng;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return getNearbyAmenityHudCards(nowMs);
  }

  const existing = cache;
  if (
    !opts?.force &&
    existing &&
    Date.now() - existing.atMs < TTL_MS &&
    cellKey(existing.lat, existing.lng) === cellKey(lat, lng)
  ) {
    return existing.cards;
  }

  if (inFlight) {
    await inFlight;
    return getNearbyAmenityHudCards(nowMs);
  }

  const wantIce = inferHotWeather(nowMs);

  inFlight = (async () => {
    try {
      const kinds: NearbyAmenityKind[] = ['toilet', 'drinking_water'];
      if (wantIce) kinds.push('ice_cream');

      const found = (
        await Promise.all(kinds.map((k) => searchKind(k, lat, lng)))
      ).filter((h): h is NearbyAmenityHit => h != null);

      const cards = found.map(cardFor).sort((a, b) => b.score - a.score);
      cache = {
        atMs: nowMs,
        lat,
        lng,
        hits: found,
        cards,
      };
      notify();
    } catch {
      /* soft */
    } finally {
      inFlight = null;
    }
  })();

  await inFlight;
  return getNearbyAmenityHudCards(nowMs);
}
