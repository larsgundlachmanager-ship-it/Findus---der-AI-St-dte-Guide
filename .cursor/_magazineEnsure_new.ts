/**
 * Magazin „perfekt machen“: fehlende Fotos/Summary/Beats nachziehen.
 * Pflicht: Hero + Unterkunft haben immer ein Live-Foto (Kaskade, kein leeres Grün).
 */

import type { JourneyBeat, ReiseLedger, ReiseOption, StayChoice } from '../types';
import {
  beatPhotoWikiTitles,
  enrichOptionMagazine,
} from './storyMagazine';
import { harvestWishEvidence, type WishEvidence } from './wishEvidenceHarvest';
import { fetchWikiThumb, wikiTitleCandidates } from './wikiThumb';
import { wishPhotoWikiTitles } from './wishBookLink';
import { resolveLocatedPhoto } from './placePhotoResolve';

export function isClonedPlacePhoto(
  url: string | null | undefined,
  dest: string | null,
  stay: string | null,
): boolean {
  const u = (url || '').trim();
  if (!u) return false;
  const d = (dest || '').trim();
  const s = (stay || '').trim();
  return Boolean((d && u === d) || (s && u === s));
}

function isOnPropertyWish(id: string | null | undefined): boolean {
  return /pool|grill|sauna|spa|apartment|hotel|ferienhaus/i.test(id || '');
}

function evidenceThin(ev: WishEvidence[] | undefined): boolean {
  if (!ev?.length) return true;
  const outdoor = ev.filter((e) => !e.onProperty);
  if (!outdoor.length) return false;
  return outdoor.every((e) => !e.photoUrl && e.distanceM == null);
}

/** Wikimedia Commons Bildsuche — letzter Live-Fallback. */
async function fetchCommonsPhoto(query: string): Promise<string | null> {
  const q = (query || '').trim();
  if (q.length < 2) return null;
  try {
    const u = new URL('https://commons.wikimedia.org/w/api.php');
    u.searchParams.set('action', 'query');
    u.searchParams.set('generator', 'search');
    u.searchParams.set('gsrsearch', q);
    u.searchParams.set('gsrnamespace', '6');
    u.searchParams.set('gsrlimit', '5');
    u.searchParams.set('prop', 'imageinfo');
    u.searchParams.set('iiprop', 'url|mime');
    u.searchParams.set('iiurlwidth', '900');
    u.searchParams.set('format', 'json');
    u.searchParams.set('origin', '*');
    const res = await fetch(u.toString(), {
      headers: {
        'Api-User-Agent': 'YorroReisebuero/1.0 (travel companion; contact@yorro.de)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          { imageinfo?: Array<{ url?: string; thumburl?: string; mime?: string }> }
        >;
      };
    };
    const pages = Object.values(json.query?.pages || {});
    for (const page of pages) {
      const info = page.imageinfo?.[0];
      const mime = (info?.mime || '').toLowerCase();
      if (mime && !mime.startsWith('image/')) continue;
      const url = info?.thumburl || info?.url;
      if (url && /^https?:\/\//i.test(url)) return url;
    }
  } catch {
    /* soft */
  }
  return null;
}

/**
 * Live-Foto-Kaskade: existing → OSM/Google (GPS) → Wiki → Commons.
 */
export async function ensureLivePhoto(opts: {
  existing?: string | null;
  name?: string | null;
  placeName?: string | null;
  lat?: number | null;
  lng?: number | null;
  kind?: 'destination' | 'stay' | 'activity';
}): Promise<string | null> {
  const existing = (opts.existing || '').trim();
  if (existing) return existing;
  const place = (opts.placeName || opts.name || '').trim();
  const name = (opts.name || '').trim();
  const kind = opts.kind || 'destination';

  if (
    typeof opts.lat === 'number' &&
    Number.isFinite(opts.lat) &&
    typeof opts.lng === 'number' &&
    Number.isFinite(opts.lng)
  ) {
    try {
      const located = await resolveLocatedPhoto({
        kind: kind === 'stay' ? 'stay' : kind === 'activity' ? 'activity' : 'destination',
        lat: opts.lat,
        lng: opts.lng,
        name: name || place,
        placeName: place,
        radiusM: kind === 'stay' ? 2500 : 12000,
      });
      if (located.photoUrl) return located.photoUrl;
    } catch {
      /* soft */
    }
  }

  const wikiTitles = wikiTitleCandidates(name || place, [
    place,
    name ? `${name} hotel` : null,
    place ? `${place} city` : null,
    place ? `${place} skyline` : null,
  ].filter(Boolean) as string[]);
  for (const t of wikiTitles.slice(0, 6)) {
    const wiki = await fetchWikiThumb(t);
    if (wiki) return wiki;
  }

  const commonsQ = [name, place, kind === 'stay' ? 'hotel' : null].filter(Boolean).join(' ');
  const commons = await fetchCommonsPhoto(commonsQ || place);
  if (commons) return commons;

  if (place && place !== commonsQ) {
    const cityOnly = await fetchCommonsPhoto(place);
    if (cityOnly) return cityOnly;
  }
  return null;
}

async function resolveDestPhoto(opt: ReiseOption): Promise<string | null> {
  const stay =
    opt.stays?.find((s) => s.id === opt.selectedStayId) || opt.stays?.[0] || null;
  return ensureLivePhoto({
    existing:
      opt.photoUrl ||
      opt.journeyBeats?.find((b) => b.kind === 'destination' && b.photoUrl)?.photoUrl ||
      null,
    name: opt.placeName,
    placeName: opt.placeName,
    lat: stay?.lat ?? opt.lat,
    lng: stay?.lng ?? opt.lng,
    kind: 'destination',
  });
}

async function resolveStayPhoto(
  stay: StayChoice | null,
  placeName: string,
  placeLat?: number | null,
  placeLng?: number | null,
): Promise<string | null> {
  if (!stay) return null;
  return ensureLivePhoto({
    existing: stay.photoUrl,
    name: stay.name,
    placeName,
    lat: stay.lat ?? placeLat,
    lng: stay.lng ?? placeLng,
    kind: 'stay',
  });
}

const beatPhotoCache = new Map<string, string | null>();

async function resolveBeatPhoto(kind: JourneyBeat['kind']): Promise<string | null> {
  const titles = beatPhotoWikiTitles(kind);
  if (!titles.length) return null;
  const cacheKey = titles[0]!;
  if (beatPhotoCache.has(cacheKey)) return beatPhotoCache.get(cacheKey) ?? null;
  const url = await fetchWikiThumb(titles[0]!, titles.slice(1));
  beatPhotoCache.set(cacheKey, url);
  return url;
}

async function fillBeatPhotos(
  beats: JourneyBeat[] | undefined,
  fallbacks: { dest: string | null; stay: string | null },
): Promise<JourneyBeat[]> {
  const list = beats ?? [];
  return Promise.all(
    list.map(async (b) => {
      if (b.photoUrl) return b;
      if (b.kind === 'destination') {
        return { ...b, photoUrl: fallbacks.dest || fallbacks.stay };
      }
      if (b.kind === 'stay') {
        return { ...b, photoUrl: fallbacks.stay || fallbacks.dest };
      }
      const wiki = await resolveBeatPhoto(b.kind);
      return { ...b, photoUrl: wiki || fallbacks.dest || fallbacks.stay || null };
    }),
  );
}

/** Pro Finalist: Wish-Ernte + Dest-Foto + Magazin-Compose + Beat-Fotos. */
export async function deepEnrichMagazineOption(
  opt: ReiseOption,
  ledger: ReiseLedger,
): Promise<ReiseOption> {
  let next: ReiseOption = { ...opt };
  let stay =
    next.stays?.find((s) => s.id === next.selectedStayId) || next.stays?.[0] || null;

  const destPhoto = await resolveDestPhoto(next);
  next.photoUrl = destPhoto;

  if (next.stays?.length) {
    next.stays = await Promise.all(
      next.stays.map(async (s) => {
        const photoUrl = await resolveStayPhoto(s, next.placeName, next.lat, next.lng);
        return { ...s, photoUrl: photoUrl || destPhoto || s.photoUrl };
      }),
    );
    stay = next.stays.find((s) => s.id === next.selectedStayId) || next.stays[0] || null;
  }

  let stayPhoto = stay?.photoUrl || null;
  if (!stayPhoto && stay) {
    stayPhoto = await resolveStayPhoto(stay, next.placeName, next.lat, next.lng);
    if (!stayPhoto) stayPhoto = destPhoto;
    if (stayPhoto && next.stays) {
      next.stays = next.stays.map((s) =>
        s.id === stay!.id ? { ...s, photoUrl: stayPhoto } : s,
      );
    }
  } else if (!stayPhoto) {
    stayPhoto = destPhoto;
  }

  let wishEvidence = next.wishEvidence as WishEvidence[] | undefined;
  if (evidenceThin(wishEvidence)) {
    try {
      wishEvidence = await harvestWishEvidence({
        lat: stay?.lat ?? next.lat,
        lng: stay?.lng ?? next.lng,
        placeName: next.placeName,
        stayPhotoUrl: stayPhoto,
        stayAmenities: '',
        ledger,
      });
    } catch {
      wishEvidence = wishEvidence ?? [];
    }
  } else if (stayPhoto && wishEvidence?.length) {
    wishEvidence = wishEvidence.map((e) =>
      e.onProperty ? { ...e, photoUrl: stayPhoto || e.photoUrl } : e,
    );
  }

  if (wishEvidence?.length) {
    wishEvidence = wishEvidence.map((e) =>
      !e.onProperty && isClonedPlacePhoto(e.photoUrl, destPhoto, stayPhoto)
        ? { ...e, photoUrl: null }
        : e,
    );
  }
  next = enrichOptionMagazine(next, ledger, {
    transferMinutes: next.transferMinutes,
    destPhotoUrl: destPhoto,
    wishEvidence,
  });

  next.photoUrl = destPhoto || stayPhoto || next.photoUrl;

  next.journeyBeats = await fillBeatPhotos(next.journeyBeats, {
    dest: destPhoto || stayPhoto,
    stay: stayPhoto || destPhoto,
  });
  next.returnBeats = await fillBeatPhotos(next.returnBeats, {
    dest: destPhoto || stayPhoto,
    stay: stayPhoto || destPhoto,
  });

  if (next.wishChapters?.length) {
    next.wishChapters = await Promise.all(
      next.wishChapters.map(async (c) => {
        const onProperty = isOnPropertyWish(c.mustHaveId);
        const cloned =
          !onProperty && isClonedPlacePhoto(c.photoUrl, destPhoto, stayPhoto);
        if (c.photoUrl && !cloned) return c;
        if (onProperty && stayPhoto) {
          return { ...c, photoUrl: stayPhoto };
        }
        const titles = wishPhotoWikiTitles(c.mustHaveId);
        let wiki: string | null = null;
        if (titles.length) {
          wiki = await fetchWikiThumb(titles[0]!, titles.slice(1));
        }
        if (!wiki) {
          wiki = await ensureLivePhoto({
            name: c.title,
            placeName: next.placeName,
            lat: c.lat ?? stay?.lat ?? next.lat,
            lng: c.lng ?? stay?.lng ?? next.lng,
            kind: 'activity',
          });
        }
        return {
          ...c,
          photoUrl: wiki || stayPhoto || destPhoto || (cloned ? null : c.photoUrl),
        };
      }),
    );
  }

  if (!next.photoUrl) {
    next.photoUrl =
      (await fetchCommonsPhoto(next.placeName)) ||
      (await fetchWikiThumb(next.placeName)) ||
      stayPhoto;
  }

  return next;
}

export async function deepEnrichMagazineFinalists(
  options: ReiseOption[],
  ledger: ReiseLedger,
): Promise<ReiseOption[]> {
  return Promise.all(options.map((o) => deepEnrichMagazineOption(o, ledger)));
}
