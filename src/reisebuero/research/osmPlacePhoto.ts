/**
 * OSM-Fotos (€0): image / Wikimedia / Wikipedia-Tag am POI.
 * Google Places erst, wenn OSM keinen Treffer liefert.
 */

export type OsmPhotoHit = {
  name: string;
  lat: number;
  lng: number;
  distM: number;
  photoUrl: string | null;
  website: string | null;
  wikipedia?: string | null;
};

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const;

function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Wikimedia File:… oder direkte Commons-URL → FilePath. */
export function commonsFileUrl(raw: string): string | null {
  const t = (raw || '').trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) {
    if (/upload\.wikimedia\.org|commons\.wikimedia\.org\/wiki\/Special:FilePath/i.test(t)) {
      return t;
    }
    if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(t) && !/facebook|instagram/i.test(t)) {
      return t;
    }
    return null;
  }
  if (/^Category:/i.test(t)) return null;
  const file = t.replace(/^(File:|Datei:)/i, '').trim();
  if (!file || file.length < 4) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=900`;
}

export function wikipediaTitleFromOsmTag(tag: string): string | null {
  const t = (tag || '').trim();
  if (!t) return null;
  const m = t.match(/^(?:de|en|es|fr|it|pt):(.+)$/i);
  return (m?.[1] || t).replace(/_/g, ' ').trim() || null;
}

type OverpassEl = {
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

function amenityFilters(kind: string): string[] {
  const k = kind.toLowerCase();
  if (k === 'nightclub' || k === 'club') {
    return ['["amenity"="nightclub"]', '["amenity"="bar"]', '["leisure"="dance"]'];
  }
  if (k === 'hotel' || k === 'stay') return ['["tourism"="hotel"]', '["tourism"="guest_house"]'];
  if (k === 'beach' || k === 'sand' || k === 'sea') return ['["natural"="beach"]'];
  if (k === 'padel' || k === 'tennis') {
    return ['["leisure"="pitch"]', '["sport"="padel"]', '["sport"="tennis"]'];
  }
  if (k === 'stadium') return ['["leisure"="stadium"]', '["amenity"="stadium"]'];
  if (k === 'attraction' || k === 'sight' || k === 'tour') {
    return ['["tourism"="attraction"]', '["tourism"="museum"]', '["tourism"="viewpoint"]'];
  }
  return ['["tourism"]', '["amenity"]'];
}

function buildQuery(opts: {
  lat: number;
  lng: number;
  radiusM: number;
  kind: string;
  nameHint?: string | null;
}): string {
  const around = `(around:${Math.round(opts.radiusM)},${opts.lat},${opts.lng})`;
  const parts: string[] = [];
  for (const f of amenityFilters(opts.kind)) {
    parts.push(`node${around}${f};`);
    parts.push(`way${around}${f};`);
  }
  const hint = (opts.nameHint || '').replace(/["\\]/g, '').trim();
  if (hint.length >= 3) {
    const re = hint.slice(0, 40);
    for (const f of amenityFilters(opts.kind)) {
      parts.push(`node${around}${f}["name"~"${re}",i];`);
      parts.push(`way${around}${f}["name"~"${re}",i];`);
    }
  }
  return `[out:json][timeout:8];(${parts.join('')});out center tags 32;`;
}

function photoFromTags(tags: Record<string, string>): string | null {
  return (
    commonsFileUrl(tags.image || '') ||
    commonsFileUrl(tags.wikimedia_commons || '') ||
    commonsFileUrl(tags.wikimedia || '') ||
    null
  );
}

function osmHitScore(h: OsmPhotoHit): number {
  return (h.photoUrl ? 40 : 0) + (h.website ? 10 : 0) + (h.wikipedia ? 8 : 0) - h.distM / 80;
}

export async function searchOsmPhotoNearby(opts: {
  lat: number;
  lng: number;
  kind: string;
  radiusM?: number;
  nameHint?: string | null;
}): Promise<OsmPhotoHit | null> {
  const radius = Math.max(80, Math.min(opts.radiusM ?? 8000, 20_000));
  const query = buildQuery({ ...opts, radiusM: radius });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    for (const endpoint of OVERPASS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal: ctrl.signal,
        });
        if (!res.ok) continue;
        const data = (await res.json()) as { elements?: OverpassEl[] };
        let best: OsmPhotoHit | null = null;
        for (const el of data.elements ?? []) {
          const lat = el.lat ?? el.center?.lat;
          const lng = el.lon ?? el.center?.lon;
          if (lat == null || lng == null) continue;
          const tags = el.tags ?? {};
          const name = (tags.name || tags.brand || '').trim();
          if (!name) continue;
          const distM = Math.round(
            haversineM({ lat: opts.lat, lng: opts.lng }, { lat, lng }),
          );
          if (distM > radius + 40) continue;
          const cand: OsmPhotoHit = {
            name,
            lat,
            lng,
            distM,
            photoUrl: photoFromTags(tags),
            website: (tags.website || tags['contact:website'] || '').trim() || null,
            wikipedia: wikipediaTitleFromOsmTag(tags.wikipedia || tags['wikipedia:de'] || ''),
          };
          if (!best || osmHitScore(cand) > osmHitScore(best)) best = cand;
        }
        if (best) return best;
      } catch {
        if (ctrl.signal.aborted) break;
      }
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
