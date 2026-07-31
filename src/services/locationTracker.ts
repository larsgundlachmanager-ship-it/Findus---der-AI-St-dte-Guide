/**
 * Passive Dwell Tracking —
 * ≥10 Min → stilles Memory-Logging
 * ≥20 Min → Stempelkarte (OSM/POI-Punkt)
 */

import * as Location from 'expo-location';
import { getAllPois, haversineMeters } from '../db/database';
import type { Poi } from '../db/types';
import {
  useUserMemoryStore,
  type UserEntityType,
} from '../store/useUserMemoryStore';
import { useFinnusStore } from '../store/useFinnusStore';
import { parseTagsJson } from './geo/triggerPolicy';
import { getTrackSpeedMs } from './navigation/gpsTrackBuffer';

/** Unter dieser Geschwindigkeit gilt User als stehend (Explore Flow B). */
const STATIONARY_SPEED_MS = 0.45;
/** Mindest-Verweildauer bevor „stehend“ für Story gilt. */
const STATIONARY_MIN_DWELL_MS = 8_000;

/** Radius um den Dwell-Anker (Meter). */
export const DWELL_RADIUS_M = 20;
/** Mindest-Verweildauer bevor Memory geloggt wird. */
export const DWELL_MIN_MS = 10 * 60 * 1000;
/** Ab dieser Dauer → Stempelkarte (OpenStreetMap / POI). */
export const DWELL_STAMP_MS = 20 * 60 * 1000;
/** Wie oft höchstens ein Tick ausgewertet wird. */
const TICK_MIN_INTERVAL_MS = 15_000;
/** HUD: Ort erst anzeigen, wenn Nutzer 1 Minute am selben Ort bleibt. */
const HUD_SHOW_AFTER_MS = 60_000;

type DwellSession = {
  anchorLat: number;
  anchorLng: number;
  startedAtMs: number;
  lastSeenAtMs: number;
  logged: boolean;
  stamped: boolean;
  poiId?: number;
  nameHint?: string;
  /** Ensure we only write HUD location once per dwell session. */
  hudShown: boolean;
};

let session: DwellSession | null = null;
let lastTickAt = 0;

function classifyPoi(poi: Poi): UserEntityType {
  const tags = parseTagsJson(poi.tags_json).map((t) => t.toLowerCase());
  const blob = `${poi.name} ${poi.category ?? ''} ${tags.join(' ')}`.toLowerCase();
  if (/(hotel|pension|unterkunft|hostel|apartment|ferienwohnung)/i.test(blob)) {
    return 'hotel';
  }
  if (
    /(restaurant|gastro|essen|café|cafe|bäckerei|baeckerei|imbiss|burger|pizzeria|bar|kneipe)/i.test(
      blob,
    )
  ) {
    return 'restaurant';
  }
  if (/(bahnhof|haltepunkt|bus|fähre|faehre|hafen|gleis|transit)/i.test(blob)) {
    return 'transit';
  }
  if (poi.kind === 'area' || poi.kind === 'sub' || poi.kind === 'legacy') {
    return 'attraction';
  }
  return 'custom';
}

async function nearestPoiWithin(
  lat: number,
  lng: number,
  maxM: number,
): Promise<{ poi: Poi; distanceM: number } | null> {
  const pois = await getAllPois();
  let best: { poi: Poi; distanceM: number } | null = null;
  for (const poi of pois) {
    if (poi.kind === 'approach') continue;
    const d = haversineMeters(lat, lng, poi.lat, poi.lng);
    if (d > maxM) continue;
    if (!best || d < best.distanceM) best = { poi, distanceM: d };
  }
  return best;
}

async function reverseNameHint(
  lat: number,
  lng: number,
): Promise<string | null> {
  try {
    const places = await Location.reverseGeocodeAsync({
      latitude: lat,
      longitude: lng,
    });
    const p = places[0];
    if (!p) return null;
    const name =
      p.name?.trim() ||
      p.street?.trim() ||
      p.district?.trim() ||
      p.city?.trim() ||
      null;
    if (!name) return null;
    // Keine reinen Hausnummern / PLZ als Entity-Name
    if (/^\d{4,5}$/.test(name) || /^\d+\s*$/.test(name)) return null;
    return name;
  } catch {
    return null;
  }
}

function resetSession(): void {
  session = null;
}

/**
 * Jeden GPS-Fix aufrufen (auch während Audio — Memory läuft still).
 */
export async function tickDwellTracking(
  lat: number,
  lng: number,
  nowMs: number = Date.now(),
): Promise<void> {
  if (nowMs - lastTickAt < TICK_MIN_INTERVAL_MS) return;
  lastTickAt = nowMs;

  if (!session) {
    const near = await nearestPoiWithin(lat, lng, DWELL_RADIUS_M * 1.5);
    session = {
      anchorLat: near?.poi.lat ?? lat,
      anchorLng: near?.poi.lng ?? lng,
      startedAtMs: nowMs,
      lastSeenAtMs: nowMs,
      logged: false,
      stamped: false,
      poiId: near?.poi.id,
      nameHint: near?.poi.name,
      hudShown: false,
    };
    return;
  }

  const dist = haversineMeters(
    lat,
    lng,
    session.anchorLat,
    session.anchorLng,
  );

  if (dist > DWELL_RADIUS_M) {
    // User left the stable radius — do not keep showing the old place name.
    useFinnusStore.getState().setCurrentLocationName(null);

    // Session beenden; ggf. vorher flushen / stempeln
    const elapsed = session.lastSeenAtMs - session.startedAtMs;
    if (!session.logged && elapsed >= DWELL_MIN_MS) {
      await flushDwellSession(session);
    }
    if (!session.stamped && elapsed >= DWELL_STAMP_MS) {
      await stampDwellOnPassport(session);
    }
    resetSession();
    // Sofort neue Session am neuen Ort starten
    const near = await nearestPoiWithin(lat, lng, DWELL_RADIUS_M * 1.5);
    session = {
      anchorLat: near?.poi.lat ?? lat,
      anchorLng: near?.poi.lng ?? lng,
      startedAtMs: nowMs,
      lastSeenAtMs: nowMs,
      logged: false,
      stamped: false,
      poiId: near?.poi.id,
      nameHint: near?.poi.name,
      hudShown: false,
    };
    return;
  }

  session.lastSeenAtMs = nowMs;
  const dwellMs = session.lastSeenAtMs - session.startedAtMs;
  if (!session.logged && dwellMs >= DWELL_MIN_MS) {
    await flushDwellSession(session);
    session.logged = true;
  }
  if (!session.stamped && dwellMs >= DWELL_STAMP_MS) {
    await stampDwellOnPassport(session);
    session.stamped = true;
  }

  if (!session.hudShown && dwellMs >= HUD_SHOW_AFTER_MS) {
    session.hudShown = true;

    // Prefer the cached POI name (fast + stable). If unavailable, fall back
    // to reverse geocode once.
    const fromHint = session.nameHint?.trim() ?? '';
    const place =
      fromHint ||
      (await reverseNameHint(session.anchorLat, session.anchorLng)) ||
      `Ort bei ${session.anchorLat.toFixed(4)}, ${session.anchorLng.toFixed(4)}`;

    useFinnusStore.getState().setCurrentLocationName(place);
  }
}

async function flushDwellSession(s: DwellSession): Promise<void> {
  const dwellMin = Math.max(
    10,
    Math.round((s.lastSeenAtMs - s.startedAtMs) / 60_000),
  );

  let name = s.nameHint?.trim() || '';
  let type: UserEntityType = 'custom';
  let poiId = s.poiId;

  if (poiId != null) {
    const pois = await getAllPois();
    const poi = pois.find((p) => p.id === poiId);
    if (poi) {
      name = poi.name;
      type = classifyPoi(poi);
    }
  }

  if (!name) {
    const near = await nearestPoiWithin(s.anchorLat, s.anchorLng, 40);
    if (near) {
      name = near.poi.name;
      type = classifyPoi(near.poi);
      poiId = near.poi.id;
    }
  }

  if (!name) {
    name = (await reverseNameHint(s.anchorLat, s.anchorLng)) ?? '';
  }

  if (!name) {
    name = `Ort bei ${s.anchorLat.toFixed(4)}, ${s.anchorLng.toFixed(4)}`;
    type = 'custom';
  }

  // Hotels nur als Kandidat, wenn nicht schon bestätigt — User soll bestätigen
  const isConfirmed = type !== 'hotel';

  useUserMemoryStore.getState().addOrUpdateEntity({
    type,
    name,
    isConfirmed,
    lat: s.anchorLat,
    lng: s.anchorLng,
    poiId,
    dwellTimeMinutes: dwellMin,
    visitedAt: new Date(s.startedAtMs).toISOString(),
  });

  if (__DEV__) {
    console.log(
      `[dwell] logged ${type} "${name}" ${dwellMin}min confirmed=${isConfirmed}`,
    );
  }
}

/** ≥20 Min Verweilen → Stempelkarte nur mit klarem Ort ≤30 m. */
async function stampDwellOnPassport(s: DwellSession): Promise<void> {
  let name = s.nameHint?.trim() || '';
  let poiId = s.poiId ?? null;

  if (poiId != null) {
    const pois = await getAllPois();
    const poi = pois.find((p) => p.id === poiId);
    if (poi) {
      const d = haversineMeters(s.anchorLat, s.anchorLng, poi.lat, poi.lng);
      if (d <= 30) name = poi.name;
      else {
        name = '';
        poiId = null;
      }
    }
  }
  if (!name) {
    const near = await nearestPoiWithin(s.anchorLat, s.anchorLng, 30);
    if (near) {
      name = near.poi.name;
      poiId = near.poi.id;
    }
  }

  // Kein klarer Ort im 30-m-Umkreis → nicht in Planung / Stempel
  if (!name || !poiId) {
    if (__DEV__) {
      console.log(
        `[dwell] skip stamp — kein Ort ≤30 m (${s.anchorLat.toFixed(5)}, ${s.anchorLng.toFixed(5)})`,
      );
    }
    return;
  }

  const store = useFinnusStore.getState();
  const already = store.visitedHistory.some(
    (v) =>
      (poiId != null && v.poiId === poiId) ||
      (v.name.toLowerCase() === name.toLowerCase() &&
        Math.abs(v.visitedAt - s.startedAtMs) < 6 * 60 * 60_000),
  );
  if (already) return;

  const stampId = poiId;

  store.addVisitedPlace({
    poiId: stampId,
    name,
    kind: 'historic',
    keyFacts: [
      `Verweilt ${Math.round((s.lastSeenAtMs - s.startedAtMs) / 60_000)} Min`,
      `${s.anchorLat.toFixed(5)}, ${s.anchorLng.toFixed(5)}`,
    ],
    visitedAt: s.startedAtMs,
  });

  try {
    const { upsertVisitFromStamp } = require('./timeline/visitLog') as {
      upsertVisitFromStamp: (o: {
        name: string;
        lat?: number | null;
        lng?: number | null;
        poiId?: number | null;
        arrivedAtMs: number;
        dwellMin?: number | null;
        source?: 'dwell' | 'stamp';
      }) => unknown;
    };
    upsertVisitFromStamp({
      name,
      lat: s.anchorLat,
      lng: s.anchorLng,
      poiId: stampId,
      arrivedAtMs: s.startedAtMs,
      dwellMin: Math.round((s.lastSeenAtMs - s.startedAtMs) / 60_000),
      source: 'dwell',
    });
  } catch {
    /* soft */
  }

  try {
    const { noteModule1PlaceOnAxis } = require('./module5/unifiedDayAxis') as {
      noteModule1PlaceOnAxis: (o: {
        name: string;
        lat?: number;
        lng?: number;
        poiId?: number;
        atMs?: number;
        dwellMin?: number;
        source?: 'dwell';
      }) => void;
    };
    noteModule1PlaceOnAxis({
      name,
      lat: s.anchorLat,
      lng: s.anchorLng,
      poiId: stampId,
      atMs: s.startedAtMs,
      dwellMin: Math.round((s.lastSeenAtMs - s.startedAtMs) / 60_000),
      source: 'dwell',
    });
  } catch {
    /* soft */
  }

  if (__DEV__) {
    console.log(`[dwell] stamp passport "${name}" id=${stampId}`);
  }
}

/** Für Tests / Simulation: Session zurücksetzen */
export function resetDwellTracking(): void {
  resetSession();
  lastTickAt = 0;
}

/**
 * User steht still genug → Modul 1 darf volle Story ohne Teaser starten.
 */
export function isUserStationaryForExplore(nowMs: number = Date.now()): boolean {
  if (!session) return false;
  const dwellMs = Math.min(
    nowMs - session.startedAtMs,
    session.lastSeenAtMs - session.startedAtMs,
  );
  if (dwellMs < STATIONARY_MIN_DWELL_MS) return false;
  const speed = getTrackSpeedMs();
  if (speed != null && speed > STATIONARY_SPEED_MS) return false;
  return true;
}
