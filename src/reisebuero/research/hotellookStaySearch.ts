/**
 * Hotellook / Travelpayouts Hotel-Cache — Live-Preise ohne Stay22.
 * Token = EXPO_PUBLIC_TRAVELPAYOUTS_TOKEN (bereits für Flüge).
 */

import type { HotelLiveStay } from '../../services/concierge/hotelAvailabilityService';
import { env } from '../../config/env';
import { cityStayQueryAliases } from './cityStayAliases';
import {
  fetchHotellookPhotoMap,
  hotellookHotelIdFromRow,
  photoUrlFromCacheRow,
} from './hotellookPhotos';
import { searchOsmPhotoNearby } from './osmPlacePhoto';
import { fetchWikiThumb } from './wikiThumb';

export { cityStayQueryAliases };

type CacheRow = {
  hotelName?: string;
  hotelId?: number | string;
  id?: number | string;
  hotel_id?: number | string;
  priceFrom?: number;
  priceAvg?: number;
  stars?: number;
  location?: { lat?: number; lon?: number };
  hotelNameOriginal?: string;
  photos?: unknown;
  photoIds?: unknown;
  photoId?: number | string;
};

function token(): string {
  return env.travelpayoutsToken() || '';
}

function marker(): string {
  return env.travelpayoutsMarker() || '760293';
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

async function fillMissingStayPhotos(stays: HotelLiveStay[]): Promise<void> {
  const missing = stays.filter((s) => !s.photoUrl).slice(0, 4);
  await Promise.all(
    missing.map(async (s) => {
      try {
        if (s.lat != null && s.lng != null) {
          const osm = await searchOsmPhotoNearby({
            lat: s.lat,
            lng: s.lng,
            kind: 'hotel',
            radiusM: 600,
            nameHint: s.name,
          });
          if (osm?.photoUrl) {
            s.photoUrl = osm.photoUrl;
            return;
          }
          if (osm?.wikipedia) {
            const w = await fetchWikiThumb(osm.wikipedia, [s.name]);
            if (w) {
              s.photoUrl = w;
              return;
            }
          }
        }
        const words = s.name.trim().split(/\s+/).filter(Boolean);
        if (words.length >= 2) {
          const w = await fetchWikiThumb(s.name);
          if (w) s.photoUrl = w;
        }
      } catch {
        /* soft */
      }
    }),
  );
}

async function bookUrl(
  city: string,
  hotelName: string,
  checkin: string,
  checkout: string,
  adults: number,
  expediaPropertyId?: string | null,
): Promise<string> {
  let raw = '';
  try {
    const { getExpediaAccommodationUrl } = await import(
      '../../services/affiliate/affiliateService'
    );
    raw = getExpediaAccommodationUrl(`${hotelName}, ${city}`.slice(0, 120), {
      checkin,
      checkout,
      adults,
    });
  } catch {
    const q = new URLSearchParams({
      destination: `${hotelName} ${city}`.slice(0, 100),
      checkIn: checkin,
      checkOut: checkout,
      adults: String(adults),
      marker: marker(),
      currency: 'eur',
      language: 'de',
    });
    raw = `https://search.hotellook.com/hotels?${q.toString()}`;
  }
  try {
    const { finalizeHotelBookAffiliateUrl } = await import(
      '../../services/affiliate/hotelPropertyDeepLink'
    );
    return finalizeHotelBookAffiliateUrl({
      hotelName,
      city,
      bookUrl: raw,
      checkin,
      checkout,
      adults,
      expediaPropertyId,
    });
  } catch {
    return raw;
  }
}

/**
 * Live-Preise aus Hotellook-Cache (wenn Token gesetzt).
 */
export async function searchHotellookStaysInCity(opts: {
  city: string;
  checkin: string;
  checkout: string;
  adults: number;
  lat?: number | null;
  lng?: number | null;
  limit?: number;
}): Promise<{ stays: HotelLiveStay[]; error?: string }> {
  const tok = token();
  if (!tok) return { stays: [], error: 'no_tp_token' };

  const aliases = cityStayQueryAliases(opts.city);
  const limit = opts.limit ?? 12;
  const adults = Math.max(1, opts.adults || 2);

  for (const location of aliases) {
    try {
      const u = new URL('https://yasen.hotellook.com/api/v2/cache.json');
      u.searchParams.set('location', location);
      u.searchParams.set('checkIn', opts.checkin);
      u.searchParams.set('checkOut', opts.checkout);
      u.searchParams.set('currency', 'eur');
      u.searchParams.set('limit', String(limit));
      u.searchParams.set('token', tok);
      if (opts.lat != null && opts.lng != null) {
        u.searchParams.set('latitude', String(opts.lat));
        u.searchParams.set('longitude', String(opts.lng));
      }

      const res = await fetch(u.toString(), {
        headers: { Accept: 'application/json', 'X-Access-Token': tok },
      });
      if (!res.ok) {
        if (res.status === 404 || res.status === 401) continue;
        return { stays: [], error: `hotellook HTTP ${res.status}` };
      }
      const data = (await res.json()) as CacheRow[] | { error?: string };
      if (!Array.isArray(data)) continue;

      const out: HotelLiveStay[] = [];
      const photoIds: Array<string | number> = [];
      for (const row of data) {
        const name = String(row.hotelName || row.hotelNameOriginal || '').trim();
        const price = Number(row.priceFrom ?? row.priceAvg ?? 0);
        if (!name || !(price > 0)) continue;
        const nights = Math.max(
          1,
          Math.round(
            (Date.parse(`${opts.checkout}T12:00:00`) -
              Date.parse(`${opts.checkin}T12:00:00`)) /
              86_400_000,
          ),
        );
        let total = price;
        if (nights >= 2 && price < 90) total = Math.round(price * nights);
        if (adults >= 3 && total < 200 * nights) {
          total = Math.round(total * 1.45);
        }

        const hotelId = hotellookHotelIdFromRow(row) || '';
        if (/^\d+$/.test(hotelId)) photoIds.push(hotelId);
        const book = await bookUrl(location, name, opts.checkin, opts.checkout, adults, null);
        out.push({
          id: `hl-${hotelId || slug(name)}`,
          name,
          priceTotal: total,
          currency: 'EUR',
          bookUrl: book,
          stars: typeof row.stars === 'number' ? row.stars : null,
          lat: row.location?.lat ?? opts.lat ?? undefined,
          lng: row.location?.lon ?? opts.lng ?? undefined,
          amenities: [],
          supplier: 'hotellook',
          expediaPropertyId: null,
          photoUrl: photoUrlFromCacheRow(row),
          rating: null,
        });
        if (out.length >= 8) break;
      }
      if (out.length) {
        try {
          const photos = await fetchHotellookPhotoMap(photoIds, tok);
          for (const s of out) {
            const hid = s.id.replace(/^hl-/, '');
            const url = photos.get(hid);
            if (url) s.photoUrl = url;
          }
        } catch {
          /* soft — OSM/Wiki unten */
        }
        await fillMissingStayPhotos(out);
        out.sort((a, b) => (a.priceTotal ?? 9e9) - (b.priceTotal ?? 9e9));
        return { stays: out };
      }
    } catch (e) {
      return { stays: [], error: String(e).slice(0, 80) };
    }
  }
  return { stays: [], error: 'hotellook_empty' };
}
