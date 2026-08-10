/**
 * GPS Dwell Tracking:
 * - >=2 Min am Ort (klarer POI) -> Stempelkarte + Zeitachse
 * - Vorbeilaufen / <2 Min -> kein Eintrag
 * - Ausnahme: Modul 1 startet -> sofort (narrationPipeline)
 * - >=10 Min -> zusaetzliches stilles Memory-Logging
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
/** Mindest-Verweildauer bevor ?stehend? f?r Story gilt. */
const STATIONARY_MIN_DWELL_MS = 8_000;

/** Radius um den Dwell-Anker (Meter). */
export const DWELL_RADIUS_M = 20;
/** Mindest-Verweildauer bevor Memory geloggt wird. */
export const DWELL_MIN_MS = 10 * 60 * 1000;
/**
 * Stempelkarte + Zeitachse: mindestens 2 Minuten am Ort.
 * K?rzer (z. B. 1:30) ? kein Eintrag (au?er Modul 1).
 */
export const DWELL_TIMELINE_MS = 2 * 60 * 1000;
/** Gleicher Gate wie Zeitachse. */
export const DWELL_STAMP_MS = DWELL_TIMELINE_MS;
/** Wie oft h?chstens ein Tick ausgewertet wird. */
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
  /** ?2 Min ? Zeitachse */
  onTimeline: boolean;
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
    /(restaurant|gastro|essen|caf?|cafe|b?ckerei|baeckerei|imbiss|burger|pizzeria|bar|kneipe)/i.test(
      blob,
    )
  ) {
    return 'restaurant';
  }
  if (/(bahnhof|haltepunkt|bus|f?hre|faehre|hafen|gleis|transit)/i.test(blob)) {
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
    const street = p.street?.trim();
    const streetNr = (p as { streetNumber?: string }).streetNumber?.trim();
    if (street) {
      const { formatStreetPin, simplifyPlaceName } = await import(
        './timeline/placeLabelClean'
      );
      // Benannter Ort (nicht nur Straße) bevorzugen
      const named = p.name?.trim();
      if (
        named &&
        named.toLowerCase() !== street.toLowerCase() &&
        !/^\d/.test(named) &&
        named.length > 2
      ) {
        return simplifyPlaceName(named) || named;
      }
      return formatStreetPin(street, streetNr);
    }
    const name = p.name?.trim() || p.district?.trim() || null;
    if (!name) return null;
    if (/^\d{4,5}$/.test(name) || /^\d+\s*$/.test(name)) return null;
    const { simplifyPlaceName } = await import('./timeline/placeLabelClean');
    return simplifyPlaceName(name) || name;
  } catch {
    return null;
  }
}

function resetSession(): void {
  session = null;
}

/**
 * Jeden GPS-Fix aufrufen (auch w?hrend Audio ? Memory l?uft still).
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
      onTimeline: false,
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
    // User left the stable radius ? do not keep showing the old place name.
    useFinnusStore.getState().setCurrentLocationName(null);

    // Session beenden; ggf. vorher flushen / Zeitachse / stempeln
    const elapsed = session.lastSeenAtMs - session.startedAtMs;
    if (!session.logged && elapsed >= DWELL_MIN_MS) {
      await flushDwellSession(session);
    }
    if (
      (!session.onTimeline || !session.stamped) &&
      elapsed >= DWELL_TIMELINE_MS
    ) {
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
      onTimeline: false,
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
  // Ein Gate: ?2 Min ? Zeitachse + Stempelkarte (stamp ruft Zeitachse mit)
  if (
    (!session.onTimeline || !session.stamped) &&
    dwellMs >= DWELL_TIMELINE_MS
  ) {
    await stampDwellOnPassport(session);
    session.onTimeline = true;
    session.stamped = true;
  }

  if (!session.hudShown && dwellMs >= HUD_SHOW_AFTER_MS) {
    session.hudShown = true;

    // Prefer cached POI; sonst OSM→Google→📍 Straße+Nr. (nie „Gegend“)
    let place = session.nameHint?.trim() ?? '';
    if (!place) {
      try {
        const { resolveDwellPlace } = await import('./timeline/resolveDwellPlace');
        const hit = await resolveDwellPlace(
          session.anchorLat,
          session.anchorLng,
        );
        place = hit.title;
      } catch {
        place =
          (await reverseNameHint(session.anchorLat, session.anchorLng)) ?? '';
      }
    }
    if (place) {
      useFinnusStore.getState().setCurrentLocationName(place);
    }
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
    name = 'Unbenannter Ort';
    type = 'custom';
  }

  // Hotels nur als Kandidat, wenn nicht schon best?tigt ? User soll best?tigen
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

/** ≥2 Min Verweilen → Zeitachse (Pack/OSM → Google → 📍 Straße+Nr.). */
async function putDwellOnZeitachse(s: DwellSession): Promise<void> {
  const dwellMin = Math.max(
    2,
    Math.round((s.lastSeenAtMs - s.startedAtMs) / 60_000),
  );

  let hit: {
    title: string;
    confidence: number;
    via: string;
    poiId?: number | null;
  } | null = null;

  try {
    const { resolveDwellPlace } = await import('./timeline/resolveDwellPlace');
    hit = await resolveDwellPlace(s.anchorLat, s.anchorLng);
  } catch {
    hit = null;
  }

  // Pack-Hint nur wenn Resolve nichts Besseres fand
  if (
    hit == null ||
    hit.via === 'address' ||
    /^📍/.test(hit.title)
  ) {
    let poiId = s.poiId ?? null;
    let name = s.nameHint?.trim() || '';
    if (poiId != null) {
      const pois = await getAllPois();
      const poi = pois.find((p) => p.id === poiId);
      if (poi) {
        const d = haversineMeters(s.anchorLat, s.anchorLng, poi.lat, poi.lng);
        if (d <= 30) {
          name = poi.name;
        } else {
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
    if (name) {
      const { simplifyPlaceName } = await import('./timeline/placeLabelClean');
      hit = {
        title: simplifyPlaceName(name) || name,
        confidence: 0.95,
        via: 'pack',
        poiId,
      };
    }
  }

  if (!hit?.title) return;

  try {
    const { recordDwellVisit } = await import('./timeline/recordDwellVisit');
    recordDwellVisit({
      hit: {
        title: hit.title,
        confidence: hit.confidence,
        via: (hit.via as 'pack' | 'osm' | 'google' | 'address') || 'address',
        poiId: hit.poiId ?? null,
      },
      lat: s.anchorLat,
      lng: s.anchorLng,
      arrivedAtMs: s.startedAtMs,
      dwellMin,
    });
  } catch {
    /* soft */
  }

  const poiId = hit.poiId ?? null;
  if (poiId == null) {
    if (__DEV__) {
      console.log(`[dwell] zeitachse address-only "${hit.title}" ${dwellMin}min`);
    }
    return;
  }

  const name = hit.title;
  const store = useFinnusStore.getState();
  const existing = store.visitedHistory.find(
    (v) =>
      v.poiId === poiId ||
      (v.name.toLowerCase() === name.toLowerCase() &&
        Math.abs(v.visitedAt - s.startedAtMs) < 6 * 60 * 60_000),
  );
  if (!existing) {
    store.addVisitedPlace({
      poiId,
      name,
      kind: 'historic',
      keyFacts: [`Verweilt ${dwellMin} Min`],
      visitedAt: s.startedAtMs,
      onTimeline: true,
      lat: s.anchorLat,
      lng: s.anchorLng,
    });
  } else if (existing.onTimeline !== true) {
    store.addVisitedPlace({
      ...existing,
      keyFacts: [
        `Verweilt ${dwellMin} Min`,
        ...existing.keyFacts.filter((f) => !/per\s+gps/i.test(f)),
      ].slice(0, 4),
      onTimeline: true,
      lat: existing.lat ?? s.anchorLat,
      lng: existing.lng ?? s.anchorLng,
    });
  }

  if (__DEV__) {
    console.log(`[dwell] zeitachse "${name}" ${dwellMin}min`);
  }
}

/** ?2 Min Verweilen ? Stempelkarte nur mit klarem Ort ?30 m. */
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

  // Zeitachse immer (auch Stra?e+Nr. ohne Pack-POI)
  if (!s.onTimeline) {
    await putDwellOnZeitachse(s);
  }

  // Stempelkarte nur mit klarem Pack-POI ?30 m
  if (!name || !poiId) {
    if (__DEV__) {
      console.log(
        `[dwell] skip passport stamp ? kein Pack-POI ?30 m (${s.anchorLat.toFixed(5)}, ${s.anchorLng.toFixed(5)})`,
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

  store.addVisitedPlace({
    poiId,
    name,
    kind: 'historic',
    keyFacts: [
      `Verweilt ${Math.round((s.lastSeenAtMs - s.startedAtMs) / 60_000)} Min`,
    ],
    visitedAt: s.startedAtMs,
    onTimeline: true,
    lat: s.anchorLat,
    lng: s.anchorLng,
  });

  if (__DEV__) {
    console.log(`[dwell] stamp passport "${name}" id=${poiId}`);
  }
}

/** F?r Tests / Simulation: Session zur?cksetzen */
export function resetDwellTracking(): void {
  resetSession();
  lastTickAt = 0;
}

/**
 * User steht still genug ? Modul 1 darf volle Story ohne Teaser starten.
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
