/**
 * Passive Dwell Tracking — >10 Min in 20-m-Radius → stilles Memory-Logging.
 */

import * as Location from 'expo-location';
import { getAllPois, haversineMeters } from '../db/database';
import type { Poi } from '../db/types';
import {
  useUserMemoryStore,
  type UserEntityType,
} from '../store/useUserMemoryStore';
import { parseTagsJson } from './geo/triggerPolicy';

/** Radius um den Dwell-Anker (Meter). */
export const DWELL_RADIUS_M = 20;
/** Mindest-Verweildauer bevor geloggt wird. */
export const DWELL_MIN_MS = 10 * 60 * 1000;
/** Wie oft höchstens ein Tick ausgewertet wird. */
const TICK_MIN_INTERVAL_MS = 15_000;

type DwellSession = {
  anchorLat: number;
  anchorLng: number;
  startedAtMs: number;
  lastSeenAtMs: number;
  logged: boolean;
  poiId?: number;
  nameHint?: string;
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
      poiId: near?.poi.id,
      nameHint: near?.poi.name,
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
    // Session beenden; ggf. vorher flushen wenn schon lang genug
    if (
      !session.logged &&
      session.lastSeenAtMs - session.startedAtMs >= DWELL_MIN_MS
    ) {
      await flushDwellSession(session);
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
      poiId: near?.poi.id,
      nameHint: near?.poi.name,
    };
    return;
  }

  session.lastSeenAtMs = nowMs;
  const dwellMs = session.lastSeenAtMs - session.startedAtMs;
  if (!session.logged && dwellMs >= DWELL_MIN_MS) {
    await flushDwellSession(session);
    session.logged = true;
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

/** Für Tests / Simulation: Session zurücksetzen */
export function resetDwellTracking(): void {
  resetSession();
  lastTickAt = 0;
}
