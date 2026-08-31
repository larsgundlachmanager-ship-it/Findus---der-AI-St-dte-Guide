/**
 * Tennisclub-Vorschläge für Planung (Hotel nahe Tennis / Tennisturnier).
 * Leichtgewichtig: Geocode + Places — keine erfundenen Clubs.
 */

import { geocodePlaceName } from '../../services/navigation/googleMapsNav';
import { searchOpenPlacesAhead } from '../../services/navigation/googleMapsNav';
import { extractCityFromText } from '../context/shortTermContext';

export type TennisVenueHint = {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
};

function dedupeHints(items: TennisVenueHint[]): TennisVenueHint[] {
  const out: TennisVenueHint[] = [];
  for (const h of items) {
    const key = h.name.toLowerCase().replace(/\s+/g, ' ');
    if (out.some((x) => x.name.toLowerCase().replace(/\s+/g, ' ') === key)) {
      continue;
    }
    out.push(h);
  }
  return out.slice(0, 3);
}

/** Kurz recherchieren: 1–2 plausible Tennisclubs in der Stadt. */
export async function suggestTennisClubsInCity(
  city: string,
): Promise<TennisVenueHint[]> {
  const c = (city || extractCityFromText(city) || '').trim();
  if (!c) return [];

  const hints: TennisVenueHint[] = [];

  try {
    const center = await geocodePlaceName(c, { cityHint: c });
    if (center?.lat != null && center.lng != null) {
      const queries = [
        `Tennisclub ${c}`,
        `TC ${c}`,
        `Tennisturnier ${c}`,
      ];
      for (const q of queries) {
        try {
          const geo = await geocodePlaceName(q, { cityHint: c });
          if (geo?.lat != null && geo.lng != null && geo.label) {
            hints.push({
              name: geo.label.split(',')[0]!.trim().slice(0, 48),
              address: geo.label.slice(0, 80),
              lat: geo.lat,
              lng: geo.lng,
            });
          }
        } catch {
          /* soft */
        }
      }

      try {
        const places = await searchOpenPlacesAhead({
          lat: center.lat,
          lng: center.lng,
          placeType: 'sports_centre',
          radiusM: 12_000,
          keyword: 'tennis',
          openNow: false,
        });
        for (const p of places.slice(0, 4)) {
          if (!/tennis|tc\b|thc|club/i.test(p.name)) continue;
          hints.push({
            name: p.name.slice(0, 48),
            address: null,
            lat: p.lat,
            lng: p.lng,
          });
        }
      } catch {
        /* soft */
      }
    }
  } catch {
    /* soft */
  }

  return dedupeHints(hints).slice(0, 2);
}

export function cityFromPlanBlob(blob: string): string {
  return extractCityFromText(blob) || '';
}
