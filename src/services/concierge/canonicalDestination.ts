/**
 * Canonical destination — single source of truth for speech + action buttons.
 *
 * Invariant: if the user named a place (e.g. „Restaurant Kreta“),
 * speechText, pendingNavOffer, and START_NAVIGATION must all bind to THAT place.
 * Open food-discovery must never override a named go-to.
 */

import { getAllPois, getPoiWithFacts } from '../../db/database';
import { detectHardNavOverride } from '../navigation/hardNavOverride';
import { isExplicitNavIntent, isPoiInfoQuestion } from '../intent/poiInfoVsNav';
import type { PendingNavOffer } from '../navigation/navigationTypes';
import { geocodePlaceNameOsmFirst } from '../navigation/googleMapsNav';
import {
  looksLikeStreetAddress,
  expandStreetAddressGeocodeQueries,
  extractStreetAddressFromUtterance,
} from '../navigation/streetAddressQuery';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import {
  lookupCachedDestinationByName,
} from '../navigation/offlineNavCache';

export type CanonicalDestination = {
  offer: PendingNavOffer;
  /** User named this place explicitly (not open discovery). */
  named: true;
  /** Extracted label from speech. */
  queryName: string;
};

const NAMED_PLACE_RE =
  /\b(?:zum|zur|nach|zu|ins|in\s+den|in\s+die)\s+((?:restaurant|café|cafe|bistro|bar|imbiss|hotel|pension|museum|kirche|strand)?\s*[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*(?:\s+[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*){0,5})/iu;

function cleanLabel(s: string): string {
  return s
    .replace(/[.,!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
    .trim();
}

/**
 * Extract the destination name the user is talking about.
 * Prefers hard-nav phrases („ich möchte zu …“).
 */
export function extractNamedDestinationLabel(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 4) return null;
  if (isPoiInfoQuestion(t) && !isExplicitNavIntent(t)) return null;

  const spokenAddr = extractStreetAddressFromUtterance(t);
  if (spokenAddr && (isExplicitNavIntent(t) || /\b(zum|zur|nach|zu|navi|route)\b/iu.test(t))) {
    return spokenAddr;
  }

  const hard = detectHardNavOverride(t);
  if (hard) return cleanLabel(hard);

  // „Restaurant Kreta“ / „zum Kreta“ even without full hard-nav match
  if (isExplicitNavIntent(t) || /\b(restaurant|café|cafe|bistro)\s+\w/iu.test(t)) {
    const m = t.match(NAMED_PLACE_RE);
    if (m?.[1]) {
      const label = cleanLabel(m[1]);
      if (label.length >= 2 && !/^(mir|bitte|dort|hier)$/i.test(label)) {
        return label;
      }
    }
  }

  // Bare „Restaurant Kreta“
  const bare = t.match(
    /\b((?:restaurant|café|cafe|bistro|bar)\s+[A-ZÄÖÜ][\wÄÖÜäöüß\-&.']*(?:\s+[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*){0,3})/iu,
  );
  if (bare?.[1] && bare[1].trim().length >= 5) {
    return cleanLabel(bare[1]);
  }

  return null;
}

async function matchPoiByName(name: string): Promise<PendingNavOffer | null> {
  if (looksLikeStreetAddress(name)) return null;
  const q = name.toLowerCase().replace(/^restaurant\s+/i, '').trim();
  const pois = await getAllPois();
  const tokens = q
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !/^\d{1,4}[a-z]?$/i.test(t));

  let best: { id: number; score: number; name: string } | null = null;
  for (const poi of pois) {
    const blob = `${poi.name} ${poi.spot_key ?? ''} ${poi.category ?? ''}`.toLowerCase();
    let score = 0;
    if (blob.includes(q)) score += 50;
    if (poi.name.toLowerCase().includes(q)) score += 40;
    for (const tok of tokens) {
      if (blob.includes(tok)) score += 12;
    }
    // Prefer gastro-ish categories when query mentions restaurant
    if (
      /restaurant|café|cafe|bistro|gastro|essen/i.test(
        `${poi.category ?? ''} ${poi.name}`,
      )
    ) {
      score += 8;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { id: poi.id, score, name: poi.name };
    }
  }

  if (!best || best.score < 20) return null;
  const poi = await getPoiWithFacts(best.id);
  if (!poi) return null;
  return {
    poiId: poi.id,
    name: poi.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim(),
    lat: poi.lat,
    lng: poi.lng,
  };
}

/**
 * Resolve a user-named place to a concrete nav offer (DB → cache → geocode).
 */
export async function resolveCanonicalDestination(
  text: string,
): Promise<CanonicalDestination | null> {
  const queryName = extractNamedDestinationLabel(text);
  if (!queryName) return null;

  const local = await matchPoiByName(queryName);
  if (local) {
    return { offer: local, named: true, queryName };
  }

  const cached = await lookupCachedDestinationByName(queryName);
  if (cached) {
    return {
      offer: {
        poiId: cached.poiId ?? -1,
        name: cached.name,
        lat: cached.lat,
        lng: cached.lng,
      },
      named: true,
      queryName,
    };
  }

  const store = useFinnusStore.getState();
  const profile = getCachedUserProfile();
  const bias = {
    biasLat: store.lastGpsLat ?? undefined,
    biasLng: store.lastGpsLng ?? undefined,
    cityHint: profile?.cityName ?? profile?.cityId ?? null,
    preferStreetAddress: looksLikeStreetAddress(queryName),
  };
  const candidates = bias.preferStreetAddress
    ? expandStreetAddressGeocodeQueries(queryName, {
        profileCity: bias.cityHint,
        biasLat: bias.biasLat,
        biasLng: bias.biasLng,
      })
    : [queryName];
  let geo: Awaited<ReturnType<typeof geocodePlaceNameOsmFirst>> = null;
  for (const cand of candidates) {
    geo = await geocodePlaceNameOsmFirst(cand, bias);
    if (geo) break;
  }
  if (!geo) return null;

  // Re-match local after geocode label (nicht bei Adressen)
  if (!looksLikeStreetAddress(queryName)) {
    const local2 = await matchPoiByName(geo.label || queryName);
    if (local2) {
      return { offer: local2, named: true, queryName };
    }
  }

  return {
    offer: {
      poiId: -1,
      name: geo.label || queryName,
      lat: geo.lat,
      lng: geo.lng,
    },
    named: true,
    queryName,
  };
}

export { namesAlign } from './namesAlign';
