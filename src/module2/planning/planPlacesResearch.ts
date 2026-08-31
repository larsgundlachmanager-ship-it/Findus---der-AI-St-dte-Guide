/**
 * Modul 5 — Deep Research + Pitch (Masterplan).
 */

import {
  geocodePlaceName,
  searchPlacesByText,
} from '../../services/navigation/googleMapsNav';
import { getAllPois, haversineMeters } from '../../db/database';
import { readRucksackSync, anchorCoords } from '../rucksack/rucksackStore';
import {
  requestOpenPlanCalendar,
  usePlanCalendarUiStore,
  type PlanChoiceCard,
  type PlanPendingChoice,
} from '../timeline/planCalendarUiStore';
import { useFuturePlanStore } from '../timeline/futurePlanState';
import { applyGapFillTravelLegs } from '../timeline/gapFillTravel';
import { usePlanSessionStore } from './planSessionState';
import { getPlanWalkMPerMin } from '../../services/mobility/paceProfile';
import type { QuickAction } from '../../types/concierge';
import { weaveDualOptionSpoken } from '../../services/concierge/dualOptionPolicy';
import type {
  DeepResearchPitchResult,
  DeepResearchUiCard,
  IngestOpenWish,
} from './planningTypes';
import {
  normalizePlanBullets,
  sanitizePlanSpeech,
  starBullet,
} from './planSpeechSanitize';
import { extractCityFromText, wantsLocalCityStay } from '../context/shortTermContext';
import { getCachedUserProfile } from '../../services/userProfileService';
import {
  buildGetYourGuideSearchUrl,
  preferTicketSource,
  buildCarRentalAction,
} from '../../services/affiliate/affiliateService';
import { detectHelpFirstMoments } from '../../services/affiliate/helpFirstMonetization';
import {
  detectOfferKind,
  isSafeOfferUrl,
  offerLabel,
  resolveContextualOffer,
  type OfferKind,
} from './offerActionUtils';
import { todayDateKey } from '../../utils/dateKeys';
import { clampToFutureMs, isPastMs } from '../timeline/planNowGuard';

/** @deprecated Legacy Gemini-Pitch entfernt — SSOT ist `src/module2/pitch` (runPitchModule). Nicht mehr aufrufen. */
export const DEEP_RESEARCH_SYSTEM =
  'DEPRECATED: use src/module2/pitch/runPitchModule. Legacy deep-research prompt removed.';

const NEAR_M = 800;

function ratingLabel(rating: number | null | undefined): string {
  return starBullet(rating) ?? 'Bewertung offen';
}

function mapsUrlFor(
  name: string,
  lat: number,
  lng: number,
  placeId?: string | null,
): string {
  if (placeId) {
    try {
      const { mapsUrlForGooglePlace } = require('../../services/research/eventInfoUrl') as {
        mapsUrlForGooglePlace: (o: {
          placeName?: string | null;
          placeId?: string | null;
        }) => string | null;
      };
      return mapsUrlForGooglePlace({ placeName: name, placeId }) || '';
    } catch {
      return '';
    }
  }
  return '';
}

function parseTimeToMs(dayKey: string, time: string | null | undefined): number | null {
  if (!time) return null;
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = dayKey.split('-').map(Number);
  const dt = new Date(y!, mo! - 1, d!, Number(m[1]), Number(m[2]), 0, 0);
  return dt.getTime();
}

/** Wichtiger Fix-Anker (Prio 1–2) als Suchzentrum, sonst GPS. */
function resolveResearchAnchor(): { lat: number; lng: number; hint: string } {
  const bag = readRucksackSync();
  const gps = anchorCoords(bag);
  const stops = useFuturePlanStore.getState().plan.stops.filter(
    (s) =>
      s.kind !== 'wish' &&
      s.kind !== 'nav_leg' &&
      typeof s.lat === 'number' &&
      typeof s.lng === 'number' &&
      (s.planPriority ?? 6) <= 2,
  );
  if (stops.length > 0) {
    const s = stops[stops.length - 1]!;
    return { lat: s.lat!, lng: s.lng!, hint: s.title };
  }
  return {
    lat: gps.lat,
    lng: gps.lng,
    hint: bag.cityHint || 'GPS',
  };
}

async function discoverCandidates(
  wish: IngestOpenWish,
  anchor: { lat: number; lng: number },
  opts?: { cityBoundM?: number; cityName?: string | null; localOnly?: boolean },
): Promise<
  Array<{
    name: string;
    lat: number;
    lng: number;
    placeId: string | null;
    rating: number | null;
    mapsUrl: string;
    address?: string | null;
    openNow?: boolean;
  }>
> {
  const walk = isWalkWish(wish);
  const explore = !walk && isExploreWish(wish);
  const localOnly = opts?.localOnly === true;
  const boundM =
    opts?.cityBoundM ?? (localOnly ? 6_000 : walk ? 15_000 : 12_000);
  const cityLabel = (opts?.cityName || '').trim();
  const inland =
    localOnly &&
    !/\b(strand|insel|nordsee|ostsee|hafenstadt|küste|kueste)\b/i.test(
      `${wish.title} ${wish.context} ${cityLabel}`,
    );
  const wantsBikePath =
    /\b(radweg|fahrradweg|radroute|radtour|radeln|fernradweg|veloroute)\b/i.test(
      `${wish.title} ${wish.context}`,
    );
  const wantsHikePath =
    /\b(wanderweg|wanderung|lehrpfad|wandern|uferweg)\b/i.test(
      `${wish.title} ${wish.context}`,
    );
  const query = walk
    ? wantsBikePath
      ? `${wish.title} ${cityLabel} Radweg Fahrradweg Radroute — kein Restaurant kein Café kein Parkplatz`
      : wantsHikePath
        ? `${wish.title} ${cityLabel} Wanderweg Lehrpfad Uferweg — kein Restaurant kein Café kein Bahnhof`
        : inland
          ? `${wish.title} ${cityLabel} Park Grünanlage Denkmal Kirche Aussicht Spazierweg — kein Restaurant kein Café kein Strand kein Bahnhof`
          : `${wish.title} ${cityLabel} Park Ufer Aussicht Spazierweg Promenade — kein Restaurant kein Café`
    : explore
      ? `${wish.title} ${wish.context} ${cityLabel} tourist attractions landmarks viewpoints historic — kein Restaurant kein Bahnhof`
      : `${wish.title} ${wish.context}`.replace(/\s+/g, ' ').trim();
  const rings = walk
    ? localOnly
      ? [1200, 2500, 4500, boundM]
      : [2000, 4000, 8000, 15000]
    : explore
      ? localOnly
        ? [1500, 3000, 5000, boundM]
        : [2500, 4500, 8000, 12000]
      : [1500, 2000, 3500, 5000];
  const seen = new Set<string>();
  const out: Array<{
    name: string;
    lat: number;
    lng: number;
    placeId: string | null;
    rating: number | null;
    mapsUrl: string;
    address?: string | null;
    openNow?: boolean;
  }> = [];

  const pushHit = (h: {
    name: string;
    lat: number;
    lng: number;
    placeId?: string | null;
    rating?: number | null;
    openNow?: boolean;
  }) => {
    if (haversineMeters(anchor.lat, anchor.lng, h.lat, h.lng) > boundM + 500) {
      return;
    }
    if (
      /\b(bahnhof|hauptbahnhof|haltepunkt|s-bahn|u-bahn|flughafen|airport|parkplatz|parking)\b/i.test(
        h.name,
      )
    ) {
      return;
    }
    if (
      walk &&
      /\b(restaurant|pizzeria|imbiss|mcdonald|burger\s*king)\b/i.test(h.name)
    ) {
      return;
    }
    const key = h.placeId || `${h.name}_${h.lat}_${h.lng}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      name: h.name,
      lat: h.lat,
      lng: h.lng,
      placeId: h.placeId ?? null,
      rating: typeof h.rating === 'number' ? h.rating : null,
      mapsUrl: mapsUrlFor(h.name, h.lat, h.lng, h.placeId ?? null),
      address: null,
      openNow: h.openNow,
    });
  };

  if ((localOnly || walk || explore) && !opts?.cityName) {
    try {
      const pois = await getAllPois();
      const trailFirst =
        wantsBikePath || wantsHikePath
          ? [...pois].sort((a, b) => {
              const score = (p: (typeof pois)[0]) => {
                const blob = `${p.category ?? ''} ${p.name}`.toLowerCase();
                if (wantsBikePath && /\b(radweg|fahrradweg|radroute)\b/i.test(blob)) {
                  return 0;
                }
                if (
                  wantsHikePath &&
                  /\b(wanderung|wanderweg|lehrpfad)\b/i.test(blob)
                ) {
                  return 0;
                }
                return 1;
              };
              return score(a) - score(b);
            })
          : pois;
      for (const p of trailFirst) {
        if (p.kind && p.kind !== 'area' && p.kind !== 'legacy') continue;
        const cat = `${p.category ?? ''} ${p.name}`.toLowerCase();
        if (/\bwegweiser\b/i.test(cat) || /[·•|]\s*wegweiser\s*$/i.test(p.name)) {
          continue;
        }
        if (
          /\b(hotel|restaurant|imbiss|supermarkt|apotheke|tankstelle|laden)\b/i.test(
            cat,
          )
        ) {
          continue;
        }
        if (
          wantsBikePath &&
          !/\b(radweg|fahrradweg|radroute|radtour|park|ufer|promenade)\b/i.test(cat)
        ) {
          continue;
        }
        if (
          wantsHikePath &&
          !/\b(wanderung|wanderweg|lehrpfad|park|natur|ufer|aussicht)\b/i.test(
            cat,
          )
        ) {
          continue;
        }
        pushHit({
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          placeId: p.spot_key ?? String(p.id),
          rating: null,
        });
      }
    } catch {
      /* soft */
    }
  }

  for (const radiusM of rings) {
    try {
      const hits = await searchPlacesByText({
        query,
        lat: anchor.lat,
        lng: anchor.lng,
        radiusM: Math.min(radiusM, boundM),
        includedType: walk ? 'park' : explore ? 'tourist_attraction' : undefined,
      });
      for (const h of hits) {
        if (h.openNow === false && !walk) continue;
        pushHit(h);
      }
    } catch {
      /* soft */
    }
    if (out.length >= (explore ? 12 : 8)) break;
  }

  if (walk && out.length < 2) {
    try {
      const hits = await searchPlacesByText({
        query: inland
          ? `${cityLabel} Park Denkmal Kirche Grünanlage Spazierweg — kein Restaurant kein Strand`
          : 'Aussichtspunkt Spazierweg Uferpromenade Park See Natur — kein Restaurant',
        lat: anchor.lat,
        lng: anchor.lng,
        radiusM: Math.min(12_000, boundM),
      });
      for (const h of hits) {
        pushHit(h);
      }
    } catch {
      /* soft */
    }
  }

  const ranked = out
    .filter((p) => p.rating == null || p.rating >= 3.8)
    .sort((a, b) => {
      const ra = a.rating ?? 3.5;
      const rb = b.rating ?? 3.5;
      const score = (r: number) => r + (r >= 4.5 ? 0.05 : 0);
      return score(rb) - score(ra);
    })
    .slice(0, 20);

  const booked = timelineBookedPlaces();
  const withoutBooked = ranked.filter((p) => !isAlreadyOnTimeline(p, booked));
  const finalRanked =
    withoutBooked.length >= 2
      ? withoutBooked
      : withoutBooked.length >= 1
        ? withoutBooked
        : ranked.filter((p) => !isAlreadyOnTimeline(p, booked)).slice(0, 20);

  await Promise.all(
    finalRanked.slice(0, 6).map(async (p) => {
      try {
        const geo = await geocodePlaceName(p.name, {
          biasLat: p.lat,
          biasLng: p.lng,
        });
        if (geo?.label) p.address = geo.label;
      } catch {
        /* soft */
      }
    }),
  );

  return finalRanked;
}

/** Orte, die heute schon fest in der Timeline stehen. */
function timelineBookedPlaces(): Array<{
  name: string;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
}> {
  return useFuturePlanStore
    .getState()
    .plan.stops.filter(
      (s) =>
        s.status !== 'done' &&
        s.kind !== 'nav_leg' &&
        s.kind !== 'wish' &&
        !s.id.startsWith('choice_') &&
        !s.id.startsWith('explore_') &&
        !s.id.startsWith('anchor_'),
    )
    .map((s) => ({
      name: s.title
        .replace(/^[🥇🥈📌📍✨🏁🔔❓]\s*/u, '')
        .trim()
        .toLowerCase(),
      placeId: null as string | null,
      lat: typeof s.lat === 'number' ? s.lat : null,
      lng: typeof s.lng === 'number' ? s.lng : null,
    }));
}

function isAlreadyOnTimeline(
  place: { name: string; placeId: string | null; lat: number; lng: number },
  booked: Array<{
    name: string;
    placeId: string | null;
    lat: number | null;
    lng: number | null;
  }>,
): boolean {
  const name = place.name.trim().toLowerCase();
  for (const b of booked) {
    if (place.placeId && b.placeId && place.placeId === b.placeId) return true;
    if (b.name && name && (b.name === name || b.name.includes(name) || name.includes(b.name))) {
      return true;
    }
    if (
      b.lat != null &&
      b.lng != null &&
      Number.isFinite(place.lat) &&
      Number.isFinite(place.lng) &&
      haversineMeters(b.lat, b.lng, place.lat, place.lng) < 80
    ) {
      return true;
    }
  }
  return false;
}

function nearnessHint(
  lat: number,
  lng: number,
  anchor: { lat: number; lng: number },
): string | null {
  const d = haversineMeters(anchor.lat, anchor.lng, lat, lng);
  if (d < NEAR_M) return 'sehr nah';
  return null;
}

export function isHotelWishText(blob: string): boolean {
  return /\b(hotel|übernacht|uebernacht|unterkunft|zimmer|hostel|airbnb|pension)\b/i.test(
    blob,
  );
}

/** Modul-5 Hotel: Stay22 Live → immer 2 Karten (bei günstigste: die zwei günstigsten). */
async function pitchHotelWishFromStay22(
  wish: IngestOpenWish,
  opts?: { signal?: AbortSignal },
): Promise<(DeepResearchPitchResult & { spokenText: string }) | null> {
  try {
    const {
      parseHotelStayDates,
      parseHotelAdults,
      searchStay22HotelsInCity,
    } = await import('../../services/concierge/hotelAvailabilityService');
    const {
      parseHotelAmenityNeeds,
      filterHotelsByAmenityNeeds,
      pickTwoHotelStays,
      nightsBetween,
      pricePerNight,
      mergeAmenityEvidence,
    } = await import('../../services/concierge/hotelHardMatch');
    const blob = `${wish.title} ${wish.context}`;
    const { parseHotelStayDatesForPlan } = await import('./planStayDates');
    const dayKeyHint =
      usePlanCalendarUiStore.getState().requestedDayKey ??
      useFuturePlanStore.getState().plan.dayKey;
    const { checkin, checkout } = parseHotelStayDatesForPlan(blob, dayKeyHint);
    const adults = parseHotelAdults(blob);
    const nights = nightsBetween(checkin, checkout);
    const amenityNeeds = parseHotelAmenityNeeds(blob);
    const bag = readRucksackSync();
    const city =
      extractCityFromText(blob) ||
      extractExploreCityHint(wish) ||
      String(bag.cityHint ?? '').trim() ||
      '';
    // Ohne Stadtkein Blind-Search am GPS-Heimatort
    if (!city || /^germany$/i.test(city)) {
      return null;
    }
    const wantCheap =
      /\b(günstig|guenstig|billig|preiswert|günstigste|guenstigste)\b/i.test(
        blob,
      );
    const live = await searchStay22HotelsInCity({
      city,
      checkin,
      checkout,
      adults,
      amenityHint: amenityNeeds.map((n) => n.label).join(' ').toLowerCase() || null,
      pageSize: amenityNeeds.length ? 40 : 24,
    });
    let stays = live.stays;
    if (stays.length < 1) return null;

    if (amenityNeeds.length) {
      try {
        const { fetchPlacePitchDetails } = await import(
          '../../services/navigation/placePitchDetails'
        );
        const sample = stays.slice(0, 10);
        const enriched = await Promise.all(
          sample.map(async (s) => {
            try {
              const details = await fetchPlacePitchDetails({
                query: `${s.name} ${city} hotel`,
                lat: s.lat ?? 53.55,
                lng: s.lng ?? 9.99,
                signal: opts?.signal,
                includeAtmosphere: true,
              });
              if (!details) return s;
              const evidence = [
                details.editorialSummary,
                details.generativeSummary,
                ...details.reviews.map((r) => r.text),
              ]
                .filter(Boolean)
                .join('\n');
              return mergeAmenityEvidence(s, evidence);
            } catch {
              return s;
            }
          }),
        );
        const byId = new Map(enriched.map((s) => [s.id, s]));
        stays = stays.map((s) => byId.get(s.id) ?? s);
      } catch {
        /* soft */
      }
    }

    const filtered = filterHotelsByAmenityNeeds(stays, amenityNeeds);
    // Hard-Reject: nie Partial/ungefilterte Stays als Hotel-Pitch
    if (amenityNeeds.length > 0 && filtered.matched.length === 0) {
      return null;
    }
    const pool = amenityNeeds.length > 0 ? filtered.matched : stays;
    let picks = pickTwoHotelStays(pool, {
      wantCheap,
      wantQuality: false,
    });
    if (picks.length < 1) return null;

    // Distanz zum genannten Anker (Tennis/Stadt) — nie GPS in einer anderen Stadt
    let prev = resolveDistanceRef(wish);
    try {
      const nearHint = (() => {
        // Nur geocode wenn konkreter Club/Ort — nie blind „Tennisplatz Stadt“
        const named = blob.match(
          /\b(?:nahe|nähe|neben|bei|am)\s+(?:dem\s+|der\s+|des\s+)?([A-Za-zÄÖÜäöüß0-9][A-Za-zÄÖÜäöüß0-9\s-]{2,40}(?:club|tc|tennis)?)/i,
        );
        if (named?.[1] && !/^tennis(?:platz|club)?$/i.test(named[1].trim())) {
          return `${named[1].trim()} ${city}`;
        }
        const club = blob.match(
          /\btennisclub:\s*([^|]+)/i,
        ) || blob.match(/\b(phoenix(?:\s+club)?|tc\s+[A-Za-zÄÖÜäöüß]+)/i);
        if (club?.[1]) return `${club[1].trim()} ${city}`;
        return city;
      })();
      const geo = await geocodePlaceName(nearHint, { cityHint: city });
      if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
        prev = {
          lat: geo.lat,
          lng: geo.lng,
          title: nearHint.replace(new RegExp(`\\s*${city}\\s*$`, 'i'), '').trim().slice(0, 28) || city,
        };
      }
    } catch {
      /* soft */
    }

    // Bei „nahe X“: näher zum Anker bevorzugen — bei „günstig“: nah + günstig als Trade-off
    let ordered = picks;
    if (/\b(nahe|nähe|tennis)\b/i.test(blob)) {
      const byDist = [...pool].sort((a, b) => {
        const da =
          a.lat != null && a.lng != null
            ? haversineMeters(prev.lat, prev.lng, a.lat, a.lng)
            : 99_000;
        const db =
          b.lat != null && b.lng != null
            ? haversineMeters(prev.lat, prev.lng, b.lat, b.lng)
            : 99_000;
        return da - db;
      });
      const nearest = byDist[0];
      const cheapest = [...pool].sort(
        (x, y) => (x.priceTotal ?? 1e9) - (y.priceTotal ?? 1e9),
      )[0];
      if (wantCheap && nearest && cheapest && nearest.id !== cheapest.id) {
        ordered = [nearest, cheapest];
      } else {
        ordered = [...picks].sort((a, b) => {
          const da =
            a.lat != null && a.lng != null
              ? haversineMeters(prev.lat, prev.lng, a.lat, a.lng)
              : 99_000;
          const db =
            b.lat != null && b.lng != null
              ? haversineMeters(prev.lat, prev.lng, b.lat, b.lng)
              : 99_000;
          return da - db;
        });
      }
    }

    const needLabel = amenityNeeds.map((n) => n.label).join(' + ');
    const { resolveHotelPropertyAffiliateUrl } = await import(
      '../../services/affiliate/hotelPropertyDeepLink'
    );
    const uiCards: DeepResearchUiCard[] = [];
    for (let i = 0; i < ordered.slice(0, 2).length; i++) {
      const s = ordered[i]!;
      const dist =
        s.lat != null && s.lng != null
          ? formatDistFromPrev(s.lat, s.lng, prev)
          : null;
      const per = pricePerNight(s, nights);
      const price =
        s.priceTotal != null
          ? `${Math.round(s.priceTotal)} € für ${nights} Nächte` +
            (per != null ? ` (~${Math.round(per)} €/Nacht)` : '')
          : null;
      const am = (s.amenities ?? [])
        .filter(
          (x) =>
            /pool|sauna|spa|jacuzzi|frühstück|fruehstueck|breakfast|wellness|dampf/i.test(
              x,
            ) && !/wlan|wifi|wi-fi|internet|telefon|call|meeting/i.test(x),
        )
        .slice(0, 3)
        .join(', ');
      const speechPitch = sanitizePlanSpeech(
        [
          s.name,
          price,
          am || null,
          s.stars != null ? `${s.stars} Sterne` : null,
          dist,
          wantCheap && i === 0 && ordered[0]?.id !== ordered[1]?.id
            ? 'nächste Option'
            : wantCheap && i === 1
              ? 'günstigste Option (evtl. weiter weg)'
              : wantCheap && i === 0
                ? 'günstigste passende Live-Option'
                : null,
        ]
          .filter(Boolean)
          .join(', '),
      ).slice(0, 700);
      const lat = s.lat ?? prev.lat;
      const lng = s.lng ?? prev.lng;
      // Property-Deep-Link (Zimmer wählen) — nicht Stadt-Suche
      const bookUrl = await resolveHotelPropertyAffiliateUrl({
        hotelName: s.name,
        city,
        bookUrl: s.bookUrl,
        checkin,
        checkout,
        adults,
        expediaPropertyId: s.expediaPropertyId,
      });
      uiCards.push({
        name: s.name,
        lat,
        lng,
        placeId: null,
        speechPitch,
        address: s.address ?? null,
        bulletPoints: buildUsefulBullets({
          rating: s.rating,
          dist,
          llmBullets: [
            price,
            am || null,
            s.stars != null ? `${s.stars}★` : null,
            `${checkin.slice(8)}.${checkin.slice(5, 7)}.–${checkout.slice(8)}.${checkout.slice(5, 7)}.`,
          ].filter(Boolean) as string[],
          speechPitch,
          walk: false,
        }),
        actions: {
          mapsUrl: mapsUrlFor(s.name, lat, lng, null),
          menuStatus: 'NONE' as const,
          menuUrl: null,
          ticketUrl: bookUrl,
        },
      });
    }

    const result: DeepResearchPitchResult = {
      summary: wantCheap
        ? 'Zwei günstigste passende Hotels live'
        : needLabel
          ? `Zwei Hotels mit ${needLabel}`
          : 'Zwei Hotels live',
      uiCards,
    };
    await publishChoiceUi(wish, result);
    return {
      ...result,
      spokenText: combineSpeech(result.uiCards, result.summary, wish),
    };
  } catch (err) {
    console.warn('[module5] hotel Stay22 pitch failed', err);
    return null;
  }
}

function combineSpeech(
  cards: DeepResearchUiCard[],
  summary?: string,
  wish?: IngestOpenWish | null,
): string {
  const hotel =
    wish != null &&
    isHotelWishText(`${wish.title} ${wish.context} ${cards.map((c) => c.name).join(' ')}`);
  const intro = sanitizePlanSpeech(
    (summary || (hotel ? 'Zwei Hotels:' : 'Zwei Optionen:')).slice(0, 80),
  );
  const cleanIntro = intro
    .replace(/ich habe überlegt[\s\S]{0,120}/iu, '')
    .replace(/was empfiehlst du[\s\S]{0,80}/iu, '')
    .replace(/bewertung offen\.?/giu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const a = cards[0];
  const b = cards[1];
  if (!a || !b) {
    return sanitizePlanSpeech(cleanIntro || a?.speechPitch || '').slice(0, 700);
  }
  return sanitizePlanSpeech(
    weaveDualOptionSpoken({
      intro: cleanIntro || null,
      aName: a.name,
      aPitch: stripLeadingPlaceName(a.speechPitch || '', a.name),
      bName: b.name,
      bPitch: stripLeadingPlaceName(b.speechPitch || '', b.name),
    }),
  ).slice(0, hotel ? 1200 : 700);
}

function stripLeadingPlaceName(pitch: string, name: string): string {
  let p = (pitch ?? '').trim();
  const n = (name ?? '').trim();
  if (!p || !n) return p;
  if (p.toLowerCase().startsWith(n.toLowerCase())) {
    p = p.slice(n.length).replace(/^[\s:,.\-–—]+/u, '');
  }
  // „Name für <wish>“-Reste
  p = p.replace(
    new RegExp(
      `^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+für\\s+.+?(?:\\.|,|$)`,
      'iu',
    ),
    '',
  );
  return p.trim();
}

function isGpsMetaTitle(title: string): boolean {
  return /aktuelle\s+gps|gps-position|^start\b|^hier$/i.test(title.trim());
}

/**
 * Distanz-Bezug: echter vorheriger Stop — sonst Live-GPS als „hier“.
 * Nie „Aktuelle GPS-Position“ als Label.
 */
function resolveDistanceRef(wish: IngestOpenWish): {
  lat: number;
  lng: number;
  title: string;
} {
  const blob = `${wish.title} ${wish.context}`;
  const bag = readRucksackSync();
  const gps = anchorCoords(bag);

  const tennisStop = useFuturePlanStore
    .getState()
    .plan.stops.find(
      (s) =>
        typeof s.lat === 'number' &&
        typeof s.lng === 'number' &&
        /\b(tennis|turnier|match|phoenix|tc\b|fecht)/i.test(
          `${s.title} ${s.notes ?? ''}`,
        ),
    );
  if (tennisStop?.lat != null && tennisStop.lng != null) {
    return {
      lat: tennisStop.lat,
      lng: tennisStop.lng,
      title: tennisStop.title.replace(/^[📌📍✨🏁🔔🥇🥈]\s*/u, '').slice(0, 28),
    };
  }

  // Session-Fix (noch nicht als Timeline-Stop) — z. B. nach Club-Geocode
  try {
    const session = usePlanSessionStore.getState().plan;
    const node = session?.fixedNodes?.find(
      (n) =>
        typeof n.lat === 'number' &&
        typeof n.lng === 'number' &&
        /\b(tennis|turnier|match|phoenix|tc\b|fecht)/i.test(
          `${n.title} ${n.location ?? ''} ${n.address ?? ''}`,
        ),
    );
    if (node && typeof node.lat === 'number' && typeof node.lng === 'number') {
      return {
        lat: node.lat,
        lng: node.lng,
        title: (node.location || node.title).slice(0, 28),
      };
    }
  } catch {
    /* soft */
  }

  const prev = resolvePreviousPlanStop(wish);
  if (
    prev &&
    !isGpsMetaTitle(prev.title) &&
    !(prev.id ?? '').startsWith('anchor_') &&
    haversineMeters(prev.lat, prev.lng, gps.lat, gps.lng) > 120
  ) {
    return {
      lat: prev.lat,
      lng: prev.lng,
      title: prev.title.replace(/^[📌📍✨🏁🔔🥇🥈]\s*/u, '').slice(0, 28),
    };
  }
  // Nur GPS-Anker in der Timeline → Distanz von hier
  if (
    prev &&
    !isGpsMetaTitle(prev.title) &&
    haversineMeters(prev.lat, prev.lng, gps.lat, gps.lng) <= 120
  ) {
    // Prev ist faktisch am GPS — trotzdem „hier“
    return { lat: gps.lat, lng: gps.lng, title: 'hier' };
  }
  return { lat: gps.lat, lng: gps.lng, title: 'hier' };
}

/** Vorheriger fester Stop vor dem Wunsch — Distanz-Bezug. */
export function resolvePreviousPlanStop(wish: IngestOpenWish): {
  lat: number;
  lng: number;
  title: string;
  id?: string;
} | null {
  const dayKey = useFuturePlanStore.getState().plan.dayKey;
  const wishMs = (() => {
    if (!wish.estimatedTime) return null;
    const m = wish.estimatedTime.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const [y, mo, d] = dayKey.split('-').map(Number);
    return new Date(y!, mo! - 1, d!, Number(m[1]), Number(m[2]), 0, 0).getTime();
  })();
  const stops = useFuturePlanStore
    .getState()
    .plan.stops.filter(
      (s) =>
        s.kind !== 'nav_leg' &&
        s.kind !== 'wish' &&
        !s.id.startsWith('choice_') &&
        typeof s.lat === 'number' &&
        typeof s.lng === 'number',
    )
    .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0));
  if (stops.length === 0) return null;
  let prev = stops[0]!;
  if (wishMs != null) {
    for (const s of stops) {
      if ((s.plannedStartMs ?? 0) <= wishMs) prev = s;
      else break;
    }
  } else {
    prev = stops[stops.length - 1]!;
  }
  return {
    id: prev.id,
    lat: prev.lat!,
    lng: prev.lng!,
    title: prev.title.replace(/^[📌📍✨🏁🔔🥇🥈]\s*/u, '').trim(),
  };
}

function isCityLikeDistLabel(title: string): boolean {
  const t = title.trim().toLowerCase();
  if (!t || t === 'hier' || t === 'start') return true;
  if (/^(start|gps)/i.test(t)) return true;
  try {
    const bag = readRucksackSync();
    const city = String(bag.cityHint ?? '')
      .trim()
      .toLowerCase();
    if (city && (t === city || t.startsWith(`${city} `) || t.includes(city))) {
      // Zielstadt als Distanz-Bezug → wirkt wie „21 km von Hamburg“ obwohl User woanders steht
      return true;
    }
  } catch {
    /* soft */
  }
  // Bekannte DE-Städte kurz
  return /^(hamburg|berlin|münchen|muenchen|köln|koeln|frankfurt|stuttgart|dresden|leipzig|bremen|hannover|nürnberg|nuernberg|dortmund|essen|duisburg|bochum|wuppertal|bielefeld|bonn|münster|muenster|karlsruhe|mannheim|augsburg|wiesbaden|gelsenkirchen|mönchengladbach|moenchengladbach|braunschweig|chemnitz|kiel|aachen|halle|magdeburg|freiburg|krefeld|lübeck|luebeck|oberhausen|erfurt|mainz|rostock|kassel|hagen|hamm|saarbrücken|saarbruecken|potsdam|ludwigshafen|oldenburg|osnabrück|osnabrueck|heidelberg|darmstadt|regensburg|würzburg|wuerzburg|ingolstadt|ulm|heilbronn|pforzheim|wolfsburg|göttingen|goettingen|bottrop|reutlingen|koblenz|remscheid|bergisch|prisdorf|pinneberg|tornesch|ellerhoop)\b/i.test(
    t,
  );
}

function formatDistFromPrev(
  lat: number,
  lng: number,
  prev: { lat: number; lng: number; title: string } | null,
): string | null {
  if (!prev) return null;
  const m = Math.round(haversineMeters(prev.lat, prev.lng, lat, lng));
  const raw = isGpsMetaTitle(prev.title) ? 'hier' : prev.title.slice(0, 28);
  const label = isCityLikeDistLabel(raw) ? 'hier' : raw;
  const suffix = label === 'hier' ? 'deiner Position' : label;
  if (m < 80) return 'in der Nähe';
  if (m < 1000) {
    return label === 'hier'
      ? `${m} m von hier`
      : `${m} m von ${label}`;
  }
  const km = (m / 1000).toFixed(1).replace('.', ',');
  return label === 'hier'
    ? `${km} km von hier (deiner Position)`
    : `${km} km von ${suffix}`;
}

/** Stichpunkte: echte Distanz + Pitch-Fakten, keine GPS-Meta-Müllzeilen. */
function buildUsefulBullets(opts: {
  rating: number | null | undefined;
  dist: string | null;
  llmBullets: string[];
  speechPitch: string;
  walk: boolean;
}): string[] {
  const fromPitch: string[] = [];
  const pitch = opts.speechPitch;
  const price = pitch.match(
    /\b(\d{1,3}\s*€|\d{1,3}\s*Euro|ca\.?\s*\d{1,3}\s*€)/i,
  );
  if (price) fromPitch.push(price[1]!.replace(/\s+/g, ' '));
  const dish = pitch.match(
    /\b(Fisch(?:gericht)?|Burger|Bowl|Pizza|Pasta|Schnitzel|Steak|Salat|Aussicht|Ufer|Park|Promenade)[^.!]{0,24}/i,
  );
  if (dish) fromPitch.push(dish[0]!.trim().slice(0, 36));

  const llm = opts.llmBullets.filter(
    (b) =>
      !/0\s*m|aktuelle\s+gps|gps-position|von hier\s*$/i.test(b) &&
      !(/^bewertung offen$/i.test(b) && opts.rating != null),
  );

  return normalizePlanBullets(
    [
      ratingLabel(opts.rating),
      opts.dist,
      ...fromPitch,
      ...llm,
      opts.walk ? 'Spazier-Spot' : null,
    ],
    3,
  );
}

function clearAllChoiceStops(dayKey?: string): void {
  const key = dayKey ?? useFuturePlanStore.getState().plan.dayKey;
  useFuturePlanStore.getState().ensureDay(key);
  const stops = [...useFuturePlanStore.getState().getPlanForDay(key).stops];
  for (const s of stops) {
    if (s.id.startsWith('choice_')) {
      useFuturePlanStore.getState().removeStop(s.id);
    }
  }
}

function clearPreviousChoices(_stepKey: string, dayKey?: string): void {
  // Immer alle alten Vorschläge weg — sonst 4 Karten / Müll vom letzten Schritt
  clearAllChoiceStops(
    dayKey ??
      usePlanCalendarUiStore.getState().requestedDayKey ??
      useFuturePlanStore.getState().plan.dayKey,
  );
}

function wishOfferKind(wish: IngestOpenWish, placeName = ''): OfferKind {
  return detectOfferKind(`${wish.title} ${wish.context} ${placeName}`);
}

function resolveOfferAction(
  wish: IngestOpenWish,
  card: DeepResearchUiCard,
): {
  id: string;
  label: string;
  shortLabel: string;
  url: string;
} | null {
  const blob = `${wish.title} ${wish.context} ${card.name}`;
  if (isHotelWishText(blob)) {
    try {
      const {
        finalizeHotelBookAffiliateUrl,
        isHotelRoomSelectUrl,
        isExpediaHotelSearchUrl,
      } = require('../../services/affiliate/hotelPropertyDeepLink') as {
        finalizeHotelBookAffiliateUrl: (o: {
          hotelName: string;
          city?: string | null;
          bookUrl?: string | null;
          checkin: string;
          checkout: string;
          adults?: number;
        }) => string;
        isHotelRoomSelectUrl: (u: string) => boolean;
        isExpediaHotelSearchUrl: (u: string) => boolean;
      };
      const { parseHotelStayDatesForPlan } = require('./planStayDates') as {
        parseHotelStayDatesForPlan: (
          blob: string,
          dayKey?: string | null,
        ) => { checkin: string; checkout: string };
      };
      const dayKey =
        usePlanCalendarUiStore.getState().requestedDayKey ??
        useFuturePlanStore.getState().plan.dayKey;
      const { checkin, checkout } = parseHotelStayDatesForPlan(blob, dayKey);
      const { parseHotelAdults } = require('../../services/concierge/hotelAvailabilityService') as {
        parseHotelAdults: (t: string) => number;
      };
      const adults = parseHotelAdults(blob);
      const hotelName = card.name.split(/[|,]/)[0]!.trim() || card.name;
      const city =
        extractCityFromText(blob) ||
        extractExploreCityHint(wish) ||
        null;
      // Live Stay22/Expedia Property-Link am Card hat Vorrang
      const liveBook =
        card.actions.ticketUrl &&
        /^https?:\/\//i.test(card.actions.ticketUrl) &&
        !/google\.[^/]+\/search/i.test(card.actions.ticketUrl)
          ? card.actions.ticketUrl
          : null;
      const url = finalizeHotelBookAffiliateUrl({
        hotelName,
        city,
        bookUrl: liveBook,
        checkin,
        checkout,
        adults,
      });
      const roomReady = isHotelRoomSelectUrl(url);
      const searchOnly = isExpediaHotelSearchUrl(url);
      return {
        id: 'hotel_book',
        label: roomReady
          ? '🏨 Zimmer buchen'
          : searchOnly
            ? '🏨 Hotels ansehen'
            : '🏨 Zimmer buchen',
        shortLabel: roomReady ? 'Buchen' : searchOnly ? 'Hotels' : 'Buchen',
        url,
      };
    } catch {
      /* soft */
    }
  }
  const kind = wishOfferKind(wish, card.name);
  if (kind === 'ticket') {
    try {
      const q = `${card.name} Tickets`.trim();
      const direct =
        card.actions.ticketUrl &&
        /^https?:\/\//i.test(card.actions.ticketUrl) &&
        !/google\.[^/]+\/search/i.test(card.actions.ticketUrl)
          ? card.actions.ticketUrl
          : null;
      const url =
        preferTicketSource({
          kind: 'attraction',
          query: q,
          priced: direct ? [{ url: direct }] : undefined,
        }).url ||
        direct ||
        buildGetYourGuideSearchUrl(q);
      if (url) {
        return {
          id: 'ticket',
          label: '🎟 Tickets',
          shortLabel: 'Tickets',
          url,
        };
      }
    } catch {
      /* soft */
    }
  }
  const raw =
    kind === 'ticket'
      ? card.actions.ticketUrl || card.actions.menuUrl || null
      : card.actions.menuUrl || card.actions.ticketUrl || null;
  const hit = resolveContextualOffer(
    `${wish.title} ${wish.context} ${card.name}`,
    raw,
  );
  if (!hit) return null;
  return {
    id: hit.kind,
    label: hit.label,
    shortLabel: hit.shortLabel,
    url: hit.url,
  };
}

/**
 * Upsert 🥇/🥈 als choice_* FuturePlanStops (pending_change).
 * Auswahl nur per Timeline-Tap; Short-Answer = „Neu suchen“.
 */
async function publishChoiceUi(
  wish: IngestOpenWish,
  result: DeepResearchPitchResult,
): Promise<void> {
  // Exakt 2 unterschiedliche Karten — nie 1 doppelte, nie 4; nie schon in Timeline
  const booked = timelineBookedPlaces();
  const unique: DeepResearchUiCard[] = [];
  for (const c of result.uiCards) {
    if (!c?.name) continue;
    if (
      unique.some(
        (u) => u.name.toLowerCase() === c.name.toLowerCase(),
      )
    ) {
      continue;
    }
    if (
      isAlreadyOnTimeline(
        {
          name: c.name,
          placeId: c.placeId ?? null,
          lat: c.lat,
          lng: c.lng,
        },
        booked,
      )
    ) {
      continue;
    }
    unique.push(c);
    if (unique.length >= 2) break;
  }
  if (unique.length < 1) return;

  const dayKey =
    usePlanCalendarUiStore.getState().requestedDayKey &&
    /^\d{4}-\d{2}-\d{2}$/.test(
      usePlanCalendarUiStore.getState().requestedDayKey!,
    )
      ? usePlanCalendarUiStore.getState().requestedDayKey!
      : useFuturePlanStore.getState().plan.dayKey;
  useFuturePlanStore.getState().ensureDay(dayKey);
  try {
    usePlanCalendarUiStore.getState().requestDayKey(dayKey);
    usePlanCalendarUiStore.getState().requestOpen();
  } catch {
    /* soft */
  }
  const stepKey = wish.id ?? wish.title;
  const dayStops = useFuturePlanStore.getState().getPlanForDay(dayKey).stops;
  let startMs = parseTimeToMs(dayKey, wish.estimatedTime ?? null);
  const hotelWish = isHotelWishText(`${wish.title} ${wish.context}`);
  if (startMs == null && hotelWish) {
    const { hotelCheckInMs } = require('./planHotelTiming') as {
      hotelCheckInMs: (
        w: IngestOpenWish,
        dk: string,
        stops: typeof dayStops,
      ) => number | null;
    };
    startMs = hotelCheckInMs(wish, dayKey, dayStops);
  }
  const nowMs = Date.now();
  // Soft-Wünsche: nie feste Termine überdecken; Soft darf clampen, Hard nicht
  if (!hotelWish) {
    try {
      const {
        dayBoundsMs,
        findFreeSlotStartMs,
        hardIntervalsFromStops,
      } = require('./planHardLock') as typeof import('./planHardLock');
      const bounds = dayBoundsMs(dayKey);
      const free = findFreeSlotStartMs({
        preferredStartMs: startMs,
        durationMs: 45 * 60_000,
        hardIntervals: hardIntervalsFromStops(dayStops),
        dayStartMs: bounds.start,
        dayEndMs: bounds.end,
        nowFloorMs:
          dayKey === todayDateKey() ? nowMs + 15 * 60_000 : bounds.start,
      });
      if (free != null) startMs = free;
    } catch {
      if (
        dayKey === todayDateKey() &&
        startMs != null &&
        isPastMs(startMs, nowMs)
      ) {
        startMs = clampToFutureMs(startMs, { nowMs, minAheadMs: 25 * 60_000 });
      }
    }
  } else if (
    dayKey === todayDateKey() &&
    startMs != null &&
    isPastMs(startMs, nowMs)
  ) {
    startMs = clampToFutureMs(startMs, { nowMs, minAheadMs: 25 * 60_000 });
  }
  // Abend-/Spazier-Wunsch mit Mittags-Slot → 19:00 (wenn noch Zukunft)
  if (
    startMs != null &&
    /\b(abend|dinner|tonight|spazier|bummel)\b/i.test(
      `${wish.title} ${wish.context}`,
    )
  ) {
    const h = new Date(startMs).getHours();
    if (h >= 11 && h < 16) {
      const [y, mo, d] = dayKey.split('-').map(Number);
      const eve = new Date(y!, mo! - 1, d!, 19, 0, 0, 0).getTime();
      startMs =
        dayKey === todayDateKey() && isPastMs(eve, nowMs)
          ? clampToFutureMs(eve, { nowMs, minAheadMs: 25 * 60_000 })
          : eve;
    }
  }
  clearPreviousChoices(stepKey, dayKey);
  usePlanCalendarUiStore.getState().clearPendingChoice();
  usePlanCalendarUiStore.getState().clearMirroredActions();

  const a = unique[0]!;
  const b = unique[1] ?? unique[0]!;
  // Hotels: immer 2 Karten wenn 2 Unique da — nie auf 1 kürzen
  // Andere Wünsche: bei nur 1 Unique lieber 1 sauber als Fake-Doppel
  const sides: Array<{
    card: DeepResearchUiCard;
    side: 'left' | 'right';
    medal: string;
    role: 'favorite' | 'alternative';
  }> =
    unique.length >= 2 || hotelWish
      ? [
          { card: a, side: 'left', medal: '🥇', role: 'favorite' },
          {
            card: unique.length >= 2 ? b : a,
            side: 'right',
            medal: '🥈',
            role: 'alternative',
          },
        ]
      : [{ card: a, side: 'left', medal: '🥇', role: 'favorite' }];

  // Hotel mit nur 1 Unique: zweiten Slot weglassen (kein Fake-Doppel)
  if (hotelWish && unique.length < 2) {
    sides.length = 1;
  }

  const toCard = (
    c: DeepResearchUiCard,
    role: 'favorite' | 'alternative',
    side: 'left' | 'right',
  ): PlanChoiceCard => {
    const offer = resolveOfferAction(wish, c);
    const mapsUrl =
      c.actions.mapsUrl?.trim() ||
      mapsUrlFor(c.name, c.lat, c.lng, c.placeId);
    return {
      id: `choice_${stepKey}_${side}`,
      title: `${role === 'favorite' ? '🥇' : '🥈'} ${c.name}`,
      lat: c.lat,
      lng: c.lng,
      subtitle: normalizePlanBullets([...(c.bulletPoints ?? [])], 3).join('\n'),
      bullets: normalizePlanBullets([...(c.bulletPoints ?? [])], 3),
      mapsUrl,
      menuUrl: offer?.url ?? null,
      placeId: c.placeId ?? null,
      proposalRole: role,
      actionCards: [
        { id: 'maps', label: '🗺️ Maps', url: mapsUrl },
        ...(offer
          ? [{ id: offer.id, label: offer.label, url: offer.url }]
          : []),
      ],
    };
  };

  for (const { card, side, medal, role } of sides) {
    const id = `choice_${stepKey}_${side}`;
    const noteLines = normalizePlanBullets([...(card.bulletPoints ?? [])], 3);
    const pitchLine = sanitizePlanSpeech(
      stripLeadingPlaceName(card.speechPitch || '', card.name),
    ).slice(0, 320);
    const offer = resolveOfferAction(wish, card);
    useFuturePlanStore.getState().upsertStopOnDay(dayKey, {
      id,
      title: `${medal} ${card.name}`,
      lat: card.lat,
      lng: card.lng,
      plannedStartMs: startMs,
      plannedEndMs: hotelWish || startMs == null ? null : startMs + 60 * 60_000,
      bufferMin: 10,
      transport: 'walk',
      kind: 'stop',
      status: 'pending_change',
      planPriority: wish.priority,
      choiceSide: side,
      choiceGroupId: stepKey,
      planTaskId: stepKey,
      notes: [...noteLines, pitchLine].filter(Boolean).join('\n'),
      mapsUrl: card.actions.mapsUrl,
      menuUrl: offer?.url ?? null,
      reserveUrl: card.actions.reserveUrl ?? null,
      emoji: medal,
      userFixedTime: wish.priority <= 2 && Boolean(wish.estimatedTime),
    });
    void role;
  }

  try {
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }

  const pending: PlanPendingChoice = {
    stepKey,
    headline: wish.title,
    anchorTimeMs: startMs,
    anchorTimeLabel: wish.estimatedTime ?? null,
    options: [
      toCard(a, 'favorite', 'left'),
      toCard(
        unique.length >= 2 ? b : a,
        'alternative',
        unique.length >= 2 ? 'right' : 'right',
      ),
    ],
  };
  // Wenn nur 1 Ort: options trotzdem 2 slots mit gleichem — better fix options type
  if (unique.length < 2) {
    pending.options = [toCard(a, 'favorite', 'left'), toCard(a, 'favorite', 'left')];
  }

  usePlanCalendarUiStore.getState().setPendingChoice(pending);

  // Bottom: Neu suchen links + rechts (Auswahl nur Timeline)
  usePlanCalendarUiStore.getState().setShortAnswers([
    {
      id: 'reject_l',
      label: 'Neu suchen',
      action: 'plan_reject',
    },
    {
      id: 'reject_r',
      label: 'Neu suchen',
      action: 'plan_reject',
    },
  ]);

  // Top: Maps + kontextueller Offer — dedupliziert, kein Google-Account
  const mirrored: QuickAction[] = [];
  const seenUrls = new Set<string>();
  for (const [i, card] of sides.map((s) => s.card).entries()) {
    const medal = i === 0 ? '🥇' : '🥈';
    const mapsUrl =
      card.actions.mapsUrl?.trim() ||
      mapsUrlFor(card.name, card.lat, card.lng, card.placeId);
    if (mapsUrl && isSafeOfferUrl(mapsUrl) && !seenUrls.has(mapsUrl)) {
      seenUrls.add(mapsUrl);
      mirrored.push({
        type: 'OPEN_URL',
        label: `${medal} Maps`,
        payload: { url: mapsUrl },
      });
    }
    if (isHotelWishText(`${wish.title} ${card.name}`)) {
      try {
        const { resolveHotelPropertyAffiliateUrl, isHotelRoomSelectUrl } =
          await import('../../services/affiliate/hotelPropertyDeepLink');
        const { parseHotelStayDatesForPlan } = await import('./planStayDates');
        const { parseHotelAdults } = await import(
          '../../services/concierge/hotelAvailabilityService'
        );
        const blob = `${wish.title} ${wish.context} ${card.name}`;
        const dayKeyH =
          usePlanCalendarUiStore.getState().requestedDayKey ??
          useFuturePlanStore.getState().plan.dayKey;
        const { checkin, checkout } = parseHotelStayDatesForPlan(blob, dayKeyH);
        const adults = parseHotelAdults(blob);
        const hotelName = card.name.split(/[|,]/)[0]!.trim() || card.name;
        const liveBook =
          card.actions.ticketUrl &&
          /^https?:\/\//i.test(card.actions.ticketUrl) &&
          !/google\.[^/]+\/search/i.test(card.actions.ticketUrl)
            ? card.actions.ticketUrl
            : null;
        const url = await resolveHotelPropertyAffiliateUrl({
          hotelName,
          city: extractCityFromText(blob) || extractExploreCityHint(wish),
          bookUrl: liveBook,
          checkin,
          checkout,
          adults,
        });
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          const city =
            extractCityFromText(blob) || extractExploreCityHint(wish);
          mirrored.push({
            type: 'OPEN_URL',
            label: isHotelRoomSelectUrl(url)
              ? `${medal} Zimmer buchen`
              : `${medal} Hotels ansehen`,
            payload: {
              url,
              destName: hotelName,
              destination: city || hotelName,
              checkin,
              checkout,
              adults,
            },
          });
        }
      } catch {
        /* soft */
      }
      continue;
    }
    const offer = resolveOfferAction(wish, card);
    if (offer && !seenUrls.has(offer.url)) {
      seenUrls.add(offer.url);
      mirrored.push({
        type: 'OPEN_URL',
        label: `${medal} ${offer.shortLabel}`,
        payload: { url: offer.url },
      });
    }
  }
  // Hotel: kein zusätzlicher Stadt-Suche-Link — Zimmer-buchen ist schon Property-Deep-Link
  if (
    isHotelWishText(`${wish.title} ${wish.context}`) &&
    !mirrored.some((a) => /zimmer\s*buch|hotels\s*anseh/i.test(a.label))
  ) {
    try {
      const { resolveHotelPropertyAffiliateUrl, isHotelRoomSelectUrl } =
        await import('../../services/affiliate/hotelPropertyDeepLink');
      const { parseHotelStayDatesForPlan } = await import('./planStayDates');
      const { parseHotelAdults } = await import(
        '../../services/concierge/hotelAvailabilityService'
      );
      const blob = `${wish.title} ${wish.context}`;
      const dayKey =
        usePlanCalendarUiStore.getState().requestedDayKey ??
        useFuturePlanStore.getState().plan.dayKey;
      const { checkin, checkout } = parseHotelStayDatesForPlan(blob, dayKey);
      const adults = parseHotelAdults(blob);
      const hotelName =
        unique[0]?.name.split(/[|,]/)[0]?.trim() || wish.title;
      const url = await resolveHotelPropertyAffiliateUrl({
        hotelName,
        city: extractCityFromText(blob) || extractExploreCityHint(wish),
        bookUrl: unique[0]?.actions.ticketUrl ?? null,
        checkin,
        checkout,
        adults,
      });
      if (!seenUrls.has(url) && mirrored.length < 6) {
        seenUrls.add(url);
        mirrored.push({
          type: 'OPEN_URL',
          label: isHotelRoomSelectUrl(url)
            ? '🏨 Zimmer buchen'
            : '🏨 Hotels ansehen',
          payload: {
            url,
            destName: hotelName,
            destination:
              extractCityFromText(blob) ||
              extractExploreCityHint(wish) ||
              hotelName,
            checkin,
            checkout,
            adults,
          },
        });
      }
    } catch {
      /* soft */
    }
  }
  // Mietwagen: nur wenn Hilfe-Moment (Flughafen/Roadtrip/explizit)
  try {
    const moments = detectHelpFirstMoments({
      userText: `${wish.title} ${wish.context}`,
      planBlob: `${wish.title} ${wish.context}`,
    });
    if (
      moments.some((m) => m.kind === 'roadtrip_car' || m.kind === 'airport_access') &&
      mirrored.length < 6
    ) {
      const car = buildCarRentalAction();
      if (car.payload.url && !seenUrls.has(car.payload.url)) {
        seenUrls.add(car.payload.url);
        mirrored.push(car);
      }
    }
  } catch {
    /* soft */
  }
  usePlanCalendarUiStore.getState().setMirroredActions(mirrored.slice(0, 6));
  try {
    const { requestPlanScroll } = require('../timeline/planCalendarUiStore') as {
      requestPlanScroll: (t: { kind: 'choice'; stepKey: string }) => void;
    };
    requestPlanScroll({ kind: 'choice', stepKey });
  } catch {
    /* soft */
  }
}

/**
 * Deep Research + Pitch für einen offenen Wunsch.
 * Nur noch Pitch-Modul (v4) — kein Legacy-Gemini-2er-Pfad.
 * Hotels: Stay22 Spezialpfad wenn 2 Treffer.
 */
export async function executeDeepResearchAndPitch(
  wish: IngestOpenWish,
  opts?: { signal?: AbortSignal },
): Promise<DeepResearchPitchResult & { spokenText: string }> {
  if (isHotelWishText(`${wish.title} ${wish.context}`)) {
    const hotelPitch = await pitchHotelWishFromStay22(wish, opts);
    if (hotelPitch && hotelPitch.uiCards.length >= 1) {
      return hotelPitch;
    }
  }

  const { buildPitchRequestFromWish } = await import('../pitch/buildPitchRequest');
  const { runPitchModule } = await import('../pitch/runPitchModule');
  const { request, bridge } = buildPitchRequestFromWish(wish, {
    signal: opts?.signal,
    uiLayout: 'timeline_stack',
  });
  // Planung: kein Bridge-TTS — User hat schon genug Rede; Choice-Speech kommt explizit
  void bridge;
  // nur bei Live-Split (nicht Timeline) würde Parent bridge sprechen

  try {
    const result = await runPitchModule(request);
    const uiCards = result.options.map((o) => ({
      name: o.name,
      lat: o.lat,
      lng: o.lng,
      placeId: o.placeId ?? null,
      speechPitch: o.speechPitch,
      bulletPoints: o.bullets,
      address: null as string | null,
      actions: {
        mapsUrl: o.mapsUrl,
        menuStatus: (o.menuUrl ? 'READY' : 'SEARCHING') as
          | 'SEARCHING'
          | 'READY'
          | 'NONE',
        menuUrl: o.menuUrl ?? null,
        ticketUrl: o.ticketUrl ?? null,
        reserveUrl: null as string | null,
      },
    }));
    // Timeline-Stack: Choices auch ohne Stay22 sichtbar machen
    if (uiCards.length && request.uiLayout === 'timeline_stack') {
      await publishChoiceUi(wish, {
        summary: result.summary,
        uiCards,
      });
    }
    const spokenText =
      uiCards.length >= 1
        ? result.spokenText
        : 'Für den Slot finde ich gerade keine passenden Adressen — sag mir Stadt, Küche oder Gegend nochmal genauer.';
    return {
      summary: result.summary,
      uiCards,
      spokenText,
    };
  } catch (err) {
    console.warn('[module5] pitch module failed', err);
    const spokenText =
      'Gerade finde ich keine saubere Auswahl — sag mir Ort oder Küche nochmal genauer.';
    return { summary: undefined, uiCards: [], spokenText };
  }
}

/** Prefetch ohne UI-Publish (fire-and-forget). */
export function triggerAsyncDeepResearch(wish: IngestOpenWish | undefined): void {
  if (!wish) return;
  void (async () => {
    let anchor = resolveResearchAnchor();
    let cityName: string | null = extractExploreCityHint(wish);
    try {
      const { usePlanSessionStore } = await import('./planSessionState');
      cityName =
        usePlanSessionStore.getState().plan?.destinationCity ||
        usePlanSessionStore.getState().cityHint ||
        cityName;
      if (cityName && !/\bhier\b/i.test(cityName)) {
        const geo = await geocodePlaceName(cityName, { cityHint: cityName });
        if (geo) {
          anchor = { lat: geo.lat, lng: geo.lng, hint: cityName };
        }
      }
    } catch {
      /* soft */
    }
    await discoverCandidates(
      wish,
      { lat: anchor.lat, lng: anchor.lng },
      { cityName },
    );
  })().catch(() => undefined);
}

/**
 * Frühstück / Abendessen / Hotel / Landmarke+Ticket → Pitch-Modul.
 * Tour/Anreise bleiben Explore — nicht in denselben 2er-Gastro-Pitch.
 */
export function isPlanPitchWish(wish: IngestOpenWish): boolean {
  const t = `${wish.title} ${wish.context}`;
  if (
    /\b(anreise|aufbruch|hinfahrt|abfahrt|bahn\s+nach|zug\s+nach)\b/i.test(t) &&
    !/\b(frühstück|fruehstueck|restaurant|essen|hotel|michel|museum|turm)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  // Schon gewählte Landmarke + Fragen → Q&A, kein Top-2-Pitch
  try {
    const { looksLikeLandmarkQaText } = require('./planWalkOrder') as {
      looksLikeLandmarkQaText: (s: string) => boolean;
    };
    if (looksLikeLandmarkQaText(t)) return false;
  } catch {
    /* soft */
  }
  if (/\b(frühstück(?:en)?|fruehstueck(?:en)?|breakfast)\b/i.test(t)) return true;
  try {
    const { looksLikeLandmarkPitchText } = require('./planWalkOrder') as {
      looksLikeLandmarkPitchText: (s: string) => boolean;
    };
    if (looksLikeLandmarkPitchText(t)) return true;
  } catch {
    if (/\b(michel|museum|kirche|dom|turm|eintritt|raufgeh)\b/i.test(t)) {
      return true;
    }
  }
  if (isHotelWishText(t)) return true;
  if (
    /\b(restaurant|abendessen|mittagessen|dinner|lunch|café|cafe|bistro|imbiss|italiener|grieche|sushi|pizza|trattoria|osteria|brasserie|pannfisch|essen\s+gehen)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  const hm = wish.estimatedTime;
  if (
    hm &&
    hm >= '17:30' &&
    hm <= '21:45' &&
    /\b(essen|fisch|blick|sonnenuntergang|sunset)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

/** Landmarke Q&A (Michel etc.) — eigener Walk-Schritt, kein Pitch. */
export function isPlanLandmarkQaWish(wish: IngestOpenWish): boolean {
  try {
    const { looksLikeLandmarkQaText } = require('./planWalkOrder') as {
      looksLikeLandmarkQaText: (s: string) => boolean;
    };
    return looksLikeLandmarkQaText(`${wish.title} ${wish.context}`);
  } catch {
    return /\bmichel\b/i.test(`${wish.title} ${wish.context}`);
  }
}

/**
 * Fakten + Ticket-Link für schon gewählte Landmarke (kein Top-2).
 * Pack der Zielstadt zuerst; wenn dünn → Research-Hinweis.
 */
export async function executeLandmarkQaBrief(
  wish: IngestOpenWish,
): Promise<{
  spokenText: string;
  ticketUrl: string | null;
  bullets: string[];
}> {
  const name = (wish.title || 'der Ort').trim();
  let cityHint: string | null = null;
  try {
    const { usePlanSessionStore } = await import('./planSessionState');
    cityHint =
      usePlanSessionStore.getState().plan?.destinationCity ||
      usePlanSessionStore.getState().cityHint ||
      null;
  } catch {
    cityHint = null;
  }

  const packFacts: string[] = [];
  try {
    const { lookupPackFactsForSubject } = await import(
      '../agents/packFactLookup'
    );
    const hit = await lookupPackFactsForSubject({
      subject: name,
      cityHint,
      limitFacts: 8,
    });
    if (hit?.facts?.length) {
      packFacts.push(...hit.facts.map((f) => String(f).trim()).filter(Boolean));
    }
    if (hit?.liveHints?.length) {
      packFacts.push(
        ...hit.liveHints.map((f) => String(f).trim()).filter(Boolean).slice(0, 2),
      );
    }
  } catch {
    /* soft */
  }

  const ctxNotes = (wish.context || '')
    .split(/[|·]/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length >= 8 &&
        !/Sunset-Wetter|ÖPNV ≈|Ankunft nach/i.test(s),
    )
    .slice(0, 3);

  const facts = [...packFacts, ...ctxNotes]
    .map((s) => s.replace(/\s+/g, ' ').trim().slice(0, 160))
    .filter(Boolean);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const f of facts) {
    const k = f.toLowerCase().slice(0, 40);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(f);
  }

  let ticketUrl: string | null = null;
  try {
    const q = encodeURIComponent(
      `${name}${cityHint ? ` ${cityHint}` : ''} Tickets Eintritt`,
    );
    ticketUrl = `https://www.google.com/search?q=${q}`;
  } catch {
    ticketUrl = null;
  }

  const thin = unique.length < 2;
  if (thin) {
    try {
      // Dünn → leichte Live-Recherche (nicht blockierend lang)
      const { generateGeminiText } = await import('../../services/geminiService');
      const raw = await generateGeminiText(
        `Kurzfakten nur belegt zu ${name}${cityHint ? ` in ${cityHint}` : ''}: Höhe/Aussicht, Eintrittspreis, Dauer Besuch. Max 3 Stichpunkte, keine Erfindung. Stadt-agnostisch ehrlich wenn unbekannt.`,
        { useFindusSystem: false, maxOutputTokens: 220 },
      );
      const lines = String(raw || '')
        .split(/[\n•\-]+/)
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter((s) => s.length >= 12 && s.length < 140)
        .slice(0, 3);
      for (const l of lines) {
        if (!unique.some((u) => u.toLowerCase().includes(l.slice(0, 20).toLowerCase()))) {
          unique.push(l);
        }
      }
    } catch {
      /* soft */
    }
  }

  const factBits = unique.length
    ? unique.slice(0, 4).join(' ')
    : `Zu ${name} habe ich im Pack noch wenig — Eintritt und Aussicht hole ich live nach.`;
  const spokenText = `${name}: ${factBits} Ticket-Link liegt bereit — wenn du gebucht hast oder eine Uhrzeit hast, sag Bescheid, dann trage ich ihn fest ein.`.slice(
    0,
    900,
  );

  try {
    const { setOpenLandmarkTicket } = await import('./planLandmarkOpen');
    setOpenLandmarkTicket(name);
  } catch {
    /* soft */
  }

  return {
    spokenText,
    ticketUrl,
    bullets: [
      name,
      ...unique.slice(0, 2),
      ticketUrl ? 'Ticket-Link bereit' : 'Eintritt nachschauen',
    ].slice(0, 3),
  };
}

export function isExploreWish(wish: IngestOpenWish): boolean {
  const t = `${wish.title} ${wish.context}`.toLowerCase();
  // Explizit Gastro → kein Explore (auch wenn „Abend“ vorkommt)
  if (
    /\b(restaurant|essen|dinner|mittag|pizza|burger|café|cafe|imbiss|gastro|abendessen)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  return /erkunden|sightseeing|unbekannte\s+orte|stadt\s*tour|spazier|bummel|rundgang|wanderung|wanderweg|radweg|fahrradweg|radroute|entdecken|inspiration|abendspaziergang|frische\s*luft|must[-\s]?sees?|highlights?|highlight[-\s]?route|sehenswürdigkeit|sehenswuerdigkeit|gesehen\s+haben\s+m(ü|ue)sste|absolute[n]?\s+must|stadt\s+erkunden|\w+\s+erkunden|route\s+planen|klassische\s+\w+\s+highlights?/i.test(
    t,
  );
}

/** Spaziergang / Outdoor — keine Restaurant-Suche. */
export function isWalkWish(wish: IngestOpenWish): boolean {
  const t = `${wish.title} ${wish.context}`.toLowerCase();
  if (
    /\b(restaurant|essen|dinner|mittag|pizza|burger|café|cafe|imbiss|gastro)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  return /spazier|bummel|rundgang|wanderung|wanderweg|lehrpfad|radweg|fahrradweg|radroute|radtour|abendspaziergang|ufer|strand\s*lauf|park\s*lauf/i.test(
    t,
  );
}

/** Dauer aus Wunsch („zwei Stunden“, „2h“, „90 Min“) — Stunden. */
export function parseWishFreeHours(wish: IngestOpenWish): number | null {
  const blob = `${wish.title} ${wish.context}`.toLowerCase();
  const word = blob.match(
    /\b(ein(?:e)?|zwei|drei|vier|fünf|fuenf|sechs|1|2|3|4|5|6)\s*(?:-|–)?\s*(?:stunden?|std\.?|h)\b/i,
  );
  if (word) {
    const map: Record<string, number> = {
      ein: 1,
      eine: 1,
      '1': 1,
      zwei: 2,
      '2': 2,
      drei: 3,
      '3': 3,
      vier: 4,
      '4': 4,
      fünf: 5,
      fuenf: 5,
      '5': 5,
      sechs: 6,
      '6': 6,
    };
    const key = word[1]!.toLowerCase();
    if (map[key] != null) return map[key]!;
  }
  const min = blob.match(/\b(\d{2,3})\s*(?:min(?:uten)?)\b/i);
  if (min) {
    const m = Number(min[1]);
    if (Number.isFinite(m) && m > 0) return Math.max(0.5, m / 60);
  }
  const decimal = blob.match(/\b(\d+(?:[.,]\d+)?)\s*(?:stunden?|std\.?|h)\b/i);
  if (decimal) {
    const h = Number(decimal[1]!.replace(',', '.'));
    if (Number.isFinite(h) && h > 0 && h <= 12) return h;
  }
  return null;
}

/** Zielstadt: explizit > lokaler Stay/Profil > Rucksack — nie Chat-Sticky-Metropole. */
function extractExploreCityHint(wish: IngestOpenWish): string | null {
  const blob = `${wish.title} ${wish.context}`.replace(/\s+/g, ' ').trim();
  const known = extractCityFromText(blob);
  const profileCity = (() => {
    try {
      const p = getCachedUserProfile();
      return (p?.cityName || p?.cityId || '').trim() || null;
    } catch {
      return null;
    }
  })();
  const bagCity = (() => {
    try {
      return String(readRucksackSync().cityHint ?? '').trim() || null;
    } catch {
      return null;
    }
  })();

  // Fremde Stadt nur wenn explizit und ≠ Profil
  if (known) {
    return known;
  }

  if (wantsLocalCityStay(blob) || isWalkWish(wish) || isExploreWish(wish)) {
    return profileCity || bagCity || known;
  }

  const inMatch = blob.match(
    /\b(?:in|nach|für|fuer)\s+([A-ZÄÖÜ][\wÄÖÜäöüß\-]+(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß\-]+)?)/u,
  );
  if (inMatch?.[1] && !/^(den|die|das|dem|der|ein|eine)\b/i.test(inMatch[1])) {
    return inMatch[1].trim();
  }
  const lead = blob.match(
    /^([A-ZÄÖÜ][\wÄÖÜäöüß\-]+)\s+(?:erkunden|highlights?|must|sehens|tour|sightseeing)/iu,
  );
  if (lead?.[1]) return lead[1].trim();
  return profileCity || bagCity;
}

function estimateExploreFreeHours(
  wish: IngestOpenWish,
  dayKey: string,
): number {
  const startH = (() => {
    const m = wish.estimatedTime?.match(/^(\d{1,2}):/);
    return m ? Number(m[1]) : 10;
  })();
  const endH = Math.min(19, Math.max(startH + 4, 17));
  void dayKey;
  return Math.max(3, endH - startH);
}

/**
 * Explore → Tour-Modul (SSOT). Kein eigener Explore-Planner mehr.
 */
export async function executeExploreWishInsert(
  wish: IngestOpenWish,
  opts: {
    dayKey: string;
    fixedCount: number;
    freeHoursHint?: number | null;
    signal?: AbortSignal;
  },
): Promise<{ spokenText: string; inserted: number }> {
  const dayKey = opts.dayKey;
  void opts.fixedCount;
  const parsedHours = parseWishFreeHours(wish);
  const freeHours =
    parsedHours ??
    opts.freeHoursHint ??
    estimateExploreFreeHours(wish, dayKey);
  const forceDurationMin = Math.round(freeHours * 60);

  const { buildTourRequestFromWish, runTourModule } = await import('../tour');
  const { request, bridge } = buildTourRequestFromWish(wish, {
    signal: opts.signal,
    uiLayout: 'timeline_stack',
    forceDurationMin,
  });
  request.needsDurationAsk = false;
  request.timeBudgetMin = forceDurationMin;
  request.softDurationMin = forceDurationMin;
  const ref = resolveDistanceRef(wish);
  request.anchor = { lat: ref.lat, lng: ref.lng };
  request.planDayKey = dayKey;
  request.preferStartMs = (() => {
    const hm = wish.estimatedTime;
    if (!hm) {
      // Geplanter Tag (morgen/Montag) nie auf Jetzt — ~09:30 auf dem Plan-Tag.
      try {
        const { todayDateKey } = require('../../utils/dateKeys') as {
          todayDateKey: () => string;
        };
        if (dayKey !== todayDateKey()) {
          const [y, mo, d] = dayKey.split('-').map(Number);
          return new Date(y!, mo! - 1, d!, 9, 30, 0, 0).getTime();
        }
      } catch {
        /* soft */
      }
      // Morgen / Vormittag → ~09:30
      if (/\b(morgen(?:s)?|vormittag|früh|frueh)\b/i.test(`${wish.title} ${wish.context}`)) {
        const [y, mo, d] = dayKey.split('-').map(Number);
        return new Date(y!, mo! - 1, d!, 9, 30, 0, 0).getTime();
      }
      return null;
    }
    const m = hm.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const [y, mo, d] = dayKey.split('-').map(Number);
    return new Date(
      y!,
      mo! - 1,
      d!,
      Number(m[1]),
      Number(m[2]),
      0,
      0,
    ).getTime();
  })();
  // Hard-Ende: nächster Fix-Termin nach Tour-Start
  try {
    const {
      hardIntervalsFromStops,
    } = require('./planHardLock') as typeof import('./planHardLock');
    const stops = useFuturePlanStore.getState().getPlanForDay(dayKey).stops;
    const hard = hardIntervalsFromStops(stops);
    const start =
      request.preferStartMs ??
      (() => {
        try {
          const { todayDateKey } = require('../../utils/dateKeys') as {
            todayDateKey: () => string;
          };
          if (dayKey !== todayDateKey()) {
            const [y, mo, d] = dayKey.split('-').map(Number);
            return new Date(y!, mo! - 1, d!, 9, 30, 0, 0).getTime();
          }
        } catch {
          /* soft */
        }
        return Date.now();
      })();
    const next = hard.find((h) => h.start > start + 5 * 60_000);
    if (next) {
      request.hardArriveByMs = next.start;
      const maxMin = Math.max(
        25,
        Math.round((next.start - start) / 60_000) - 10,
      );
      if (forceDurationMin > maxMin) {
        request.timeBudgetMin = maxMin;
        request.softDurationMin = maxMin;
      }
    }
  } catch {
    /* soft */
  }
  request.uiLayout = 'timeline_stack';

  // Gebiet aus Wunsch geocoden (nicht GPS-Heimatpack)
  try {
    const areaHint =
      wish.address ||
      extractCityFromText(`${wish.title} ${wish.context}`) ||
      usePlanSessionStore.getState().plan?.destinationCity?.trim() ||
      (() => {
        const blob = `${wish.title} ${wish.context}`;
        const inM = blob.match(
          /\b(?:in|im|nach)\s+([A-ZÄÖÜ][\wÄÖÜäöüß-]{2,40}(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß-]{2,40})?)/,
        );
        if (inM?.[1]) return inM[1].trim();
        const lead = blob.match(
          /^([A-ZÄÖÜ][\wÄÖÜäöüß-]{2,40})\s+(?:erkunden|entdecken|bummel|highlight)/i,
        );
        return lead?.[1]?.trim() ?? null;
      })();
    if (areaHint) {
      request.areaHint = areaHint;
      request.cityHint = areaHint;
      const { geocodePlaceName } = await import(
        '../../services/navigation/googleMapsNav'
      );
      const geo = await geocodePlaceName(areaHint, {
        cityHint: areaHint,
      });
      if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
        request.anchor = { lat: geo.lat, lng: geo.lng };
      }
    }
  } catch {
    /* soft */
  }

  if (bridge) {
    try {
      const { enqueueSpeech } = await import('../speech/speechQueue');
      enqueueSpeech({
        kind: 'bridging',
        text: bridge,
        turnId: `explore_${wish.id ?? 'x'}`,
        alreadySpoken: false,
      });
    } catch {
      /* soft */
    }
  }

  const result = await runTourModule(request);
  // publishTourResult (in runTourModule) spiegelt bereits auf planDayKey
  const inserted = result.softFail ? 0 : result.stops.length;

  try {
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }

  try {
    usePlanCalendarUiStore.getState().setHeadlessPlanning(false);
    usePlanCalendarUiStore.getState().requestDayKey(dayKey);
    requestOpenPlanCalendar();
  } catch {
    /* soft */
  }

  usePlanCalendarUiStore.getState().clearPendingChoice();
  // Planung: keine Route-Action-Buttons
  usePlanCalendarUiStore.getState().setMirroredActions([]);

  return {
    spokenText: sanitizePlanSpeech(result.spokenText).slice(0, 1200),
    inserted,
  };
}

/**
 * Prio-6 / explore_* nach Amend neu in Lücken legen (Reihenfolge beibehalten).
 * Fixtermine bleiben; Laufwege danach via Gap-Fill.
 */
export function repackExploreStopsOnDay(dayKey: string): {
  moved: number;
} {
  const plan = useFuturePlanStore.getState().getPlanForDay(dayKey);
  const explore = plan.stops
    .filter(
      (s) =>
        s.id.startsWith('explore_') &&
        s.kind !== 'nav_leg' &&
        typeof s.lat === 'number' &&
        typeof s.lng === 'number',
    )
    .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0));
  if (explore.length === 0) return { moved: 0 };

  const fixed = plan.stops
    .filter(
      (s) =>
        !s.id.startsWith('explore_') &&
        !s.id.startsWith('choice_') &&
        s.kind !== 'nav_leg' &&
        s.kind !== 'wish' &&
        s.plannedStartMs != null &&
        (s.planPriority == null || s.planPriority <= 3 || s.hardAnchor),
    )
    .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0));

  const [y, mo, d] = dayKey.split('-').map(Number);
  const dayStart = new Date(y!, mo! - 1, d!, 10, 0, 0, 0).getTime();
  const dayEnd = new Date(y!, mo! - 1, d!, 18, 30, 0, 0).getTime();

  type Gap = { startMs: number; endMs: number };
  const gaps: Gap[] = [];
  if (fixed.length === 0) {
    gaps.push({ startMs: dayStart, endMs: dayEnd });
  } else {
    const firstStart = fixed[0]!.plannedStartMs!;
    if (firstStart - dayStart >= 40 * 60_000) {
      gaps.push({ startMs: dayStart, endMs: firstStart - 10 * 60_000 });
    }
    for (let i = 0; i < fixed.length - 1; i++) {
      const a = fixed[i]!;
      const b = fixed[i + 1]!;
      const aEnd = a.plannedEndMs ?? a.plannedStartMs! + 45 * 60_000;
      const bStart = b.plannedStartMs!;
      if (bStart - aEnd >= 40 * 60_000) {
        gaps.push({
          startMs: aEnd + 10 * 60_000,
          endMs: bStart - 10 * 60_000,
        });
      }
    }
    const last = fixed[fixed.length - 1]!;
    const lastEnd = last.plannedEndMs ?? last.plannedStartMs! + 45 * 60_000;
    if (dayEnd - lastEnd >= 40 * 60_000) {
      gaps.push({ startMs: lastEnd + 15 * 60_000, endMs: dayEnd });
    }
  }
  if (gaps.length === 0) {
    gaps.push({ startMs: dayStart, endMs: dayEnd });
  }

  let moved = 0;
  let gi = 0;
  let cursor = gaps[0]!.startMs;
  for (const stop of explore) {
    const dwell =
      stop.plannedEndMs != null && stop.plannedStartMs != null
        ? Math.max(20 * 60_000, stop.plannedEndMs - stop.plannedStartMs)
        : 40 * 60_000;
    while (gi < gaps.length) {
      const gap = gaps[gi]!;
      if (cursor < gap.startMs) cursor = gap.startMs;
      if (cursor + dwell <= gap.endMs + 15 * 60_000) break;
      gi += 1;
      if (gi < gaps.length) cursor = gaps[gi]!.startMs;
    }
    if (gi >= gaps.length) break;
    const start = cursor;
    const end = start + dwell;
    if (start !== stop.plannedStartMs || end !== stop.plannedEndMs) {
      useFuturePlanStore.getState().upsertStopOnDay(dayKey, {
        ...stop,
        plannedStartMs: start,
        plannedEndMs: end,
        status: 'pending_change',
        notes: [stop.notes, 'Neu sortiert (Prio 6)'].filter(Boolean).join('\n'),
      });
      moved += 1;
    }
    cursor = end + 8 * 60_000;
  }

  try {
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }
  return { moved };
}
