/**
 * Ziel-Auflösung: Pack (aktiv + gecachte Städte) → OSM → Google.
 *
 * Persistence: cities/<id>.json stays on device after download. SQLite is only
 * the active Modul-1 city; this module queries any cached pack for Q&A/nav.
 */

import * as FileSystem from 'expo-file-system';
import type { CityPack } from '../cityPack';
import { geocodePlaceNameOsmFirst } from './googleMapsNav';
import {
  canonicalizeLandmarkQuery,
  foldCityKey,
  slugCityHint,
} from './landmarkAliases';

export { canonicalizeLandmarkQuery, slugCityHint } from './landmarkAliases';

const DOC = FileSystem.documentDirectory;
const CITIES_DIR = DOC ? `${DOC}cities/` : null;

export async function listCachedCityPackIds(): Promise<string[]> {
  if (!CITIES_DIR) return [];
  try {
    const info = await FileSystem.getInfoAsync(CITIES_DIR);
    if (!info.exists) return [];
    const names = await FileSystem.readDirectoryAsync(CITIES_DIR);
    return names
      .filter((n) => n.endsWith('.json') && !n.startsWith('_'))
      .map((n) => n.replace(/\.json$/i, '').toLowerCase());
  } catch {
    return [];
  }
}

function nameScore(poiName: string, subject: string): number {
  const a = poiName.trim().toLowerCase();
  const b = subject
    .trim()
    .toLowerCase()
    .replace(/\bhamburg\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 85;
  const at = a.split(/[^a-zäöüß0-9]+/i).filter((t) => t.length > 2);
  const bt = b.split(/[^a-zäöüß0-9]+/i).filter((t) => t.length > 2);
  let hit = 0;
  for (const t of bt) if (at.some((x) => x.includes(t) || t.includes(x))) hit += 1;
  if (!bt.length) return 0;
  if (bt.length === 1 && hit === 1) return 90;
  return Math.round((hit / bt.length) * 55);
}

function spotCoords(spot: {
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  polygonCoordinates?: Array<{ latitude?: number; longitude?: number }>;
  polygon?: Array<{ lat?: number; lng?: number; latitude?: number; longitude?: number }>;
  sub_pois?: Array<{
    name?: string;
    lat?: number;
    lng?: number;
    latitude?: number;
    longitude?: number;
  }>;
  subPois?: Array<{
    name?: string;
    lat?: number;
    lng?: number;
    latitude?: number;
    longitude?: number;
  }>;
}): { lat: number; lng: number } | null {
  const lat = spot.latitude ?? spot.lat;
  const lng = spot.longitude ?? spot.lng;
  if (typeof lat === 'number' && typeof lng === 'number') {
    return { lat, lng };
  }
  const subs = spot.sub_pois || spot.subPois || [];
  for (const s of subs) {
    const tags = ((s as { tags?: string[] }).tags ?? []).map((t) =>
      String(t).toLowerCase(),
    );
    const isEntrance =
      tags.includes('nav_target') ||
      tags.includes('gps_entrance') ||
      /haupteingang|eingang|plaza/i.test(s.name || '');
    if (!isEntrance) continue;
    const slat = s.latitude ?? s.lat;
    const slng = s.longitude ?? s.lng;
    if (typeof slat === 'number' && typeof slng === 'number') {
      return { lat: slat, lng: slng };
    }
  }
  const poly = spot.polygonCoordinates || spot.polygon;
  if (Array.isArray(poly) && poly.length) {
    let sLat = 0;
    let sLng = 0;
    let n = 0;
    for (const p of poly) {
      const pla = p.latitude ?? (p as { lat?: number }).lat;
      const pln = p.longitude ?? (p as { lng?: number }).lng;
      if (typeof pla === 'number' && typeof pln === 'number') {
        sLat += pla;
        sLng += pln;
        n += 1;
      }
    }
    if (n > 0) return { lat: sLat / n, lng: sLng / n };
  }
  for (const s of subs) {
    if (/haupteingang|eingang|plaza/i.test(s.name || '')) {
      const slat = s.latitude ?? s.lat;
      const slng = s.longitude ?? s.lng;
      if (typeof slat === 'number' && typeof slng === 'number') {
        return { lat: slat, lng: slng };
      }
    }
  }
  for (const s of subs) {
    const slat = s.latitude ?? s.lat;
    const slng = s.longitude ?? s.lng;
    if (typeof slat === 'number' && typeof slng === 'number') {
      return { lat: slat, lng: slng };
    }
  }
  return null;
}

export async function loadCachedCityPack(cityId: string): Promise<CityPack | null> {
  if (!CITIES_DIR) return null;
  const path = `${CITIES_DIR}${cityId}.json`;
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists || (info.size ?? 0) < 100) return null;
    const text = await FileSystem.readAsStringAsync(path);
    const pack = JSON.parse(text) as CityPack;
    return pack && typeof pack === 'object' ? pack : null;
  } catch {
    return null;
  }
}

/** Story-/Directory-Spots eines gecachten Packs (Pitch/Plan, ohne aktive SQLite). */
export async function listCachedPackSpotsForPitch(
  cityId: string,
): Promise<
  Array<{ name: string; lat: number; lng: number; tags: string; category: string }>
> {
  const pack = await loadCachedCityPack(cityId);
  if (!pack) return [];
  const spots = Array.isArray(pack.spots) ? pack.spots : [];
  const out: Array<{
    name: string;
    lat: number;
    lng: number;
    tags: string;
    category: string;
  }> = [];
  for (const spot of spots) {
    const name = String(spot.name || '').trim();
    if (!name || /wegweiser|approach/i.test(name)) continue;
    const coords = spotCoords(spot as Parameters<typeof spotCoords>[0]);
    if (!coords) continue;
    const role = String(
      (spot as { pack_role?: string }).pack_role || '',
    ).toLowerCase();
    if (role === 'approach') continue;
    const cat = String(spot.category || '').toLowerCase();
    const tags = `${role} ${cat} ${name}`.toLowerCase();
    out.push({
      name,
      lat: coords.lat,
      lng: coords.lng,
      tags,
      category: cat,
    });
  }
  return out;
}

/**
 * Map a city name/hint to a downloaded pack id (by slug, id, or pack.name).
 * Used so Q&A can hit Hamburg while Prisdorf is the active Modul-1 city.
 */
export async function resolveCachedCityIdFromHint(
  hint: string | null | undefined,
): Promise<string | null> {
  const raw = (hint || '').trim();
  if (!raw) return null;
  const slug = slugCityHint(raw);
  const ids = await listCachedCityPackIds();
  if (!ids.length) return slug;
  if (slug && ids.includes(slug)) return slug;

  const folded = foldCityKey(raw);
  if (folded.length >= 3) {
    for (const id of ids) {
      if (foldCityKey(id) === folded) return id;
      if (
        folded.length >= 4 &&
        (id.includes(folded) || folded.includes(foldCityKey(id)))
      ) {
        return id;
      }
    }
    for (const id of ids) {
      const pack = await loadCachedCityPack(id);
      if (!pack) continue;
      const nameFold = foldCityKey(pack.name || '');
      const packIdFold = foldCityKey(pack.city_id || id);
      if (nameFold === folded || packIdFold === folded) return id;
      if (
        folded.length >= 4 &&
        (nameFold.includes(folded) || folded.includes(nameFold))
      ) {
        return id;
      }
    }
  }
  return slug;
}

export type PackPlaceHit = {
  name: string;
  lat: number;
  lng: number;
  cityId: string;
  source: 'cached_pack' | 'active_sqlite';
  spotId?: string;
};

/** Ort in einem gecachten Pack (ohne aktive SQLite-Stadt). */
export async function lookupPlaceInCachedPack(
  cityId: string,
  query: string,
): Promise<PackPlaceHit | null> {
  const pack = await loadCachedCityPack(cityId);
  if (!pack) return null;
  const spots = Array.isArray(pack.spots) ? pack.spots : [];
  const triggers = Array.isArray(pack.trigger_points)
    ? pack.trigger_points
    : [];

  let best: {
    name: string;
    lat: number;
    lng: number;
    score: number;
    spotId?: string;
  } | null = null;

  for (const spot of spots) {
    const name = String(spot.name || '').trim();
    if (!name) continue;
    const score = nameScore(name, query);
    if (score < 55) continue;
    let coords = spotCoords(spot as any);
    if (!coords) {
      const id = String(spot.id || '');
      const tp = triggers.find(
        (t: { id?: string; name?: string }) =>
          t.id === id ||
          (t.name && nameScore(String(t.name), name) >= 70),
      ) as { lat?: number; lng?: number } | undefined;
      if (
        tp &&
        typeof tp.lat === 'number' &&
        typeof tp.lng === 'number'
      ) {
        coords = { lat: tp.lat, lng: tp.lng };
      }
    }
    if (!coords) continue;
    if (!best || score > best.score) {
      best = {
        name,
        lat: coords.lat,
        lng: coords.lng,
        score,
        spotId: spot.id,
      };
    }
  }

  // Trigger-only names (falls Spot ohne Polygon)
  for (const tp of triggers) {
    const name = String((tp as { name?: string }).name || '').trim();
    if (!name || /wegweiser|approach/i.test(name)) continue;
    const score = nameScore(name, query);
    if (score < 60) continue;
    const lat = (tp as { lat?: number }).lat;
    const lng = (tp as { lng?: number }).lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!best || score > best.score) {
      best = {
        name,
        lat,
        lng,
        score,
        spotId: (tp as { id?: string }).id,
      };
    }
  }

  if (!best) return null;
  return {
    name: best.name,
    lat: best.lat,
    lng: best.lng,
    cityId,
    source: 'cached_pack',
    spotId: best.spotId,
  };
}

/** Fakten/Bullets aus gecachtem Pack (für Recherche ohne aktive Stadt). */
export async function loadCachedPackFacts(
  cityId: string,
  query: string,
  limit = 12,
): Promise<{ name: string; lat: number; lng: number; facts: string[] } | null> {
  const pack = await loadCachedCityPack(cityId);
  if (!pack) return null;
  const place = await lookupPlaceInCachedPack(cityId, query);
  if (!place) return null;
  const spots = Array.isArray(pack.spots) ? pack.spots : [];
  const spot = spots.find(
    (s) =>
      String(s.name || '').trim().toLowerCase() ===
        place.name.toLowerCase() ||
      s.id === place.spotId,
  );
  if (!spot) {
    return {
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      facts: [],
    };
  }
  const facts: string[] = [];
  const bullets = Array.isArray(spot.bullets) ? spot.bullets : [];
  for (const b of bullets) {
    const t = String(b || '').trim();
    if (t.length >= 20) facts.push(t);
    if (facts.length >= limit) break;
  }
  const tp = (pack.trigger_points || []).find(
    (t: { id?: string; general_info?: string; deep_data_pool?: unknown[] }) =>
      t.id === spot.id,
  );
  const gi = String(tp?.general_info || '').trim();
  if (gi.length >= 40 && facts.length < limit) {
    facts.unshift(gi.slice(0, 500));
  }
  const pool = Array.isArray(tp?.deep_data_pool) ? tp.deep_data_pool : [];
  for (const entry of pool) {
    if (facts.length >= limit) break;
    const text =
      typeof entry === 'string'
        ? entry
        : Array.isArray(entry)
          ? String(entry[0] || '')
          : String((entry as { text?: string })?.text || '');
    const t = text.replace(/\s+/g, ' ').trim();
    if (t.length >= 40) facts.push(t.slice(0, 500));
  }
  return {
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    facts: facts.slice(0, limit),
  };
}

/**
 * Pack zuerst (aktive SQLite + gecachte Städte), dann OSM, dann Google.
 */
export async function resolvePlacePackOsmGoogle(opts: {
  query: string;
  cityHint?: string | null;
  biasLat?: number;
  biasLng?: number;
}): Promise<{
  lat: number;
  lng: number;
  label: string;
  source: 'cached_pack' | 'active_sqlite' | 'osm_or_google';
  cityId?: string;
} | null> {
  const canon = canonicalizeLandmarkQuery(opts.query);
  const orig = String(opts.query || '').replace(/\s+/g, ' ').trim();
  const query = orig.length >= 2 ? orig : canon.query;
  if (query.length < 2) return null;

  const gpsSlug = slugCityHint(opts.cityHint);
  const aliasSlug = canon.preferredCityId;
  const hintSlug = await resolveCachedCityIdFromHint(opts.cityHint);

  // 1) Landmark alias city first, then explicit cityHint — any cached pack
  const preferredOrder = [aliasSlug, hintSlug].filter(
    (id, i, a): id is string => Boolean(id) && a.indexOf(id) === i,
  );
  const preferredFirst = preferredOrder[0] ?? null;
  for (const cityId of preferredOrder) {
    for (const q of [query, canon.query].filter(
      (x, i, a) => x && a.indexOf(x) === i,
    )) {
      const hit = await lookupPlaceInCachedPack(cityId, q);
      if (hit) {
        return {
          lat: hit.lat,
          lng: hit.lng,
          label: hit.name,
          source: 'cached_pack',
          cityId: hit.cityId,
        };
      }
    }
  }

  // 2) Aktive SQLite-Stadt (Modul-1 Pack) — skip when hint names another city
  let activePackId: string | null = null;
  try {
    const { getCachedUserProfile } = require('../userProfileService') as {
      getCachedUserProfile: () => { cityId?: string | null } | null;
    };
    const id = String(getCachedUserProfile()?.cityId || '')
      .trim()
      .toLowerCase();
    activePackId = id && !/^soft_/i.test(id) ? id : null;
  } catch {
    activePackId = null;
  }
  const foreignCityHint =
    Boolean(preferredFirst) &&
    Boolean(activePackId) &&
    preferredFirst !== activePackId;

  if (!foreignCityHint) {
    try {
      const { lookupPackFactsForSubject } = await import(
        '../../module2/agents/packFactLookup'
      );
      const hit = await lookupPackFactsForSubject({
        subject: query,
        cityHint: opts.cityHint,
        lat: opts.biasLat,
        lng: opts.biasLng,
      });
      if (
        hit?.poi &&
        hit.score >= 55 &&
        hit.poi.id > 0 &&
        Number.isFinite(hit.poi.lat) &&
        Number.isFinite(hit.poi.lng)
      ) {
        return {
          lat: hit.poi.lat,
          lng: hit.poi.lng,
          label: hit.poi.name,
          source: 'active_sqlite',
        };
      }
    } catch {
      /* soft */
    }
  }

  // 3) Remaining cached packs
  const cachedIds = await listCachedCityPackIds();
  const order: string[] = [];
  for (const id of [gpsSlug, aliasSlug, hintSlug, ...cachedIds]) {
    if (id && !order.includes(id)) order.push(id);
  }
  const packQueries = [query];
  if (canon.query && canon.query !== query) packQueries.push(canon.query);
  for (const cityId of order) {
    for (const q of packQueries) {
      const hit = await lookupPlaceInCachedPack(cityId, q);
      if (hit) {
        return {
          lat: hit.lat,
          lng: hit.lng,
          label: hit.name,
          source: 'cached_pack',
          cityId: hit.cityId,
        };
      }
    }
  }

  // 4) OSM → Google: aktuelle Stadt zuerst, bei Miss unbiased Retry in Geocode
  const geo = await geocodePlaceNameOsmFirst(query, {
    biasLat: opts.biasLat,
    biasLng: opts.biasLng,
    cityHint: opts.cityHint ?? null,
  });
  if (!geo) return null;
  return {
    lat: geo.lat,
    lng: geo.lng,
    label: geo.label || query,
    source: 'osm_or_google',
    cityId: aliasSlug ?? gpsSlug ?? undefined,
  };
}
