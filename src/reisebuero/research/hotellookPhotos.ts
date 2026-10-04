/**
 * Hotellook/Travelpayouts Hotelbilder über hotelId — ohne Google.
 * CDN: image_v2/limit/h{hotelId}_{index}/…  (nicht h{id} ohne Index).
 */

const photoCache = new Map<string, string | null>();

export function hotellookHotelIdFromRow(row: {
  hotelId?: number | string | null;
  id?: number | string | null;
  hotel_id?: number | string | null;
}): string | null {
  for (const v of [row.hotelId, row.id, row.hotel_id]) {
    const n = String(v ?? '').replace(/\D/g, '');
    if (/^\d{3,}$/.test(n)) return n;
  }
  return null;
}

/** Erstes Foto: Gallery-Index `h{id}_1` oder globale Photo-ID. */
export function hotellookPhotoCdnUrl(
  hotelId: string | number,
  photoToken: string | number,
): string {
  if (typeof photoToken === 'string' && /^https?:\/\//i.test(photoToken)) {
    return photoToken;
  }
  const n = Number(photoToken);
  if (Number.isFinite(n) && n >= 0 && n < 80) {
    const idx = n === 0 ? 1 : n;
    return `https://photo.hotellook.com/image_v2/limit/h${hotelId}_${idx}/800/520.auto`;
  }
  return `https://photo.hotellook.com/image_v2/limit/${photoToken}/800/520.auto`;
}

export function hotellookHotelHeroUrl(hotelId: string | number): string {
  return `https://photo.hotellook.com/image_v2/limit/h${hotelId}_1/800/520.auto`;
}

/** Expedia/Hotellook-Galerie: h{id}_1 … h{id}_n — echte Hotelzimmer-/Lobby-Fotos. */
export function hotellookHotelGalleryUrls(
  hotelId: string | number,
  count = 8,
): string[] {
  const id = String(hotelId).replace(/\D/g, '');
  if (!/^\d{3,}$/.test(id)) return [];
  const n = Math.max(1, Math.min(24, Math.floor(count) || 8));
  return Array.from({ length: n }, (_, i) => hotellookPhotoCdnUrl(id, i + 1));
}

/** Hotel-ID aus Stay-Id (`hl-418520`), CDN-URL oder Roh-Id. */
export function hotellookIdFromStayRef(ref: string | null | undefined): string | null {
  const s = String(ref || '').trim();
  if (!s) return null;
  const fromHl = s.match(/^hl-(\d{3,})$/i);
  if (fromHl?.[1]) return fromHl[1];
  const fromCdn = s.match(/\/h(\d{3,})_\d+\//i);
  if (fromCdn?.[1]) return fromCdn[1];
  const digits = s.replace(/\D/g, '');
  if (/^\d{3,}$/.test(digits) && digits === s.replace(/^hl-/i, '')) return digits;
  return null;
}

function firstPhotoToken(raw: unknown): string | number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (/^https?:\/\//i.test(t)) return t;
    if (/^\d+$/.test(t)) return t;
    return null;
  }
  if (Array.isArray(raw) && raw.length) return firstPhotoToken(raw[0]);
  if (typeof raw === 'object') {
    const o = raw as { url?: string; id?: number | string; photoId?: number | string };
    if (typeof o.url === 'string' && /^https?:\/\//i.test(o.url)) return o.url;
    if (o.id != null) return firstPhotoToken(o.id);
    if (o.photoId != null) return firstPhotoToken(o.photoId);
  }
  return null;
}

export function photoUrlFromCacheRow(
  row: {
    hotelId?: number | string | null;
    id?: number | string | null;
    hotel_id?: number | string | null;
    photos?: unknown;
    photoIds?: unknown;
    photoId?: number | string | null;
  },
): string | null {
  const hotelId = hotellookHotelIdFromRow(row);
  const token =
    firstPhotoToken(row.photos) ||
    firstPhotoToken(row.photoIds) ||
    firstPhotoToken(row.photoId);
  if (token != null && hotelId) return hotellookPhotoCdnUrl(hotelId, token);
  if (token != null && typeof token === 'string' && /^https?:\/\//i.test(token)) return token;
  if (hotelId) return hotellookHotelHeroUrl(hotelId);
  return null;
}

export function firstPhotoIdFromHotelPhotosPayload(
  data: unknown,
  hotelId: string,
): string | number | null {
  if (!data || typeof data !== 'object') return null;
  const rec = data as Record<string, unknown>;
  return (
    firstPhotoToken(rec[hotelId]) ||
    firstPhotoToken(rec[String(Number(hotelId))]) ||
    null
  );
}

export async function fetchHotellookPhotoMap(
  hotelIds: Array<string | number>,
  token: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(hotelIds.map((id) => String(id).replace(/\D/g, '')).filter(Boolean))];
  const missing = ids.filter((id) => !photoCache.has(id));
  if (!missing.length) {
    for (const id of ids) {
      const u = photoCache.get(id);
      if (u) out.set(id, u);
    }
    return out;
  }
  try {
    const u = new URL('https://yasen.hotellook.com/photos/hotel_photos');
    u.searchParams.set('id', missing.slice(0, 24).join(','));
    if (token) u.searchParams.set('token', token);
    const res = await fetch(u.toString(), {
      headers: { Accept: 'application/json', 'X-Access-Token': token },
    });
    if (res.ok) {
      const data = (await res.json()) as unknown;
      for (const id of missing) {
        const tokenId = firstPhotoIdFromHotelPhotosPayload(data, id);
        const url =
          tokenId != null ? hotellookPhotoCdnUrl(id, tokenId) : hotellookHotelHeroUrl(id);
        photoCache.set(id, url);
        out.set(id, url);
      }
    } else {
      for (const id of missing) {
        const url = hotellookHotelHeroUrl(id);
        photoCache.set(id, url);
        out.set(id, url);
      }
    }
  } catch {
    for (const id of missing) {
      const url = hotellookHotelHeroUrl(id);
      photoCache.set(id, url);
      out.set(id, url);
    }
  }
  for (const id of ids) {
    if (out.has(id)) continue;
    const cached = photoCache.get(id);
    if (cached) out.set(id, cached);
    else out.set(id, hotellookHotelHeroUrl(id));
  }
  return out;
}
