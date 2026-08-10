/**
 * Google Places Details + Reviews — Basis für Maps-Pitch
 * (Hotels, Museen, Attraktionen, Restaurants).
 */

import {
  hasGoogleMapsNavKey,
  searchPlacesByText,
} from './googleMapsNav';
import { env } from '../../config/env';
import { sanitizePlaceWebsiteUri } from './placeWebsiteUri';

export { sanitizePlaceWebsiteUri } from './placeWebsiteUri';

export type PlaceReviewSnippet = {
  rating: number | null;
  text: string;
  relativeTime: string | null;
};

/** Google Places day: 0=Sunday … 6=Saturday */
export type PlaceHoursPeriod = {
  open?: { day?: number; hour?: number; minute?: number };
  close?: { day?: number; hour?: number; minute?: number };
};

export type PlacePitchDetails = {
  placeId: string;
  name: string;
  types: string[];
  rating: number | null;
  ratingCount: number | null;
  editorialSummary: string | null;
  generativeSummary: string | null;
  formattedAddress: string | null;
  websiteUri: string | null;
  phoneNumber: string | null;
  openNow: boolean | null;
  /** 0=free … 4=very expensive (Places New priceLevel) */
  priceLevel: number | null;
  /** regularOpeningHours.periods — für morgen/Abend-Checks (nicht openNow) */
  regularOpeningHoursPeriods: PlaceHoursPeriod[];
  reviews: PlaceReviewSnippet[];
  lat: number | null;
  lng: number | null;
};

/** PRICE_LEVEL_* → 0–4 */
export function parsePlacesPriceLevel(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.min(4, Math.round(raw)));
  }
  const s = String(raw || '').toUpperCase();
  if (!s || s.includes('UNSPECIFIED')) return null;
  if (s.includes('FREE')) return 0;
  if (s.includes('INEXPENSIVE')) return 1;
  if (s.includes('MODERATE')) return 2;
  if (s.includes('VERY_EXPENSIVE')) return 4;
  if (s.includes('EXPENSIVE')) return 3;
  return null;
}

/**
 * Öffnen/Schließen (Minuten ab Mitternacht) für einen Kalendertag aus regularOpeningHours.
 */
export function openCloseMinForJsDay(
  periods: PlaceHoursPeriod[] | undefined,
  jsDay: number,
): { opensAtMin: number | null; closesAtMin: number | null } {
  if (!periods?.length) return { opensAtMin: null, closesAtMin: null };
  let opensAtMin: number | null = null;
  let closesAtMin: number | null = null;
  for (const p of periods) {
    const openDay = p.open?.day;
    const open = p.open;
    const close = p.close;
    if (openDay == null || open?.hour == null) continue;
    const openMin = open.hour * 60 + (open.minute ?? 0);
    if (openDay === jsDay) {
      opensAtMin =
        opensAtMin == null ? openMin : Math.min(opensAtMin, openMin);
    }
    if (close?.day == null || close.hour == null) continue;
    const closeMin = close.hour * 60 + (close.minute ?? 0);
    if (close.day !== openDay && openDay === jsDay) {
      closesAtMin =
        closesAtMin == null
          ? closeMin + 24 * 60
          : Math.max(closesAtMin, closeMin + 24 * 60);
      continue;
    }
    if (close.day === jsDay || openDay === jsDay) {
      closesAtMin =
        closesAtMin == null ? closeMin : Math.max(closesAtMin, closeMin);
    }
  }
  return { opensAtMin, closesAtMin };
}

function mapsKey(): string {
  return env.googleMapsApiKey() || '';
}

function normalizePlaceResourceId(placeId: string): string {
  const id = placeId.trim();
  if (!id) return '';
  return id.startsWith('places/') ? id : `places/${id}`;
}

function legacyPlaceId(placeId: string): string {
  return placeId.replace(/^places\//, '').trim();
}

/**
 * Place Details (New) — Basis Enterprise; Atmosphere (Reviews/Editorial) nur on-demand.
 * Legacy Details nur wenn New hart fehlschlägt.
 */
export async function fetchPlacePitchDetails(opts: {
  placeId?: string | null;
  query?: string | null;
  lat: number;
  lng: number;
  signal?: AbortSignal;
  /**
   * Reviews + Editorial/Generative Summary (Enterprise + Atmosphere).
   * Default false — nur Maps-Pitch / „Mehr dazu“ setzen true.
   */
  includeAtmosphere?: boolean;
}): Promise<PlacePitchDetails | null> {
  if (!hasGoogleMapsNavKey()) return null;

  const includeAtmosphere = Boolean(opts.includeAtmosphere);
  let placeId = (opts.placeId || '').trim();
  if (!placeId || placeId.startsWith('text:') || placeId.startsWith('new:') || placeId.startsWith('osm:')) {
    const q = (opts.query || '').trim();
    if (q.length < 2) return null;
    const hits = await searchPlacesByText({
      query: q,
      lat: opts.lat,
      lng: opts.lng,
      radiusM: 20_000,
      enrich: true,
    });
    placeId = hits[0]?.placeId ?? '';
    if (!placeId) return null;
  }

  const resource = normalizePlaceResourceId(placeId);
  const baseFields = [
    'id',
    'displayName',
    'types',
    'rating',
    'userRatingCount',
    'formattedAddress',
    'websiteUri',
    'nationalPhoneNumber',
    'internationalPhoneNumber',
    'location',
    'priceLevel',
    'currentOpeningHours.openNow',
    'regularOpeningHours.periods',
  ];
  const atmosphereFields = [
    'editorialSummary',
    'generativeSummary',
    'reviews',
  ];
  const fieldMask = [
    ...baseFields,
    ...(includeAtmosphere ? atmosphereFields : []),
  ].join(',');

  try {
    const res = await fetch(`https://places.googleapis.com/v1/${resource}`, {
      method: 'GET',
      signal: opts.signal,
      headers: {
        'X-Goog-Api-Key': mapsKey(),
        'X-Goog-FieldMask': fieldMask,
        'Accept-Language': 'de',
      },
    });
    if (res.ok) {
      const r = (await res.json()) as {
        id?: string;
        displayName?: { text?: string };
        types?: string[];
        rating?: number;
        userRatingCount?: number;
        editorialSummary?: { text?: string };
        generativeSummary?: { overview?: { text?: string } };
        formattedAddress?: string;
        websiteUri?: string;
        nationalPhoneNumber?: string;
        internationalPhoneNumber?: string;
        location?: { latitude?: number; longitude?: number };
        priceLevel?: string | number;
        currentOpeningHours?: { openNow?: boolean };
        regularOpeningHours?: { periods?: PlaceHoursPeriod[] };
        reviews?: Array<{
          rating?: number;
          text?: { text?: string };
          relativePublishTimeDescription?: string;
        }>;
      };
      const reviews: PlaceReviewSnippet[] = includeAtmosphere
        ? (r.reviews ?? [])
            .map((rev) => ({
              rating: typeof rev.rating === 'number' ? rev.rating : null,
              text: (rev.text?.text ?? '').replace(/\s+/g, ' ').trim(),
              relativeTime: rev.relativePublishTimeDescription ?? null,
            }))
            .filter((x) => x.text.length > 20)
            .slice(0, 5)
        : [];
      return {
        placeId: r.id ?? resource,
        name: (r.displayName?.text ?? opts.query ?? '').trim() || 'Ort',
        types: r.types ?? [],
        rating: typeof r.rating === 'number' ? r.rating : null,
        ratingCount:
          typeof r.userRatingCount === 'number' ? r.userRatingCount : null,
        editorialSummary: includeAtmosphere
          ? r.editorialSummary?.text?.trim() || null
          : null,
        generativeSummary: includeAtmosphere
          ? r.generativeSummary?.overview?.text?.trim() || null
          : null,
        formattedAddress: r.formattedAddress?.trim() || null,
        websiteUri: sanitizePlaceWebsiteUri(r.websiteUri),
        phoneNumber:
          (r.internationalPhoneNumber || r.nationalPhoneNumber || '').trim() ||
          null,
        openNow:
          r.currentOpeningHours?.openNow === true
            ? true
            : r.currentOpeningHours?.openNow === false
              ? false
              : null,
        priceLevel: parsePlacesPriceLevel(r.priceLevel),
        regularOpeningHoursPeriods: r.regularOpeningHours?.periods ?? [],
        reviews,
        lat: r.location?.latitude ?? null,
        lng: r.location?.longitude ?? null,
      };
    }
    // Nicht-OK aber erreichbar → kein Legacy (spart doppelte Details-Rechnung)
    if (res.status < 500 && res.status !== 404) {
      return null;
    }
  } catch {
    /* Legacy fallback only on hard failure */
  }

  try {
    const u = new URL(
      'https://maps.googleapis.com/maps/api/place/details/json',
    );
    u.searchParams.set('place_id', legacyPlaceId(placeId));
    const legacyFields = includeAtmosphere
      ? 'place_id,name,types,rating,user_ratings_total,reviews,editorial_summary,formatted_address,website,international_phone_number,geometry,opening_hours,price_level'
      : 'place_id,name,types,rating,user_ratings_total,formatted_address,website,international_phone_number,geometry,opening_hours,price_level';
    u.searchParams.set('fields', legacyFields);
    u.searchParams.set('language', 'de');
    if (includeAtmosphere) {
      u.searchParams.set('reviews_sort', 'most_relevant');
    }
    u.searchParams.set('key', mapsKey());
    const res = await fetch(u.toString(), { signal: opts.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: {
        place_id?: string;
        name?: string;
        types?: string[];
        rating?: number;
        user_ratings_total?: number;
        editorial_summary?: { overview?: string };
        formatted_address?: string;
        website?: string;
        international_phone_number?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
        opening_hours?: { open_now?: boolean };
        price_level?: number;
        reviews?: Array<{
          rating?: number;
          text?: string;
          relative_time_description?: string;
        }>;
      };
    };
    const r = data.result;
    if (!r?.name) return null;
    const reviews: PlaceReviewSnippet[] = includeAtmosphere
      ? (r.reviews ?? [])
          .map((rev) => ({
            rating: typeof rev.rating === 'number' ? rev.rating : null,
            text: (rev.text ?? '').replace(/\s+/g, ' ').trim(),
            relativeTime: rev.relative_time_description ?? null,
          }))
          .filter((x) => x.text.length > 20)
          .slice(0, 5)
      : [];
    return {
      placeId: r.place_id ?? placeId,
      name: r.name.trim(),
      types: r.types ?? [],
      rating: typeof r.rating === 'number' ? r.rating : null,
      ratingCount:
        typeof r.user_ratings_total === 'number' ? r.user_ratings_total : null,
      editorialSummary: includeAtmosphere
        ? r.editorial_summary?.overview?.trim() || null
        : null,
      generativeSummary: null,
      formattedAddress: r.formatted_address?.trim() || null,
      websiteUri: sanitizePlaceWebsiteUri(r.website),
      phoneNumber: r.international_phone_number?.trim() || null,
      openNow:
        r.opening_hours?.open_now === true
          ? true
          : r.opening_hours?.open_now === false
            ? false
            : null,
      priceLevel:
        typeof r.price_level === 'number'
          ? parsePlacesPriceLevel(r.price_level)
          : null,
      regularOpeningHoursPeriods: [],
      reviews,
      lat: r.geometry?.location?.lat ?? null,
      lng: r.geometry?.location?.lng ?? null,
    };
  } catch {
    return null;
  }
}

/** Sterne-Sprache: nur bei ≥20 Bewertungen; nie Rohzahl vorlesen. */
export function ratingSpeechLabel(
  rating: number | null | undefined,
  ratingCount: number | null | undefined,
): string | null {
  if (rating == null || (ratingCount ?? 0) < 20) return null;
  if (rating >= 4.5) return 'super bewertet';
  if (rating >= 4.0) return 'gut bewertet';
  return null;
}
