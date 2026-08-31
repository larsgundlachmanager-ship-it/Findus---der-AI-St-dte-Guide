/**
 * Standort-basierte Transport-Erkennung: Fähre vs. Bahn.
 * Nutzt GPS + POI-Nähe, damit „Wann fährt die nächste?“ am Anleger
 * nicht fälschlich RB61-Daten liefert.
 */

import { getAllPois, haversineMeters } from '../../db/database';
import type { Poi } from '../../db/types';
import { parseTagsJson } from '../geo/triggerPolicy';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import { env } from '../../config/env';

const NEAR_TRANSPORT_M = 1_500;

const AMBIGUOUS_SCHEDULE =
  /\b(wann\s+fährt|wann\s+faehrt|nächste\s+abfahrt|naechste\s+abfahrt|nächste\s+fahrt|naechste\s+fahrt|abfahrt|fahrplan|wann\s+geht|verspät|verspaet)\b/iu;

const RAIL_HINT =
  /\b(bahn|zug|bus|s-bahn|sbahn|regionalbahn|rb\d+|re\d+|ice|ec|ic|inselbahn)\b/iu;

const FERRY_HINT =
  /fähr(?:e|anleger|hafen|ticket)|faehr(?:e|anleger|hafen|ticket)|ferry|harlesiel|watt\s*sprinter|insel\s*fähre|überfahrt|ueberfahrt/iu;

export function scoreFerryPoi(poi: Poi): number {
  if (poi.kind === 'approach') return -1;
  const name = poi.name.toLowerCase();
  const tags = parseTagsJson(poi.tags_json).join(' ').toLowerCase();
  const cat = (poi.category ?? '').toLowerCase();
  const blob = `${name} ${cat} ${tags}`;
  let score = 0;
  if (/\bfähr|faehr|ferry\b/.test(name)) score += 70;
  if (/\banleger\b/.test(name)) score += 55;
  if (/\bhafen\b/.test(name) && /\b(fähr|faehr|anleger)\b/.test(blob)) score += 50;
  if (/\b(faehre|fähre|ferry|hafen|anleger|harlesiel)\b/.test(tags)) score += 40;
  if (cat === 'hafen' || cat === 'transport') score += 15;
  if (/\binselbahn\b/.test(blob) && !/\b(fähr|faehr|anleger)\b/.test(blob)) {
    score -= 35;
  }
  if (/\bbahnhof\b/.test(name) && !/\b(fähr|faehr|anleger)\b/.test(blob)) {
    score -= 25;
  }
  return score;
}

export function scoreStationPoi(poi: Poi): number {
  if (poi.kind === 'approach') return -1;
  const name = poi.name.toLowerCase();
  const tags = parseTagsJson(poi.tags_json).join(' ').toLowerCase();
  const cat = (poi.category ?? '').toLowerCase();
  const blob = `${name} ${cat} ${tags}`;

  // Fähranleger fälschlich als „bahnhof“ getaggt → rausfiltern
  if (/\b(anleger|fähr|faehr|fährhafen|hafen|harlesiel)\b/.test(blob)) {
    return -1;
  }
  if (/\b(ehemaliger|ehemalige)\b/.test(name) && /\banleger\b/.test(name)) {
    return -1;
  }

  let score = 0;
  if (/\bbahnhof\b/.test(name)) score += 50;
  if (/\bhaltepunkt\b/.test(name)) score += 40;
  if (cat === 'bahnhof' || cat === 'station') score += 35;
  if (/\b(bahnhof|haltepunkt|station|oepnv|transit|inselbahn)\b/.test(blob)) {
    score += 20;
  }
  if (poi.kind === 'area' || poi.kind === 'legacy') score += 8;
  if (/praxis|zahnarzt|arzt|straße|strasse/i.test(name) && !/\bbahnhof\b/.test(name)) {
    score -= 40;
  }
  return score;
}

function userCoords(): { lat: number; lng: number } | null {
  const { lastGpsLat: lat, lastGpsLng: lng } = useFinnusStore.getState();
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function cityId(): string {
  return (
    getCachedUserProfile()?.cityId ||
    env.cityId?.() ||
    'prisdorf'
  )
    .toString()
    .trim()
    .toLowerCase();
}

function pickBestPoi(
  pois: Poi[],
  scorer: (poi: Poi) => number,
  minScore: number,
): Poi | null {
  const coords = userCoords();
  let best: Poi | null = null;
  let bestRank = -Infinity;

  for (const poi of pois) {
    const base = scorer(poi);
    if (base < minScore) continue;

    let rank = base;
    if (coords) {
      const dist = haversineMeters(coords.lat, coords.lng, poi.lat, poi.lng);
      // Nähe stark gewichten — der nächste relevante Halt gewinnt
      rank += Math.max(0, 120 - dist / 25);
      if (dist > 8_000) rank -= 30;
    }

    if (rank > bestRank) {
      bestRank = rank;
      best = poi;
    }
  }

  return best;
}

export async function findNearestFerryPoi(): Promise<Poi | null> {
  const pois = await getAllPois();
  return pickBestPoi(pois, scoreFerryPoi, 30);
}

export async function findNearestStationPoi(): Promise<Poi | null> {
  const pois = await getAllPois();
  return pickBestPoi(pois, scoreStationPoi, 30);
}

export function distanceToPoiM(poi: Poi | null): number | null {
  if (!poi) return null;
  const coords = userCoords();
  if (!coords) return null;
  return haversineMeters(coords.lat, coords.lng, poi.lat, poi.lng);
}

export function isAmbiguousScheduleQuery(text: string): boolean {
  const t = text.trim();
  if (!AMBIGUOUS_SCHEDULE.test(t)) return false;
  if (RAIL_HINT.test(t) || FERRY_HINT.test(t)) return false;
  return true;
}

/**
 * Leitet aus GPS + Query ab, ob Fähre oder Schiene gemeint ist.
 */
export async function inferScheduleMode(
  text: string,
): Promise<'ferry' | 'rail'> {
  const t = text.trim();
  if (FERRY_HINT.test(t)) return 'ferry';
  if (RAIL_HINT.test(t)) return 'rail';

  const ferry = await findNearestFerryPoi();
  const station = await findNearestStationPoi();
  const ferryDist = distanceToPoiM(ferry);
  const stationDist = distanceToPoiM(station);

  if (ferryDist != null && stationDist != null) {
    if (ferryDist < NEAR_TRANSPORT_M && ferryDist + 80 < stationDist) {
      return 'ferry';
    }
    if (stationDist < NEAR_TRANSPORT_M && stationDist + 80 < ferryDist) {
      return 'rail';
    }
    if (ferryDist < stationDist) return 'ferry';
    return 'rail';
  }

  if (ferryDist != null && ferryDist < NEAR_TRANSPORT_M) return 'ferry';
  if (stationDist != null && stationDist < NEAR_TRANSPORT_M) return 'rail';

  if (cityId() === 'wangerooge') return 'ferry';

  return 'rail';
}

export async function shouldRouteToFerryAdvisor(text: string): Promise<boolean> {
  if (FERRY_HINT.test(text.trim())) return true;
  if (!isAmbiguousScheduleQuery(text)) return false;
  return (await inferScheduleMode(text)) === 'ferry';
}
