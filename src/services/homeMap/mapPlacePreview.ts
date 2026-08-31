/**
 * Ort-Popup vorbereiten, bevor der User tippt.
 * Sichtbare Pins laufen im Hintergrund; ein Tap springt an die Spitze
 * und blockiert die restliche Prefetch-Schlange nicht.
 */

import type { Fact, Poi } from '../../db/types';
import {
  buildHomeMapPlaceBullets,
  categoryLabelForPoi,
} from './homeMapPlaceBullets';
import {
  isEstablishedGoogleMapsPlaceUrl,
  mapsUrlForGooglePlace,
  pickNearbyListedGooglePlace,
} from '../research/eventInfoUrl';

/** Langer Fingerdruck auf leere Karte — kein Pack-POI. */
export const MAP_DROP_PIN_ID = -2;

export type MapPlacePreview = {
  id: number;
  name: string;
  category: string;
  bullets: string[];
  websiteUrl?: string | null;
  extraActions?: Array<{ label: string; url: string }> | null;
  lat: number;
  lng: number;
  spotKey?: string | null;
  /** Google-Place-Suche für Maps schon gelaufen (Treffer oder bewusst kein Link). */
  mapsLookedUp?: boolean;
};

const MAX_CACHE = 80;
const BG_BATCH = 6;

const cache = new Map<number, MapPlacePreview>();
let pending: number[] = [];
let bgRunning = false;
let tapBusy = false;
const mapsLookupBusy = new Set<number>();
let getPoi: (id: number) => Poi | undefined = () => undefined;
let getCityName: () => string = () => '';
let onUpdated: ((place: MapPlacePreview) => void) | null = null;
let loadFactsForPois:
  | ((ids: number[]) => Promise<Map<number, Fact[]>>)
  | null = null;

export function bindMapPlacePreview(opts: {
  getPoi: (id: number) => Poi | undefined;
  getCityName: () => string;
  onUpdated?: (place: MapPlacePreview) => void;
  loadFactsForPois?: (ids: number[]) => Promise<Map<number, Fact[]>>;
}): void {
  getPoi = opts.getPoi;
  getCityName = opts.getCityName;
  onUpdated = opts.onUpdated ?? null;
  loadFactsForPois = opts.loadFactsForPois ?? null;
}

export function peekMapPlacePreview(id: number): MapPlacePreview | null {
  return cache.get(id) ?? null;
}

export function instantMapPlacePopup(opts: {
  id: number;
  name?: string | null;
  category?: string | null;
  lat?: number | null;
  lng?: number | null;
  poi?: Poi | null;
}): MapPlacePreview {
  const cached = cache.get(opts.id);
  const poi = opts.poi ?? getPoi(opts.id) ?? null;
  const tapLat = opts.lat == null ? Number.NaN : Number(opts.lat);
  const tapLng = opts.lng == null ? Number.NaN : Number(opts.lng);
  const lat = Number.isFinite(tapLat)
    ? tapLat
    : Number(cached?.lat ?? poi?.lat ?? 0);
  const lng = Number.isFinite(tapLng)
    ? tapLng
    : Number(cached?.lng ?? poi?.lng ?? 0);
  if (cached) {
    const name = (opts.name || cached.name || 'Ort').trim() || cached.name;
    if (cached.lat === lat && cached.lng === lng && cached.name === name) {
      return cached;
    }
    return { ...cached, name, lat, lng };
  }
  const name = (opts.name || poi?.name || 'Ort').trim() || 'Ort';
  const category =
    (opts.category || '').trim() ||
    (poi ? categoryLabelForPoi(poi) : 'Ort');
  const teaser = (poi?.teaser_text || '').trim();
  const facts = teaser
    ? [{ id: 0, poi_id: poi?.id ?? 0, fact_text: teaser }]
    : [];
  const bullets = buildHomeMapPlaceBullets(
    poi ? { ...poi, facts } : null,
    category,
  );
  return {
    id: opts.id,
    name,
    category,
    bullets,
    websiteUrl: null,
    extraActions: null,
    lat,
    lng,
    spotKey: poi?.spot_key ?? null,
  };
}

function listedMapsUrl(url: string | null | undefined): string | null {
  const u = (url || '').trim();
  if (!u) return null;
  if (!/maps\.google|google\.[^/\s]+\/maps|maps\.app\.goo\.gl/i.test(u)) {
    return u;
  }
  return isEstablishedGoogleMapsPlaceUrl(u) ? u : null;
}

function mergeMapsAction(
  extra: Array<{ label: string; url: string }> | null | undefined,
  mapsUrl: string | null,
): Array<{ label: string; url: string }> | null {
  const rest = (extra ?? []).filter((a) => !/^maps$/i.test(a.label));
  const url = listedMapsUrl(mapsUrl);
  if (url) rest.unshift({ label: 'Maps', url });
  return rest.length ? rest : null;
}

const mapsResult = new Map<number, string | null>();

function withListedMaps(place: MapPlacePreview): MapPlacePreview {
  if (!mapsResult.has(place.id)) return place;
  return {
    ...place,
    mapsLookedUp: true,
    extraActions: mergeMapsAction(
      place.extraActions,
      mapsResult.get(place.id) ?? null,
    ),
  };
}

function remember(place: MapPlacePreview): void {
  const next = withListedMaps(place);
  if (cache.has(next.id)) cache.delete(next.id);
  cache.set(next.id, next);
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    cache.delete(oldest);
  }
  onUpdated?.(next);
}

function publishMapsResult(place: MapPlacePreview, mapsUrl: string | null): void {
  mapsResult.set(place.id, mapsUrl);
  const cached = cache.get(place.id);
  if (cached) {
    remember(cached);
    return;
  }
  onUpdated?.(withListedMaps(place));
}

function firstWebsiteUrl(poi: Poi, facts: Fact[]): string | null {
  const blob = [
    poi.teaser_text ?? '',
    poi.tags_json ?? '',
    ...facts.map((f) => f.fact_text ?? ''),
  ].join(' ');
  const m = blob.match(/https?:\/\/[^\s)\]>'",]+/i);
  if (!m?.[0]) return null;
  const url = m[0].replace(/[.,;:!?)]+$/g, '');
  if (/maps\.google|google\.[^/\s]+\/maps|maps\.app\.goo\.gl/i.test(url)) {
    return null;
  }
  return url;
}

function buildFromPoi(poi: Poi, facts: Fact[]): MapPlacePreview {
  const full = { ...poi, facts };
  const category = categoryLabelForPoi(poi);
  return {
    id: poi.id,
    name: poi.name,
    category,
    bullets: buildHomeMapPlaceBullets(full, poi.category),
    websiteUrl: firstWebsiteUrl(poi, facts),
    extraActions: null,
    lat: poi.lat,
    lng: poi.lng,
    spotKey: poi.spot_key,
  };
}

/** Maps nur wenn Google denselben Ort in der Nähe als Place führt. */
export async function enrichMapPlaceMapsIfListed(
  place: MapPlacePreview,
): Promise<void> {
  const id = place.id;
  if (mapsResult.has(id) || mapsLookupBusy.has(id)) return;
  if (
    !Number.isFinite(place.lat) ||
    !Number.isFinite(place.lng) ||
    (place.lat === 0 && place.lng === 0)
  ) {
    publishMapsResult(place, null);
    return;
  }
  mapsLookupBusy.add(id);
  try {
    const blob = `${place.name} ${place.category ?? ''}`;
    const letterbox =
      /briefkasten|post_box|mailbox/i.test(blob) &&
      !/packstation|parcel.?locker|paketautomat/i.test(blob);
    if (letterbox) {
      publishMapsResult(place, null);
      return;
    }
    const locker = /packstation|parcel.?locker|paketautomat/i.test(blob);
    const { searchPlacesByText } = await import('../navigation/googleMapsNav');
    const city = getCityName();
    const query = locker
      ? place.name.trim()
      : [place.name, city].filter(Boolean).join(' ').trim();
    const hits = await searchPlacesByText({
      query: query.length >= 3 ? query : place.name,
      lat: place.lat,
      lng: place.lng,
      radiusM: locker ? 600 : 800,
      includedType: locker ? 'parcel_lockers' : undefined,
    });
    const picked = pickNearbyListedGooglePlace({
      queryName: place.name,
      hits,
    });
    const mapsUrl = picked
      ? mapsUrlForGooglePlace({
          placeName: picked.name || place.name,
          placeId: picked.placeId,
        })
      : null;
    publishMapsResult(place, mapsUrl);
  } catch {
    publishMapsResult(place, null);
  } finally {
    mapsLookupBusy.delete(id);
  }
}

async function factsFor(ids: number[]): Promise<Map<number, Fact[]>> {
  if (loadFactsForPois) return loadFactsForPois(ids);
  const { getFactsForPois } = await import('../../db/database');
  return getFactsForPois(ids);
}

async function loadOne(id: number): Promise<MapPlacePreview | null> {
  if (id <= 0) return null;
  const hit = cache.get(id);
  if (hit) return hit;
  const poi = getPoi(id);
  if (!poi) return null;
  try {
    const facts = (await factsFor([id])).get(id) ?? [];
    const place = buildFromPoi(poi, facts);
    remember(place);
    return place;
  } catch {
    const fallback = instantMapPlacePopup({ id, poi });
    remember(fallback);
    return fallback;
  }
}

/**
 * User hat getippt: dieser Ort zuerst, Hintergrund-Prefetch wartet.
 */
export function prioritizeMapPlacePreview(
  id: number,
): Promise<MapPlacePreview | null> {
  if (id <= 0) return Promise.resolve(null);
  const hit = cache.get(id);
  if (hit) {
    if (!hit.mapsLookedUp) void enrichMapPlaceMapsIfListed(hit);
    return Promise.resolve(hit);
  }
  pending = [id, ...pending.filter((x) => x !== id)];
  tapBusy = true;
  return loadOne(id)
    .then((place) => {
      if (place) void enrichMapPlaceMapsIfListed(place);
      return place;
    })
    .finally(() => {
      tapBusy = false;
      void kickBackground();
    });
}

/** Sichtbare Pack-Orte vorwärmen (ohne Overlay-IDs). */
export function prefetchVisibleMapPlaces(ids: number[]): void {
  const want = ids.filter((id) => Number.isFinite(id) && id > 0 && !cache.has(id));
  const head = pending[0];
  const rest = want.filter((id) => id !== head);
  pending = head != null && want.includes(head) ? [head, ...rest] : rest;
  void kickBackground();
}

async function kickBackground(): Promise<void> {
  if (bgRunning || tapBusy) return;
  bgRunning = true;
  try {
    // Ein Tick warten: ein Tap im selben Frame kann noch an die Spitze.
    await Promise.resolve();
    while (pending.length && !tapBusy) {
      const batch = pending.splice(0, BG_BATCH);
      const missing = batch.filter((id) => !cache.has(id));
      if (missing.length === 0) continue;
      try {
        const factsById = await factsFor(missing);
        if (tapBusy) {
          pending = [...missing.filter((id) => !cache.has(id)), ...pending];
          break;
        }
        for (const id of missing) {
          if (cache.has(id)) continue;
          const poi = getPoi(id);
          if (!poi) continue;
          remember(buildFromPoi(poi, factsById.get(id) ?? []));
        }
      } catch {
        for (const id of missing) {
          if (tapBusy) {
            pending.unshift(id);
            break;
          }
          await loadOne(id);
        }
      }
    }
  } finally {
    bgRunning = false;
    if (pending.length && !tapBusy) void kickBackground();
  }
}

/** Tests / Reset. */
export function resetMapPlacePreviewForTests(): void {
  cache.clear();
  pending = [];
  bgRunning = false;
  tapBusy = false;
  mapsLookupBusy.clear();
  mapsResult.clear();
  getPoi = () => undefined;
  getCityName = () => '';
  onUpdated = null;
  loadFactsForPois = null;
}

export function mapPlacePreviewPendingForTests(): number[] {
  return [...pending];
}
