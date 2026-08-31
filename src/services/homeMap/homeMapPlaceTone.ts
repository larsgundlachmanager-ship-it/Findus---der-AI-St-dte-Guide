/**
 * Farbpriorität Homescreen-Karte = Orte-Einstellungen:
 * grün besucht → blau geplant → lila Auslösen → rot kein Auto-Trigger.
 * Typ-Chips filtern nur, sie färben nicht.
 */

import type { Poi } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import { isHardAmenityNoise } from '../../interests/amenityInterestPolicy';
import { parseTagsJson } from '../geo/triggerPolicy';
import {
  isModul1AutoTriggerMapPoi,
  isPackStoryMapPoi,
} from '../navigation/stampMapModul1';
import {
  HOME_MAP_PLACE_COLORS,
  type HomeMapPlaceTone,
} from './homeMapStyle';
import {
  isAlwaysOnMapAmenity,
  isMapShelterBuildingPoi,
} from './homeMapPlaceType';
import { isTransitMapPoi } from './homeMapTransit';

export { isTransitMapPoi } from './homeMapTransit';

const EVERYDAY_DIR_RE =
  /\b(restaurant|café|cafe|bistro|imbiss|bäckerei|baeckerei|bäcker|baecker|bakery|hotel|hostel|pension|park\b|garten|minigolf|bowling|freizeit|supermarket|supermarkt|einkauf|discounter|edeka|rewe|aldi|lidl|penny|marktkauf|frischecenter|museum|kino|theater|bar\b|kneipe|club|nightlife|sport|sportplatz|sportgelände|sportgelaende|tennis|wasserski|surfen|strand|beach|spielplatz|zoo|tierpark|post\b|postfiliale|briefkasten|postbox|mailbox|packstation|dhl|paket|kiosk|bücherei|buecherei|bibliothek|frisör|frisoer|salon|blumen|florist|apotheke|kindergarten|kita|schule)\b/i;

const HARD_KEEP_OFF_RE =
  /\b(zahnarzt|arztpraxis|hausarzt|\bpraxis\b|klinik|\barzt\b|toilette|wc\b|parkplatz|parkhaus)\b/i;

function poiBlob(poi: Poi): string {
  return `${poi.name ?? ''} ${poi.category ?? ''} ${poi.tags_json ?? ''}`;
}

/** Directory ohne Story — auf der Karte nur mit Typ-/Alles-Filter. */
export function isTouristDirectoryMapPoi(poi: Poi): boolean {
  if (isPackStoryMapPoi(poi)) return false;
  if (isTransitMapPoi(poi)) return false;
  if (HARD_KEEP_OFF_RE.test(poiBlob(poi))) return false;
  const tags = parseTagsJson(poi.tags_json);
  if (tags.includes('map_outline')) return true;
  if (isHardAmenityNoise(poi) && !/\b(apotheke|kindergarten|kita)\b/i.test(poiBlob(poi))) {
    return false;
  }

  const blob = poiBlob(poi);
  const isDirectory =
    tags.includes('directory') ||
    tags.includes('tier4') ||
    tags.includes('offline_lookup');

  if (isDirectory) return true;
  if (tags.includes('amenity_skip') && !/\b(apotheke|kindergarten|kita)\b/i.test(blob)) {
    return false;
  }
  return EVERYDAY_DIR_RE.test(blob) || tags.includes('touristic');
}

/** Vom User/Recherche neu im Datensatz — immer auf die Karte. */
export function isLearnedMapPoi(poi: Poi): boolean {
  return parseTagsJson(poi.tags_json).includes('learned');
}

/** Alle POIs, die auf der Presence-Karte erscheinen. */
export function isHomePresenceMapPoi(
  poi: Poi,
  profile?: UserProfile | null,
): boolean {
  const kind = poi.kind ?? 'legacy';
  if (kind === 'approach') return false;
  if (kind === 'sub' && !isMapShelterBuildingPoi(poi)) return false;
  if (!Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) return false;
  if (isAlwaysOnMapAmenity(poi)) return true;
  if (isLearnedMapPoi(poi) && !isHardAmenityNoise(poi)) return true;
  if (isPackStoryMapPoi(poi)) return true;
  if (isModul1AutoTriggerMapPoi(poi, profile)) return true;
  if (isTransitMapPoi(poi)) return true;
  if (isTouristDirectoryMapPoi(poi)) return true;
  const tags = parseTagsJson(poi.tags_json);
  if (tags.includes('map_outline') && !HARD_KEEP_OFF_RE.test(poiBlob(poi))) {
    return true;
  }
  if (tags.includes('osm_map')) return true;
  return false;
}

export function resolveHomeMapPlaceTone(
  poi: Poi,
  profile: UserProfile | null | undefined,
  visited: boolean,
  opts?: { planned?: boolean; typeFilters?: ReadonlySet<string> },
): HomeMapPlaceTone {
  if (visited) return 'visited';
  if (opts?.planned) return 'planned';
  if (isModul1AutoTriggerMapPoi(poi, profile)) return 'liked';
  return 'neutral';
}

export function colorForHomeMapPlaceTone(tone: HomeMapPlaceTone): string {
  if (tone === 'tourist') return HOME_MAP_PLACE_COLORS.rest;
  return HOME_MAP_PLACE_COLORS[tone];
}

/** Nur Status-Legende — Typ-Grün (Natur/Aussicht) nie über Trigger/Besucht. */
export function colorForHomeMapPoi(
  poi: Poi,
  profile: UserProfile | null | undefined,
  visited: boolean,
  opts?: { planned?: boolean; typeFilters?: ReadonlySet<string> },
): string {
  return colorForHomeMapPlaceTone(
    resolveHomeMapPlaceTone(poi, profile, visited, opts),
  );
}
