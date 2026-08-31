/**
 * Belegte Orts-Links (Maps / Speisekarte / Website / Reserve) mergen.
 * Keine erfundenen Menü-URLs — Maps-Pin nur aus echten Koordinaten.
 */

export type PlaceActionUrls = {
  mapsUrl?: string | null;
  menuUrl?: string | null;
  reserveUrl?: string | null;
  websiteUrl?: string | null;
};

function firstHttp(
  ...xs: Array<string | null | undefined>
): string | null {
  for (const x of xs) {
    const s = String(x ?? '').trim();
    if (/^https?:\/\//i.test(s)) return s;
  }
  return null;
}

export function mergePlaceActionUrls(
  ...parts: Array<PlaceActionUrls | null | undefined>
): PlaceActionUrls {
  return {
    mapsUrl: firstHttp(...parts.map((p) => p?.mapsUrl)),
    menuUrl: firstHttp(...parts.map((p) => p?.menuUrl)),
    reserveUrl: firstHttp(...parts.map((p) => p?.reserveUrl)),
    websiteUrl: firstHttp(...parts.map((p) => p?.websiteUrl)),
  };
}

export function mapsPinUrl(
  lat: number,
  lng: number,
  name?: string | null,
): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const n = String(name ?? '')
    .replace(/^\d+\s*·\s*/, '')
    .trim();
  const q = n ? `${n} @${lat},${lng}` : `${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function placeUrlsEqual(
  a: PlaceActionUrls,
  b: PlaceActionUrls,
): boolean {
  return (
    (a.mapsUrl ?? null) === (b.mapsUrl ?? null) &&
    (a.menuUrl ?? null) === (b.menuUrl ?? null) &&
    (a.reserveUrl ?? null) === (b.reserveUrl ?? null) &&
    (a.websiteUrl ?? null) === (b.websiteUrl ?? null)
  );
}
