/**
 * Find airport / Flugplatz near user or city pack.
 * Prefers local POI tags, then geocode.
 */

import { getAllPois, haversineMeters } from '../../db/database';
import type { Poi } from '../../db/types';
import { getCachedUserProfile } from '../userProfileService';
import { geocodePlaceName } from '../navigation/googleMapsNav';

export type AirportPoiHit = {
  name: string;
  lat: number;
  lng: number;
  poiId: number | null;
  distanceM: number | null;
  source: 'pack' | 'geocode';
};

const AIRPORT_BLOB =
  /\b(flugplatz|flughafen|airport|airfield|edwg|harle|verkehrslandeplatz)\b/i;

function poiBlob(p: Poi): string {
  return `${p.name} ${p.category ?? ''} ${p.spot_key ?? ''} ${p.tags_json ?? ''}`;
}

/**
 * Nearest Flugplatz/Flughafen in the city pack, else geocode city airfield.
 */
export async function findAirportPoi(opts?: {
  lat?: number | null;
  lng?: number | null;
  hint?: string | null;
}): Promise<AirportPoiHit | null> {
  const profile = getCachedUserProfile();
  const originLat = opts?.lat ?? null;
  const originLng = opts?.lng ?? null;
  const hint = (opts?.hint ?? '').trim().toLowerCase();

  try {
    const pois = await getAllPois();
    let best: Poi | null = null;
    let bestD = Number.POSITIVE_INFINITY;

    for (const p of pois) {
      if (p.kind === 'approach') continue;
      const blob = poiBlob(p);
      if (!AIRPORT_BLOB.test(blob)) {
        if (hint && !blob.toLowerCase().includes(hint)) continue;
        if (!hint) continue;
      }
      if (originLat != null && originLng != null) {
        const d = haversineMeters(originLat, originLng, p.lat, p.lng);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      } else if (!best) {
        best = p;
        bestD = 0;
      }
    }

    if (best) {
      return {
        name: best.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim(),
        lat: best.lat,
        lng: best.lng,
        poiId: best.id,
        distanceM:
          originLat != null && originLng != null && Number.isFinite(bestD)
            ? Math.round(bestD)
            : null,
        source: 'pack',
      };
    }
  } catch {
    /* soft */
  }

  const city = profile?.cityName?.trim() || profile?.cityId || '';
  const queries = [
    hint ? `Flugplatz ${hint}` : null,
    city ? `Flugplatz ${city}` : null,
    city ? `Flughafen ${city}` : null,
    city.toLowerCase() === 'wangerooge' ? 'Flugplatz Wangerooge EDWG' : null,
  ].filter(Boolean) as string[];

  for (const q of queries) {
    try {
      const geo = await geocodePlaceName(q, {
        biasLat: originLat ?? undefined,
        biasLng: originLng ?? undefined,
        cityHint: city || null,
      });
      if (!geo) continue;
      const d =
        originLat != null && originLng != null
          ? Math.round(
              haversineMeters(originLat, originLng, geo.lat, geo.lng),
            )
          : null;
      return {
        name: geo.label.split(',')[0]?.trim() || q,
        lat: geo.lat,
        lng: geo.lng,
        poiId: null,
        distanceM: d,
        source: 'geocode',
      };
    } catch {
      /* try next */
    }
  }

  return null;
}
