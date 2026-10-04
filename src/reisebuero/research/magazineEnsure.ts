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
import { resolveLocatedPhoto, staticMapTitlePhoto } from './placePhotoResolve';
import { isUnappealingDestPhotoUrl } from './destPhotoPick';
import {
  hotellookHotelGalleryUrls,
  hotellookIdFromStayRef,
} from './hotellookPhotos';
export { staticMapTitlePhoto } from './placePhotoResolve';

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

function normPhotoUrl(url: string | null | undefined): string {
  return (url || '').trim().split('?')[0]!.toLowerCase();
}

/** Nächstes freies Foto aus Pool — nie dasselbe URL nochmal. */
export function takeUniquePhoto(
  preferred: string | null | undefined,
  pool: string[],
  used: Set<string>,
): string | null {
  const tryOne = (url: string | null | undefined): string | null => {
    const u = (url || '').trim();
    if (!u || !/^https?:\/\//i.test(u)) return null;
    const key = normPhotoUrl(u);
    if (!key || used.has(key)) return null;
    used.add(key);
    return u;
  };
  const hit = tryOne(preferred);
  if (hit) return hit;
  for (const p of pool) {
    const next = tryOne(p);
    if (next) return next;
  }
  return null;
}

/** Expedia/Hotellook-Galerie aus Stay-Id oder vorhandener CDN-URL. */
export function stayHotelGalleryPool(stay: StayChoice | null | undefined): string[] {
  if (!stay) return [];
  const id =
    hotellookIdFromStayRef(stay.id) ||
    hotellookIdFromStayRef(stay.photoUrl) ||
    hotellookIdFromStayRef(stay.bookUrl);
  if (id) return hotellookHotelGalleryUrls(id, 10);
  const existing = (stay.photoUrl || '').trim();
  return existing ? [existing] : [];
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
  const kind = opts.kind || 'destination';
  // Dest: unattraktive Wiki-Defaults (Fernsehturm) nicht behalten
  if (
    existing &&
    !(kind === 'destination' && isUnappealingDestPhotoUrl(existing))
  ) {
    return existing;
  }
  const place = (opts.placeName || opts.name || '').trim();
  const name = (opts.name || '').trim();

  // Stay: Expedia/Hotellook-Galerie wird in resolveStayPhoto / stayHotelGalleryPool geholt

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
      if (located.photoUrl) {
        if (kind !== 'destination' || !isUnappealingDestPhotoUrl(located.photoUrl)) {
          return located.photoUrl;
        }
      }
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
  for (const t of wikiTitles.slice(0, 8)) {
    const wiki = await fetchWikiThumb(t);
    if (wiki) return wiki;
  }

  const commonsQ = [name, place, kind === 'stay' ? 'hotel' : null].filter(Boolean).join(' ');
  const commons = await fetchCommonsPhoto(commonsQ || place);
  if (commons && (kind !== 'destination' || !isUnappealingDestPhotoUrl(commons))) {
    return commons;
  }

  if (place && place !== commonsQ) {
    const cityOnly = await fetchCommonsPhoto(place);
    if (cityOnly && (kind !== 'destination' || !isUnappealingDestPhotoUrl(cityOnly))) {
      return cityOnly;
    }
  }
  // Letzter Live-Fallback: Karten-Titelbild (nie leeres Cover)
  const map = staticMapTitlePhoto(opts.lat, opts.lng, kind === 'stay' ? 14 : 11);
  if (map) return map;
  return null;
}

async function resolveDestPhoto(opt: ReiseOption): Promise<string | null> {
  const stay =
    opt.stays?.find((s) => s.id === opt.selectedStayId) || opt.stays?.[0] || null;
  const existing =
    opt.photoUrl ||
    opt.journeyBeats?.find((b) => b.kind === 'destination' && b.photoUrl)?.photoUrl ||
    null;
  // Stay-Foto nie als Dest-Hero klauen
  const stayUrls = new Set(
    (opt.stays ?? []).map((s) => normPhotoUrl(s.photoUrl)).filter(Boolean),
  );
  const cleanExisting =
    existing && !stayUrls.has(normPhotoUrl(existing)) && !isUnappealingDestPhotoUrl(existing)
      ? existing
      : null;
  return ensureLivePhoto({
    existing: cleanExisting,
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
  const gallery = stayHotelGalleryPool(stay);
  if (gallery[0]) return gallery[0];
  if (stay.photoUrl) return stay.photoUrl;
  return ensureLivePhoto({
    existing: null,
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

/**
 * Beat-Fotos: eigenes Motiv oder null — nie Dest/Stay klonen (sonst überall dasselbe Bild).
 */
async function fillBeatPhotos(
  beats: JourneyBeat[] | undefined,
  fallbacks: { dest: string | null; stay: string | null },
  used: Set<string>,
): Promise<JourneyBeat[]> {
  const list = beats ?? [];
  return Promise.all(
    list.map(async (b) => {
      if (b.kind === 'destination') {
        return {
          ...b,
          photoUrl: takeUniquePhoto(b.photoUrl || fallbacks.dest, [], used),
        };
      }
      if (b.kind === 'stay') {
        return {
          ...b,
          photoUrl: takeUniquePhoto(b.photoUrl || fallbacks.stay, [], used),
        };
      }
      const wiki = await resolveBeatPhoto(b.kind);
      return {
        ...b,
        photoUrl: takeUniquePhoto(b.photoUrl || wiki, wiki ? [wiki] : [], used),
      };
    }),
  );
}

/** Letzte Chance: Overnight ohne Stay → Hotellook/Grounding nachziehen. */
export async function fillMissingOvernightStay(
  opt: ReiseOption,
  ledger: ReiseLedger,
): Promise<ReiseOption> {
  try {
    const { needsNight } = await import('../completeness');
    if (!needsNight(ledger) || ledger.bookedStay?.value === true) return opt;
    const hasPriced =
      (opt.stayPriceEur != null && opt.stayPriceEur > 0) ||
      (opt.stays ?? []).some((s) => s.priceEur != null && s.priceEur > 0);
    if (hasPriced && (opt.stays?.length ?? 0) > 0) return opt;

    const checkin =
      ledger.dateStart?.value ||
      opt.comboWindows?.[0]?.checkin ||
      opt.days?.[0]?.dayKey ||
      null;
    const checkout =
      ledger.dateEnd?.value ||
      opt.comboWindows?.[0]?.checkout ||
      (checkin
        ? (() => {
            const n = Math.max(1, ledger.stayNights?.value ?? 2);
            const ms = Date.parse(`${checkin}T12:00:00`) + n * 86_400_000;
            const d = new Date(ms);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          })()
        : null);
    if (!checkin || !checkout || checkin === checkout) return opt;

    const adults = Math.max(1, ledger.adults?.value ?? 2);
    const { searchLiveStaysMulti } = await import('./liveStaySearch');
    const { filterRealStays } = await import('./packagePartner');
    const { finalizeHotelBookAffiliateUrl } = await import(
      '../../services/affiliate/hotelPropertyDeepLink'
    );
    const found = await searchLiveStaysMulti({
      city: opt.placeName,
      checkin,
      checkout,
      adults,
      preferredLodging:
        ledger.lodgingKind?.value === 'apartment' || ledger.lodgingKind?.value === 'ferienhaus'
          ? 'apartment'
          : ledger.lodgingKind?.value === 'hotel'
            ? 'hotel'
            : 'any',
      allowGrounded: true,
      lat: opt.lat,
      lng: opt.lng,
      pageSize: 16,
      originIata: ledger.airportIata?.value || null,
    });
    const mapped = (found.stays || [])
      .filter((s) => s.priceTotal != null && s.priceTotal > 0 && Boolean(s.name))
      .slice(0, 4)
      .map((s) => {
        let bookUrl = s.bookUrl || null;
        try {
          bookUrl = finalizeHotelBookAffiliateUrl({
            hotelName: s.name,
            city: opt.placeName,
            bookUrl: s.bookUrl,
            checkin,
            checkout,
            adults,
            expediaPropertyId: s.expediaPropertyId,
            priceEur: s.priceTotal,
          });
        } catch {
          /* soft */
        }
        return {
          id: `stay-${s.id}`,
          name: s.name,
          priceEur: s.priceTotal,
          bookUrl,
          photoUrl: s.photoUrl ?? null,
          why: found.source === 'hotellook' ? 'Hotellook Live' : 'Live-Unterkunft',
          lat: s.lat ?? opt.lat,
          lng: s.lng ?? opt.lng,
          expediaPropertyId: s.expediaPropertyId ?? null,
        } as StayChoice;
      });
    const real = filterRealStays(mapped);
    if (!real.length) return opt;

    const primary = real[0]!;
    const adultsN = adults;
    const { buyInFromParts, sharedCarEurFromOption } = await import('./composePlan');
    const tr =
      opt.transports?.find((t) => t.id === opt.selectedTransportId) || opt.transports?.[0] || null;
    const buy = buyInFromParts({
      flightPerPersonEur:
        tr?.kind === 'flight' || tr?.kind === 'bus' || tr?.kind === 'train'
          ? tr.priceEur ?? opt.flightPriceEur ?? null
          : opt.flightPriceEur ?? null,
      stayEur: primary.priceEur,
      transferEur: opt.transferEur ?? null,
      carEur: sharedCarEurFromOption(opt),
      extrasEur: opt.extrasEur ?? null,
      adults: adultsN,
    });
    return {
      ...opt,
      stays: real,
      selectedStayId: primary.id,
      stayName: primary.name,
      stayPriceEur: primary.priceEur,
      stayBookUrl: primary.bookUrl,
      photoUrl: opt.photoUrl || primary.photoUrl,
      buyInEur: buy.buyInEur,
      buyInLabel: buy.buyInLabel,
      gaps: (opt.gaps ?? []).filter((g) => !/unterkunft/i.test(g)),
    };
  } catch {
    return opt;
  }
}

/** Pro Finalist: Wish-Ernte + Dest-Foto + Magazin-Compose + Beat-Fotos. */
export async function deepEnrichMagazineOption(
  opt: ReiseOption,
  ledger: ReiseLedger,
): Promise<ReiseOption> {
  let next: ReiseOption = await fillMissingOvernightStay(opt, ledger);
  let stay =
    next.stays?.find((s) => s.id === next.selectedStayId) || next.stays?.[0] || null;

  const used = new Set<string>();
  const gallery = stayHotelGalleryPool(stay);

  // 1) Dest-Hero = Stadt/Landmarke (nie Hotel-Klon, nie Fernsehturm)
  let destPhoto = await resolveDestPhoto(next);
  destPhoto = takeUniquePhoto(destPhoto, [], used);
  next.photoUrl = destPhoto;

  // 2) Stays = Expedia/Hotellook-Galerie (_1, _2, …) — jedes Haus eigenes Bild
  if (next.stays?.length) {
    next.stays = await Promise.all(
      next.stays.map(async (s, i) => {
        const pool = stayHotelGalleryPool(s);
        const preferred =
          (await resolveStayPhoto(s, next.placeName, next.lat, next.lng)) || pool[0] || null;
        const photoUrl = takeUniquePhoto(preferred, [...pool, ...gallery], used);
        return { ...s, photoUrl };
      }),
    );
    stay = next.stays.find((s) => s.id === next.selectedStayId) || next.stays[0] || null;
  }

  const stayPhoto = stay?.photoUrl || null;

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
        distanceAnchor:
          stay?.lat != null && stay?.lng != null && Boolean(stay.name) ? 'stay' : 'city',
      });
    } catch {
      wishEvidence = wishEvidence ?? [];
    }
  }

  if (wishEvidence?.length) {
    wishEvidence = wishEvidence.map((e) => {
      if (!e.onProperty && isClonedPlacePhoto(e.photoUrl, destPhoto, stayPhoto)) {
        return { ...e, photoUrl: null };
      }
      return e;
    });
  }

  next = enrichOptionMagazine(next, ledger, {
    transferMinutes: next.transferMinutes,
    destPhotoUrl: destPhoto,
    wishEvidence,
  });
  // Dest bleibt Stadt — nicht durch Stay überschreiben
  next.photoUrl = destPhoto || next.photoUrl;

  if ((next.days?.length ?? 0) > 0) {
    try {
      const { enrichDayPlansWithLivePlaces } = await import('./liveDayProgram');
      const { userWantsProgramDays } = await import('./storyMagazine');
      if (userWantsProgramDays(ledger)) {
        const tr =
          next.transports?.find((t) => t.id === next.selectedTransportId) ||
          next.transports?.[0] ||
          null;
        next.days = await enrichDayPlansWithLivePlaces({
          days: next.days ?? [],
          lat: stay?.lat ?? next.lat,
          lng: stay?.lng ?? next.lng,
          placeName: next.placeName,
          ledger,
          arriveAt: tr?.arriveAt || tr?.departAt || null,
        });
        next = enrichOptionMagazine(next, ledger, {
          transferMinutes: next.transferMinutes,
          destPhotoUrl: destPhoto,
          wishEvidence,
        });
        next.photoUrl = destPhoto || next.photoUrl;
      }
    } catch {
      /* soft */
    }
  }

  next.journeyBeats = await fillBeatPhotos(
    next.journeyBeats,
    { dest: destPhoto, stay: stayPhoto },
    used,
  );
  next.returnBeats = await fillBeatPhotos(
    next.returnBeats,
    { dest: destPhoto, stay: stayPhoto },
    used,
  );

  if (next.wishChapters?.length) {
    next.wishChapters = await Promise.all(
      next.wishChapters.map(async (c) => {
        const onProperty = isOnPropertyWish(c.mustHaveId);
        const cloned =
          !onProperty && isClonedPlacePhoto(c.photoUrl, destPhoto, stayPhoto);
        if (c.photoUrl && !cloned) {
          // Eigenes Evidence-/Wiki-Motiv behalten
          const key = normPhotoUrl(c.photoUrl);
          if (key && !used.has(key)) used.add(key);
          return c;
        }
        if (onProperty) {
          // Pool/Sauna am Haus: Gallery-Slot, sonst Stay (am selben Objekt ok)
          const unique = takeUniquePhoto(null, gallery, used);
          return { ...c, photoUrl: unique || stayPhoto || null };
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
        // Nie Dest/Stay klonen — lieber leer als 5× dasselbe Bild
        return {
          ...c,
          photoUrl: takeUniquePhoto(wiki, gallery, used),
        };
      }),
    );
  }

  if (!next.photoUrl) {
    next.photoUrl = takeUniquePhoto(
      (await fetchWikiThumb(next.placeName)) ||
        (await fetchCommonsPhoto(next.placeName)) ||
        staticMapTitlePhoto(stay?.lat ?? next.lat, stay?.lng ?? next.lng, 11),
      [],
      used,
    );
  }

  return next;
}

export async function deepEnrichMagazineFinalists(
  options: ReiseOption[],
  ledger: ReiseLedger,
): Promise<ReiseOption[]> {
  const enriched = await Promise.all(
    options.map((o) => deepEnrichMagazineOption(o, ledger)),
  );
  return enriched.map((o) => {
    if (o.photoUrl) return o;
    const map = staticMapTitlePhoto(o.lat, o.lng, 11);
    return map ? { ...o, photoUrl: map } : o;
  });
}
