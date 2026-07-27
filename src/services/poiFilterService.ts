/**
 * POI-Filter-Engine: Barrierefreiheit, Kirchen, Ernährung, Distanz/Tempo.
 * Läuft vor Story-Trigger und Empfehlungen.
 */

import type { Poi } from '../db/types';
import type { UserProfile } from '../types/userProfile';
import { parseTagsJson } from './geo/triggerPolicy';
import { resolvePersonaEngine } from './personaEngine';
import { haversineMeters } from '../db/database';

const STAIR_TAGS = new Set([
  'treppe',
  'treppen',
  'stairs',
  'nicht_barrierefrei',
  'kein_aufzug',
  'stufen',
  'steile_treppe',
  'nur_treppe',
]);

const WHEELCHAIR_OK_TAGS = new Set([
  'barrierefrei',
  'rollstuhl',
  'wheelchair',
  'stufenfrei',
  'aufzug',
  'rampe',
]);

const CHURCH_TAGS = new Set([
  'kirche',
  'kirchen',
  'sakral',
  'kapelle',
  'dom',
  'cathedral',
]);

const FISH_TAGS = new Set([
  'fischrestaurant',
  'fisch',
  'seafood',
  'fischimbiss',
]);

const MEAT_HEAVY_TAGS = new Set([
  'fleisch',
  'steak',
  'grill',
  'würstchen',
  'wurst',
  'bbq',
  'metzgerei',
]);

export type PoiFilterReason =
  | 'ok'
  | 'wheelchair_inaccessible'
  | 'church_dislike'
  | 'dietary_fish'
  | 'dietary_meat'
  | 'distance_too_far'
  | 'low_stamina_strenuous'
  | 'dislike_match';

export type PoiFilterResult = {
  allowed: boolean;
  reason: PoiFilterReason;
  maxRouteMeters: number;
};

function blobOf(poi: Poi): string {
  const tags = parseTagsJson(poi.tags_json).join(' ');
  return `${poi.name} ${poi.category ?? ''} ${tags}`.toLowerCase();
}

function looksStrenuous(poi: Poi): boolean {
  const tags = parseTagsJson(poi.tags_json);
  const blob = blobOf(poi);
  return (
    tags.some((t) => STAIR_TAGS.has(t)) ||
    /treppe|steig|aussichtsturm|turmsteigen|klettern|steil/.test(blob)
  );
}

function looksWheelchairInaccessible(poi: Poi): boolean {
  const tags = parseTagsJson(poi.tags_json);
  if (tags.some((t) => WHEELCHAIR_OK_TAGS.has(t))) return false;
  if (tags.some((t) => STAIR_TAGS.has(t))) return true;
  const blob = blobOf(poi);
  // Explizite Hinweise ohne Positiv-Tag
  if (/nicht barrierefrei|nur (über |via )?treppe|keine rampe/.test(blob)) {
    return true;
  }
  return false;
}

function isChurch(poi: Poi): boolean {
  const tags = parseTagsJson(poi.tags_json);
  const cat = (poi.category ?? '').toLowerCase();
  return (
    CHURCH_TAGS.has(cat) ||
    tags.some((t) => CHURCH_TAGS.has(t)) ||
    /\bkirche\b|\bkapelle\b|\bdom\b/.test(poi.name.toLowerCase())
  );
}

/** Max. Routen-Distanz je nach Mobilität & Ausdauer. */
export function resolveMaxRouteMeters(profile?: UserProfile | null): number {
  const engine = resolvePersonaEngine(profile);
  let base = 900;
  switch (engine.mobilityMode) {
    case 'bike':
      base = 3500;
      break;
    case 'public_transit':
      base = 2500;
      break;
    case 'car':
      base = 8000;
      break;
    case 'foot':
    default:
      base = 900;
  }
  if (engine.accessibility.pregnantOrLowStamina) {
    base = Math.min(base, 450);
  }
  if (engine.accessibility.wheelchairRequired) {
    base = Math.min(base, 600);
  }
  if (engine.pace === 'fast_explore') {
    base = Math.round(base * 1.35);
  }
  if (engine.timeBudgetMinutes != null && engine.timeBudgetMinutes < 45) {
    base = Math.min(base, 500);
  }
  return base;
}

/**
 * Prüft, ob ein POI für dieses Profil erlaubt ist.
 */
export function evaluatePoiForProfile(
  poi: Poi,
  profile?: UserProfile | null,
  opts?: { userLat?: number | null; userLng?: number | null },
): PoiFilterResult {
  const engine = resolvePersonaEngine(profile);
  const maxRouteMeters = resolveMaxRouteMeters(profile);
  const tags = parseTagsJson(poi.tags_json);
  const dietary = engine.preferences.dietaryRestrictions.map((d) =>
    d.toLowerCase(),
  );

  if (engine.accessibility.wheelchairRequired && looksWheelchairInaccessible(poi)) {
    return {
      allowed: false,
      reason: 'wheelchair_inaccessible',
      maxRouteMeters,
    };
  }

  if (
    engine.accessibility.pregnantOrLowStamina &&
    looksStrenuous(poi)
  ) {
    return {
      allowed: false,
      reason: 'low_stamina_strenuous',
      maxRouteMeters,
    };
  }

  if (!engine.preferences.likesChurches && isChurch(poi)) {
    return { allowed: false, reason: 'church_dislike', maxRouteMeters };
  }

  const isFish =
    tags.some((t) => FISH_TAGS.has(t)) ||
    (poi.category ?? '').toLowerCase() === 'fischrestaurant';
  if (
    isFish &&
    dietary.some((d) => /vegetar|vegan|kein\s*fisch/.test(d))
  ) {
    return { allowed: false, reason: 'dietary_fish', maxRouteMeters };
  }

  const isMeatHeavy = tags.some((t) => MEAT_HEAVY_TAGS.has(t));
  if (
    isMeatHeavy &&
    dietary.some((d) => /vegetar|vegan|kein\s*fleisch/.test(d)) &&
    !tags.includes('vegetarisch') &&
    !tags.includes('vegan')
  ) {
    return { allowed: false, reason: 'dietary_meat', maxRouteMeters };
  }

  for (const dislike of engine.preferences.dislikes) {
    const key = dislike.toLowerCase().replace(/^keine?\s+/, '');
    if (key.length >= 4 && blobOf(poi).includes(key)) {
      // „keine Kirchen“ schon oben; generische Abneigungen
      if (/kirche/.test(key)) continue;
      return { allowed: false, reason: 'dislike_match', maxRouteMeters };
    }
  }

  if (
    opts?.userLat != null &&
    opts?.userLng != null &&
    Number.isFinite(opts.userLat) &&
    Number.isFinite(opts.userLng)
  ) {
    const d = haversineMeters(opts.userLat, opts.userLng, poi.lat, poi.lng);
    if (d > maxRouteMeters) {
      return { allowed: false, reason: 'distance_too_far', maxRouteMeters };
    }
  }

  return { allowed: true, reason: 'ok', maxRouteMeters };
}

/** Filtert eine POI-Liste für Routing / Empfehlungen. */
export function filterPoisForProfile<T extends Poi>(
  pois: T[],
  profile?: UserProfile | null,
  opts?: { userLat?: number | null; userLng?: number | null },
): T[] {
  return pois.filter((poi) => evaluatePoiForProfile(poi, profile, opts).allowed);
}
