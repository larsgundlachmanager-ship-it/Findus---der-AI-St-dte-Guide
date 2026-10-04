/**
 * Foto-Kaskade für Magazin-Beats/Wünsche:
 * OSM (€0) → Wikipedia/Web → Beat-Wiki → Google Places zuletzt.
 * Kein Stadt-/Hotel-Klon auf Clubs.
 */

import { fetchWikiThumb } from './wikiThumb';
import { searchOsmPhotoNearby } from './osmPlacePhoto';


/** Immer verfuegbares Titelbild aus GPS (Wikimedia OSM-Static). */
export function staticMapTitlePhoto(
  lat?: number | null,
  lng?: number | null,
  zoom = 12,
): string | null {
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }
  const z = Math.max(5, Math.min(15, Math.round(zoom)));
  return (
    'https://maps.wikimedia.org/img/osm-intl,' +
    z +
    ',' +
    lat.toFixed(5) +
    ',' +
    lng.toFixed(5) +
    ',900x560.png'
  );
}

export type PhotoResolveKind =
  | 'destination'
  | 'stay'
  | 'club'
  | 'beach'
  | 'activity'
  | 'stadium'
  | 'sight'
  | 'tour'
  | 'padel'
  | 'tennis'
  | 'other';

function osmKind(kind: PhotoResolveKind): string {
  if (kind === 'club') return 'nightclub';
  if (kind === 'stay') return 'hotel';
  if (kind === 'beach') return 'beach';
  if (kind === 'padel' || kind === 'tennis') return kind;
  if (kind === 'stadium') return 'stadium';
  if (kind === 'sight' || kind === 'tour') return 'attraction';
  return 'attraction';
}

function mapsKey(): string {
  try {
    const { env } = require('../../config/env') as { env: { get: (k: string) => string } };
    return (
      env.get('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY') ||
      env.get('EXPO_PUBLIC_GOOGLE_API_KEY') ||
      ''
    ).trim();
  } catch {
    return '';
  }
}

async function googlePlacePhoto(opts: {
  lat: number;
  lng: number;
  query: string;
  radiusM: number;
}): Promise<string | null> {
  const key = mapsKey();
  if (!key) return null;
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.photos,places.displayName,places.location',
      },
      body: JSON.stringify({
        textQuery: opts.query,
        maxResultCount: 3,
        languageCode: 'de',
        locationBias: {
          circle: {
            center: { latitude: opts.lat, longitude: opts.lng },
            radius: Math.min(opts.radiusM, 12000),
          },
        },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { places?: Array<{ photos?: Array<{ name?: string }> }> };
    const photoName = data.places?.[0]?.photos?.[0]?.name;
    if (!photoName) return null;
    return `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=900&key=${encodeURIComponent(key)}`;
  } catch {
    return null;
  }
}

export async function resolveLocatedPhoto(opts: {
  kind: PhotoResolveKind;
  lat: number;
  lng: number;
  name?: string | null;
  placeName?: string | null;
  radiusM?: number;
  existing?: string | null;
}): Promise<{ photoUrl: string | null; name?: string | null; website?: string | null; distM?: number | null }> {
  if (opts.existing) {
    return { photoUrl: opts.existing, name: opts.name };
  }
  const radius = opts.radiusM ?? 8000;
  const hint = (opts.name || '').trim();
  const osm = await searchOsmPhotoNearby({
    lat: opts.lat,
    lng: opts.lng,
    kind: osmKind(opts.kind),
    radiusM: radius,
    nameHint: hint || opts.placeName || null,
  });
  if (osm?.photoUrl) {
    return { photoUrl: osm.photoUrl, name: osm.name, website: osm.website, distM: osm.distM };
  }
  const wikiTitles = [osm?.wikipedia, osm?.name, hint, opts.placeName].filter(Boolean) as string[];
  if (wikiTitles.length) {
    const wiki = await fetchWikiThumb(wikiTitles[0]!, wikiTitles.slice(1));
    if (wiki) {
      return {
        photoUrl: wiki,
        name: osm?.name || hint,
        website: osm?.website,
        distM: osm?.distM,
      };
    }
  }
  if (osm) {
    return { photoUrl: null, name: osm.name, website: osm.website, distM: osm.distM };
  }
  const q = [hint, opts.placeName].filter(Boolean).join(' ').trim();
  if (!q) return { photoUrl: null };
  const maps = await googlePlacePhoto({
    lat: opts.lat,
    lng: opts.lng,
    query: q,
    radiusM: radius,
  });
  return { photoUrl: maps, name: hint || opts.placeName };
}
