/**
 * Live-HUD Nearby-Amenities — locker, nur wenn wirklich nah.
 * Toilette · Trinkwasser · Eis · Museum · Supermarkt · Erholung (Park) · Fotospot.
 * Keine Kategorie-Fragen ohne Treffer („Pause / Park?“).
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import { searchOpenPlacesAhead } from '../navigation/googleMapsNav';
import { walkMinutesForDistanceM } from '../navigation/travelEta';
import { getCachedWeatherSnapshot } from '../weatherService';
import { fitHudMeta } from './hudTextFit';
import {
  buildParkRestHudCard as pitchPark,
  buildPhotoSpotHudCard as pitchPhoto,
  isVagueRestOrPhotoName,
} from './liveHudAmenityPitch';
import { isActivitySuggestionWindow } from './nachtruhePolicy';

export type NearbyAmenityKind =
  | 'toilet'
  | 'drinking_water'
  | 'ice_cream'
  | 'museum'
  | 'supermarket'
  | 'park_rest'
  | 'photo_spot';

export type NearbyAmenityHit = {
  kind: NearbyAmenityKind;
  name: string;
  distanceM: number;
  walkMin: number;
  lat?: number;
  lng?: number;
};

export type NearbyAmenityHudCard = {
  id: string;
  kind: NearbyAmenityKind;
  title: string;
  meta: string;
  tellMorePrompt: string;
  /** 0–100 für Carousel-Priorität */
  score: number;
  navDest?: { name: string; lat: number; lng: number };
};

type Cache = {
  atMs: number;
  lat: number;
  lng: number;
  hits: NearbyAmenityHit[];
  cards: NearbyAmenityHudCard[];
};

const TTL_MS = 5 * 60_000;
const CELL_M = 160;
/** Nur zeigen wenn wirklich „um die Ecke“. */
const MAX_M: Record<NearbyAmenityKind, number> = {
  toilet: 420,
  drinking_water: 480,
  ice_cream: 900,
  museum: 1600,
  supermarket: 1200,
  park_rest: 900,
  photo_spot: 1100,
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
    return !/kühl|kalt|frisch|windig kühl/.test(line);
  }
  return false;
}

/** Re-export für Aufrufer / Tests. */
export {
  buildParkRestHudCard,
  buildPhotoSpotHudCard,
} from './liveHudAmenityPitch';

function wrapPitch(
  pitch: ReturnType<typeof pitchPark>,
  kind: 'park_rest' | 'photo_spot',
): NearbyAmenityHudCard {
  return {
    id: pitch.id,
    kind,
    title: pitch.title,
    meta: fitHudMeta(pitch.meta),
    tellMorePrompt: pitch.tellMorePrompt,
    score: pitch.score,
    navDest: pitch.navDest,
  };
}

function cardFor(hit: NearbyAmenityHit): NearbyAmenityHudCard {
  const dist = formatDist(hit.distanceM);
  const walk =
    hit.walkMin <= 1 ? '1 Min zu Fuß' : `${hit.walkMin} Min zu Fuß`;

  if (hit.kind === 'toilet') {
    return {
      id: `amenity-toilet-${Math.round(hit.distanceM)}`,
      kind: 'toilet',
      title: `🚻 ${hit.name}`,
      meta: fitHudMeta(`${dist} · ${walk}`),
      tellMorePrompt:
        `Öffentliche Toilette „${hit.name}“ (~${dist}) — Route dahin und ob sie offen wirkt.`,
      score: hit.distanceM <= 180 ? 64 : hit.distanceM <= 320 ? 56 : 48,
    };
  }

  if (hit.kind === 'drinking_water') {
    return {
      id: `amenity-water-${Math.round(hit.distanceM)}`,
      kind: 'drinking_water',
      title: `💧 ${hit.name}`,
      meta: fitHudMeta(`${dist} · ${walk}`),
      tellMorePrompt:
        `Trinkwasser / Brunnen „${hit.name}“ (~${dist}) — Route und kurz sagen, wie ich hinfinde.`,
      score: hit.distanceM <= 200 ? 62 : hit.distanceM <= 350 ? 54 : 46,
    };
  }

  if (hit.kind === 'museum') {
    return {
      id: `amenity-museum-${Math.round(hit.distanceM)}`,
      kind: 'museum',
      title: `🏛 ${hit.name}`,
      meta: fitHudMeta(`${dist} · ${walk} — passt zu dir`),
      tellMorePrompt:
        `Museum „${hit.name}“ (~${dist}): kurzer Pitch warum es sich lohnt, Eintritt nur wenn belegt, Route und optional Ticket.`,
      score: hit.distanceM <= 500 ? 72 : hit.distanceM <= 1000 ? 64 : 55,
      navDest: navFromHit(hit),
    };
  }

  if (hit.kind === 'supermarket') {
    return {
      id: `amenity-market-${Math.round(hit.distanceM)}`,
      kind: 'supermarket',
      title: 'Noch schnell was besorgen?',
      meta: fitHudMeta(`${hit.name} · ${dist}`),
      tellMorePrompt:
        `Nächster Supermarkt „${hit.name}“ (~${dist}) — Route starten, kurz ob noch offen.`,
      score: hit.distanceM <= 400 ? 74 : hit.distanceM <= 800 ? 66 : 58,
      navDest: navFromHit(hit),
    };
  }

  if (hit.kind === 'park_rest') {
    return wrapPitch(pitchPark(hit), 'park_rest');
  }

  if (hit.kind === 'photo_spot') {
    return wrapPitch(pitchPhoto(hit), 'photo_spot');
  }

  return {
    id: `amenity-ice-${Math.round(hit.distanceM)}`,
    kind: 'ice_cream',
    title: `🍦 ${hit.name}`,
    meta: fitHudMeta(`${dist} · ${walk}`),
    tellMorePrompt:
      `Nächste Eisdiele „${hit.name}“ (~${dist}) — kurz warum sie passt und Route-Button.`,
    score: hit.distanceM <= 400 ? 68 : hit.distanceM <= 700 ? 58 : 50,
    navDest: navFromHit(hit),
  };
}

function navFromHit(
  hit: NearbyAmenityHit,
): { name: string; lat: number; lng: number } | undefined {
  if (
    hit.lat == null ||
    hit.lng == null ||
    !Number.isFinite(hit.lat) ||
    !Number.isFinite(hit.lng)
  ) {
    return undefined;
  }
  return { name: hit.name, lat: hit.lat, lng: hit.lng };
}

/** Gattungs-/Platzhalter-Namen — kein HUD-Pitch. */
function isVagueAmenityName(name: string, kind: NearbyAmenityKind): boolean {
  if (kind === 'park_rest' || kind === 'photo_spot') {
    return isVagueRestOrPhotoName(name, kind);
  }
  return false;
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
        : kind === 'museum'
          ? 'museum'
          : kind === 'supermarket'
            ? 'supermarket'
            : kind === 'park_rest'
              ? 'park'
              : kind === 'photo_spot'
                ? 'tourist_attraction'
                : 'toilet';
  const openNow =
    kind === 'ice_cream' ||
    kind === 'museum' ||
    kind === 'supermarket'
      ? true
      : false;

  const keyword =
    kind === 'photo_spot'
      ? 'Aussichtspunkt OR viewpoint OR Aussicht'
      : undefined;

  const hits = await searchOpenPlacesAhead({
    lat,
    lng,
    placeType,
    radiusM: radius,
    openNow,
    ...(keyword ? { keyword } : {}),
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
        : kind === 'museum'
          ? 'Museum'
          : kind === 'supermarket'
            ? 'Supermarkt'
            : kind === 'park_rest'
              ? 'Park'
              : kind === 'photo_spot'
                ? 'Aussicht'
                : 'Eisdiele');

  if (isVagueAmenityName(name, kind)) return null;

  return {
    kind,
    name,
    distanceM: Math.round(best.distanceM),
    walkMin: walkMinutesForDistanceM(best.distanceM),
    lat: best.lat,
    lng: best.lng,
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
  const hour = new Date(nowMs).getHours();

  inFlight = (async () => {
    try {
      const kinds: NearbyAmenityKind[] = ['toilet', 'drinking_water'];
      if (wantIce) kinds.push('ice_cream');
      // Ab Nachmittag: konkreter Supermarkt-Pitch statt leerem „Supermarkt“
      if (hour >= 16 && hour <= 21) kinds.push('supermarket');
      // Erholung / Blick — nur suchen; ohne Treffer keine Karte (z. B. Priesterweg)
      if (hour >= 9 && hour <= 20) {
        kinds.push('park_rest');
        kinds.push('photo_spot');
      }
      try {
        const { getCachedUserProfile } = require('../userProfileService') as {
          getCachedUserProfile: () => {
            experiencePrefs?: Record<string, string>;
            wantToExperience?: string;
          } | null;
        };
        const profile = getCachedUserProfile();
        const want = (profile?.wantToExperience ?? '').toLowerCase();
        const prefs = profile?.experiencePrefs ?? {};
        if (prefs.museen === 'yes' || /museum|kunst|dinosaur/.test(want)) {
          kinds.push('museum');
        }
        // Natur explizit „nein“ → keinen Park-Pitch erzwingen
        if (prefs.natur === 'no') {
          const i = kinds.indexOf('park_rest');
          if (i >= 0) kinds.splice(i, 1);
        }
      } catch {
        /* soft */
      }

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
