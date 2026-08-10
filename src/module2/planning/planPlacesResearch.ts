/**
 * Modul 5 — Deep Research + Pitch (Masterplan).
 */

import { generateGeminiText } from '../../services/geminiService';
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
import { getPlanWalkMPerMin } from '../../services/mobility/paceProfile';
import type { QuickAction } from '../../types/concierge';
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
import { FINDUS_FEW_SHOT_DISCLAIMER } from '../../services/concierge/findusResponsePolicy';
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

export const DEEP_RESEARCH_SYSTEM = `Du bist der Deep-Research Pitcher für Findus.
Wähle genau die besten 2 Orte und pitche jeden einzeln.
Bei Hotel/„günstigste“: IMMER zwei unterschiedliche Hotels (die zwei günstigsten), nie nur eines.

RECHERCHE:
- Anker = vorheriger Termin / hier — Distanz IMMER davon, ehrlich (nie „0 m“).
- Nur Orte aus KANDIDATEN mit echten Koordinaten — nichts erfinden, keine geschlossenen Venues.
- Deep Match Pflicht: Elbblick/Gericht/Spaziergang = muss zum Wunsch passen.
- Sterne ab 4.0; 4.5 nur Tie-Breaker.
- WALK/Spaziergang-Wunsch: Parks, Ufer, Aussicht, Wege — KEINE Restaurants.

STICHPUNKTE (genau 3 — aus dem Pitch, entscheidbar ohne Audio):
1) Sterne NUR: "4.3★ Gut" / "4.6★ Top" — NIEMALS extra „gut bewertet“.
2) Echte Distanz: "1,2 km von hier" / "800 m vom Hotel" — NIE „0 m“, NIE „Aktuelle GPS-Position“.
3) Nutzen: Gericht+Preis wenn belegt, oder Spazier-Highlight (Ufer, Aussicht, Ruhe) — kein Fluff.

PITCH speechPitch (~180–260 Zeichen):
- Motivierend, konkret. Keine Adresse/Tel/Mail.
- Namen NICHT am Satzanfang wiederholen (Client sagt „Erstens Name:“ schon).
- Zweite Option: mit „Dort …“ / „Der …“ anschließen — Namen nicht nochmal buchstabieren.
- Kein Abschluss-Frage (Client macht das). Kein Plan-Vorlesen.

${FINDUS_FEW_SHOT_DISCLAIMER}

GIB JSON:
{
  "summary": "Zwei Optionen für …",
  "uiCards": [
    {
      "name": "Ort",
      "speechPitch": "…",
      "bulletPoints": ["4.3★ Gut", "1,2 km von hier", "Pizza ~18 €"],
      "address": "nur UI",
      "actions": { "mapsUrl": "...", "menuStatus": "SEARCHING", "menuUrl": null }
    }
  ]
}`;

const NEAR_M = 800;

function ratingLabel(rating: number | null | undefined): string {
  return starBullet(rating) ?? 'Bewertung offen';
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() || t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapsUrlFor(
  name: string,
  lat: number,
  lng: number,
  placeId?: string | null,
): string {
  if (placeId) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      name,
    )}&query_place_id=${encodeURIComponent(placeId)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${name}@${lat},${lng}`,
  )}`;
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

  if (localOnly || walk || explore) {
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

function isHotelWishText(blob: string): boolean {
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
      hasExplicitStayDates,
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
    if (!hasExplicitStayDates(blob) && !wish.estimatedTime) {
      // Zeitraum unklar → normaler Places-Pfad / Confirm-Flow
      return null;
    }
    const { checkin, checkout } = parseHotelStayDates(blob);
    const adults = parseHotelAdults(blob);
    const nights = nightsBetween(checkin, checkout);
    const amenityNeeds = parseHotelAmenityNeeds(blob);
    const bag = readRucksackSync();
    const city =
      extractCityFromText(blob) ||
      extractExploreCityHint(wish) ||
      String(bag.cityHint ?? '').trim() ||
      'Germany';
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
    const pool =
      filtered.matched.length > 0
        ? filtered.matched
        : filtered.partial.length > 0
          ? filtered.partial
          : stays;
    const usedPartial =
      amenityNeeds.length > 0 && filtered.matched.length === 0;
    const picks = pickTwoHotelStays(pool, {
      wantCheap,
      wantQuality: false,
    });
    if (picks.length < 1) return null;

    const prev = resolveDistanceRef(wish);
    const needLabel = amenityNeeds.map((n) => n.label).join(' + ');
    const uiCards: DeepResearchUiCard[] = picks.slice(0, 2).map((s, i) => {
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
        .filter((x) =>
          /pool|sauna|spa|jacuzzi|frühstück|fruehstueck|breakfast|wellness|dampf/i.test(
            x,
          ),
        )
        .slice(0, 4)
        .join(', ');
      const speechPitch = sanitizePlanSpeech(
        [
          i === 0 ? 'Erstens' : 'Oder',
          s.name,
          am || null,
          price,
          s.stars != null ? `${s.stars} Sterne` : null,
          dist,
          wantCheap && i === 0 ? 'günstigste passende Live-Option' : null,
        ]
          .filter(Boolean)
          .join(' — '),
      ).slice(0, 700);
      const lat = s.lat ?? prev.lat;
      const lng = s.lng ?? prev.lng;
      return {
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
          ].filter(Boolean) as string[],
          speechPitch,
          walk: false,
        }),
        actions: {
          mapsUrl: mapsUrlFor(s.name, lat, lng, null),
          menuStatus: 'NONE' as const,
          menuUrl: null,
          ticketUrl: s.bookUrl,
        },
      };
    });

    const result: DeepResearchPitchResult = {
      summary: usedPartial
        ? `Kein voller Match${needLabel ? ` (${needLabel})` : ''} — beste Teil-Treffer`
        : wantCheap
          ? 'Zwei günstigste passende Hotels live'
          : needLabel
            ? `Zwei Hotels mit ${needLabel}`
            : 'Zwei Hotels live',
      uiCards,
    };
    publishChoiceUi(wish, result);
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
  if (hotel) {
    // Kurz: Name + ein Vorteil — nicht den Pitch doppelt vorlesen
    const line = (c: DeepResearchUiCard | undefined, n: number) => {
      if (!c) return '';
      const tip = sanitizePlanSpeech(
        stripLeadingPlaceName(c.speechPitch || '', c.name),
      )
        .split(/[.!?]/)[0]
        ?.trim()
        .slice(0, 90);
      return `${n === 1 ? 'Erstens' : 'Oder'} ${c.name}${tip ? ` — ${tip}` : ''}.`;
    };
    return sanitizePlanSpeech(
      [
        cleanIntro || 'Zwei Hotels in der Nähe:',
        line(a, 1),
        line(b, 2),
        'Was ist dein Favorit? Tippe oben — dann bereite ich die Buchung vor.',
      ]
        .filter(Boolean)
        .join(' '),
    ).slice(0, 420);
  }
  const pitchA = a
    ? sanitizePlanSpeech(
        `Erstens ${a.name}: ${stripLeadingPlaceName(a.speechPitch || '', a.name)}`,
      ).slice(0, 300)
    : '';
  const pitchB = b
    ? sanitizePlanSpeech(
        `Oder dort: ${stripLeadingPlaceName(b.speechPitch || '', b.name)}`,
      ).slice(0, 300)
    : '';
  return sanitizePlanSpeech(
    [cleanIntro || 'Zwei Optionen:', pitchA, pitchB, 'Was ist dein Favorit?']
      .filter(Boolean)
      .join(' … '),
  ).slice(0, 700);
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
  const bag = readRucksackSync();
  const gps = anchorCoords(bag);
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

function fallbackPitch(
  wish: IngestOpenWish,
  places: Array<{
    name: string;
    lat: number;
    lng: number;
    placeId: string | null;
    rating: number | null;
    mapsUrl: string;
    address?: string | null;
  }>,
  anchor: { lat: number; lng: number },
): DeepResearchPitchResult {
  const a = places[0];
  const b = places[1] ?? places[0];
  if (!a) {
    return {
      summary: `Für „${wish.title}“ nichts Greifbares in der Nähe.`,
      uiCards: [],
    };
  }
  const prev = resolveDistanceRef(wish);
  const walk = isWalkWish(wish);
  const makeCard = (
    p: typeof a,
  ): DeepResearchUiCard => {
    const dist = formatDistFromPrev(p.lat, p.lng, prev);
    const pitch = sanitizePlanSpeech(
      [
        walk
          ? `Schön zum Spazieren — ${ratingLabel(p.rating)}.`
          : `Passt gut zu „${wish.title}“ — ${ratingLabel(p.rating)}.`,
        dist ? `Liegt ${dist}.` : null,
      ]
        .filter(Boolean)
        .join(' '),
    ).slice(0, 520);
    return {
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      placeId: p.placeId,
      speechPitch: pitch,
      address: p.address ?? null,
      bulletPoints: buildUsefulBullets({
        rating: p.rating,
        dist,
        llmBullets: [],
        speechPitch: pitch,
        walk,
      }),
      actions: {
        mapsUrl: p.mapsUrl,
        menuStatus: 'SEARCHING',
        menuUrl: null,
        ticketUrl: null,
      },
    };
  };

  const uiCards = [a, b]
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => makeCard(p!));

  return {
    summary: sanitizePlanSpeech(`Kurz: zwei Optionen für ${wish.title}.`),
    uiCards,
  };
}

function clearAllChoiceStops(): void {
  const stops = [...useFuturePlanStore.getState().plan.stops];
  for (const s of stops) {
    if (s.id.startsWith('choice_')) {
      useFuturePlanStore.getState().removeStop(s.id);
    }
  }
}

function clearPreviousChoices(_stepKey: string): void {
  // Immer alle alten Vorschläge weg — sonst 4 Karten / Müll vom letzten Schritt
  clearAllChoiceStops();
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
      // Live Stay22 Deep-Link am Card (ticketUrl) hat Vorrang vor Stadt-Suche
      const liveBook =
        card.actions.ticketUrl &&
        /^https?:\/\//i.test(card.actions.ticketUrl) &&
        !/google\.[^/]+\/search/i.test(card.actions.ticketUrl)
          ? card.actions.ticketUrl
          : null;
      if (liveBook) {
        return {
          id: 'hotel_book',
          label: '🏨 Zimmer buchen',
          shortLabel: 'Buchen',
          url: liveBook,
        };
      }
      const {
        getExpediaAccommodationUrl,
        getStay22AccommodationUrl,
        getExpediaCamref,
      } = require('../../services/affiliate/affiliateService') as {
        getExpediaAccommodationUrl: (
          d: string,
          o?: { checkin?: string; checkout?: string; adults?: number },
        ) => string;
        getStay22AccommodationUrl: (
          d: string,
          o?: { checkin?: string; checkout?: string; adults?: number },
        ) => string;
        getExpediaCamref: () => string;
      };
      const {
        parseHotelStayDates,
        parseHotelAdults,
      } = require('../../services/concierge/hotelAvailabilityService') as {
        parseHotelStayDates: (t: string) => {
          checkin: string;
          checkout: string;
        };
        parseHotelAdults: (t: string) => number;
      };
      const { checkin, checkout } = parseHotelStayDates(blob);
      const adults = parseHotelAdults(blob);
      const dest = card.name.split(/[|,]/)[0]!.trim() || card.name;
      const url = getExpediaCamref()
        ? getExpediaAccommodationUrl(dest, { checkin, checkout, adults })
        : getStay22AccommodationUrl(dest, { checkin, checkout, adults });
      return {
        id: 'hotel_book',
        label: '🏨 Zimmer buchen',
        shortLabel: 'Buchen',
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
      const url =
        (card.actions.ticketUrl &&
        /^https?:\/\//i.test(card.actions.ticketUrl) &&
        !/google\.[^/]+\/search/i.test(card.actions.ticketUrl)
          ? card.actions.ticketUrl
          : null) ||
        preferTicketSource({ kind: 'attraction', query: q }).url ||
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
function publishChoiceUi(
  wish: IngestOpenWish,
  result: DeepResearchPitchResult,
): void {
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

  const dayKey = useFuturePlanStore.getState().plan.dayKey;
  const stepKey = wish.id ?? wish.title;
  let startMs = parseTimeToMs(dayKey, wish.estimatedTime ?? null);
  const nowMs = Date.now();
  if (dayKey === todayDateKey() && startMs != null && isPastMs(startMs, nowMs)) {
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
  clearPreviousChoices(stepKey);
  usePlanCalendarUiStore.getState().clearPendingChoice();
  usePlanCalendarUiStore.getState().clearMirroredActions();

  const a = unique[0]!;
  const b = unique[1] ?? unique[0]!;
  const hotelWish = isHotelWishText(`${wish.title} ${wish.context}`);
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
    const offer = resolveOfferAction(wish, card);
    useFuturePlanStore.getState().upsertStopOnDay(dayKey, {
      id,
      title: `${medal} ${card.name}`,
      lat: card.lat,
      lng: card.lng,
      plannedStartMs: startMs,
      plannedEndMs: startMs != null ? startMs + 60 * 60_000 : null,
      bufferMin: 10,
      transport: 'walk',
      kind: 'stop',
      status: 'pending_change',
      planPriority: wish.priority,
      choiceSide: side,
      choiceGroupId: stepKey,
      planTaskId: stepKey,
      notes: noteLines.join('\n'),
      mapsUrl: card.actions.mapsUrl,
      menuUrl: offer?.url ?? null,
      reserveUrl: card.actions.reserveUrl ?? null,
      emoji: medal,
      userFixedTime: Boolean(wish.estimatedTime),
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
    const offer = resolveOfferAction(wish, card);
    if (offer && !seenUrls.has(offer.url)) {
      seenUrls.add(offer.url);
      mirrored.push({
        type: 'OPEN_URL',
        label: isHotelWishText(`${wish.title} ${card.name}`)
          ? `${medal} Zimmer buchen`
          : `${medal} ${offer.shortLabel}`,
        payload: { url: offer.url },
      });
    }
  }
  // Hotel: zusätzlich Expedia/Stay22-Suche Stadtweit (Partner-Vergleich)
  if (isHotelWishText(`${wish.title} ${wish.context}`)) {
    try {
      const {
        buildExpediaAccommodationAction,
        buildStay22AccommodationAction,
        getExpediaCamref,
      } = require('../../services/affiliate/affiliateService') as {
        buildExpediaAccommodationAction: (
          d: string,
          o?: { checkin?: string; checkout?: string; adults?: number },
        ) => QuickAction;
        buildStay22AccommodationAction: (d: string) => QuickAction;
        getExpediaCamref: () => string;
      };
      const {
        parseHotelStayDates,
        parseHotelAdults,
      } = require('../../services/concierge/hotelAvailabilityService') as {
        parseHotelStayDates: (t: string) => {
          checkin: string;
          checkout: string;
        };
        parseHotelAdults: (t: string) => number;
      };
      const blob = `${wish.title} ${wish.context}`;
      const { checkin, checkout } = parseHotelStayDates(blob);
      const adults = parseHotelAdults(blob);
      const dest =
        unique[0]?.name.split(/[|,]/)[0]?.trim() ||
        wish.context ||
        wish.title;
      if (getExpediaCamref() && mirrored.length < 6) {
        const ex = buildExpediaAccommodationAction(dest, {
          checkin,
          checkout,
          adults,
        });
        if (!seenUrls.has(ex.payload.url!)) {
          seenUrls.add(ex.payload.url!);
          mirrored.push({
            ...ex,
            label: '🏨 Expedia Preise',
          });
        }
      } else if (mirrored.length < 6) {
        const st = buildStay22AccommodationAction(dest);
        if (st.payload.url && !seenUrls.has(st.payload.url)) {
          mirrored.push({
            type: 'BOOK_STAY22',
            label: '🏨 Stay22 Preise',
            payload: st.payload,
          });
        }
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
    if (hotelPitch && hotelPitch.uiCards.length >= 2) {
      return hotelPitch;
    }
  }

  const { buildPitchRequestFromWish } = await import('../pitch/buildPitchRequest');
  const { runPitchModule } = await import('../pitch/runPitchModule');
  const { request, bridge } = buildPitchRequestFromWish(wish, {
    signal: opts?.signal,
    uiLayout: 'timeline_stack',
  });
  if (bridge) {
    try {
      const { enqueueSpeech } = await import('../speech/speechQueue');
      enqueueSpeech({
        kind: 'bridging',
        text: bridge,
        turnId: `pitch_bridge_${request.requestId}`,
      });
    } catch {
      /* soft */
    }
  }

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
    return {
      summary: result.summary,
      uiCards,
      spokenText: result.spokenText,
    };
  } catch (err) {
    console.warn('[module5] pitch module failed', err);
    const spokenText =
      'Gerade finde ich keine saubere Auswahl — sag mir Ort oder Küche nochmal genauer.';
    return { summary: undefined, uiCards: [], spokenText };
  }
}

/** Speisekarte / Getränke / Tickets async nachreichen — kontextsicher, dedupliziert. */
async function enrichMenuUrlsAsync(
  wish: IngestOpenWish,
  cards: DeepResearchUiCard[],
): Promise<void> {
  if (cards.length < 1) return;
  if (isWalkWish(wish) || isExploreWish(wish)) return;
  // Pro Karte: Restaurant-Name reicht für Speisekarte, auch wenn Wunsch nur „Abend raus“ heißt
  const kinds = cards.map((c) => wishOfferKind(wish, c.name));
  let kind =
    kinds.find((k) => k === 'menu' || k === 'drinks') ??
    wishOfferKind(wish);
  if (kind !== 'menu' && kind !== 'drinks') {
    const anyGastro = cards.some((c) =>
      /\b(restaurant|pizzeria|bistro|café|cafe|trattoria|osteria|imbiss)\b/i.test(
        c.name,
      ),
    );
    if (!anyGastro) return;
    kind = 'menu';
  }
  try {
    const { runGastroMenuDeepResearch } = await import(
      '../agents/gastroMenuDeepResearch'
    );
    const queryHint =
      kind === 'drinks' ? 'Getränkekarte Drinks' : 'Speisekarte Menu';
    const res = await runGastroMenuDeepResearch({
      userText: `${wish.title} ${wish.context} ${queryHint}`,
      venues: cards.map((c) => ({
        name: c.name,
        websiteUrl: null,
        menuUrl: c.actions.menuUrl ?? null,
      })),
      alreadySaid: '',
    });
    const buttons = res.buttons ?? [];
    const mirrored = [
      ...usePlanCalendarUiStore.getState().mirroredActions,
    ].filter((a) => {
      const url =
        a.payload && typeof a.payload === 'object' && 'url' in a.payload
          ? String((a.payload as { url?: string }).url ?? '')
          : '';
      return !url || isSafeOfferUrl(url);
    });
    const seen = new Set(
      mirrored
        .map((a) =>
          a.payload && typeof a.payload === 'object' && 'url' in a.payload
            ? String((a.payload as { url?: string }).url ?? '')
            : '',
        )
        .filter(Boolean),
    );
    const offerUrls: string[] = [];
    for (const b of buttons) {
      const url =
        b.payload &&
        typeof b.payload === 'object' &&
        'url' in b.payload &&
        typeof (b.payload as { url?: unknown }).url === 'string'
          ? (b.payload as { url: string }).url.trim()
          : '';
      if (!url || !isSafeOfferUrl(url)) continue;
      const hit = resolveContextualOffer(
        `${wish.title} ${wish.context} ${b.label}`,
        url,
      );
      if (!hit || (hit.kind !== kind && hit.kind !== 'web')) continue;
      if (seen.has(url) || offerUrls.includes(url)) continue;
      offerUrls.push(url);
    }
    const labels = offerLabel(kind);
    for (let i = 0; i < cards.length; i++) {
      const medal = i === 0 ? '🥇' : '🥈';
      const url = offerUrls[i] ?? offerUrls[0];
      if (!url || seen.has(url)) continue;
      seen.add(url);

      const stepKey = wish.id ?? wish.title;
      const side = i === 0 ? 'left' : 'right';
      const stopId = `choice_${stepKey}_${side}`;
      const stop = useFuturePlanStore
        .getState()
        .plan.stops.find((s) => s.id === stopId);
      if (stop) {
        useFuturePlanStore.getState().upsertStop({
          ...stop,
          menuUrl: url,
        });
      }
      const labelKey = `${medal} ${labels.shortLabel}`;
      if (!mirrored.some((a) => a.label === labelKey)) {
        mirrored.push({
          type: 'OPEN_URL',
          label: labelKey,
          payload: { url },
        });
      }
    }
    usePlanCalendarUiStore.getState().setMirroredActions(mirrored.slice(0, 6));
  } catch (err) {
    console.warn('[module5] menu enrich failed', err);
  }
}

/** Prefetch ohne UI-Publish (fire-and-forget). */
export function triggerAsyncDeepResearch(wish: IngestOpenWish | undefined): void {
  if (!wish) return;
  void discoverCandidates(wish, resolveResearchAnchor()).catch(() => undefined);
}

/** Explore/Sightseeing: wie viele Stops je nach Tagesdichte. */
export function exploreStopCount(opts: {
  fixedCount: number;
  freeHoursHint?: number | null;
}): 3 | 8 | 12 {
  const free = opts.freeHoursHint;
  if (free != null && Number.isFinite(free)) {
    if (free <= 3) return 3;
    if (free <= 6) return 8;
    return 12;
  }
  if (opts.fixedCount >= 3) return 3;
  if (opts.fixedCount >= 1) return 8;
  return 12;
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

/** Typische Aufenthaltsdauer in Minuten — Recherche-Heuristik. */
function estimateDwellMin(name: string, context: string, tourMode = false): number {
  const t = `${name} ${context}`.toLowerCase();
  // Highlight-Route: kürzere Stops, damit 6–9 Orte in einen Tag passen
  if (tourMode) {
    if (/miniatur.?wunderland|wunderland/.test(t)) return 90;
    if (/museum|galerie|kunsthalle/.test(t)) return 55;
    if (/zoo|tierpark/.test(t)) return 75;
    if (/kirche|dom|cathedral/.test(t)) return 20;
    if (/elbphilharmonie|elbphi|aussicht|panorama|turm|michel/.test(t)) return 35;
    if (/park|garten|wiese|strand|hafen|speicherstadt|landungs|alster|rathaus|kontorhaus/.test(t)) {
      return 35;
    }
    return 40;
  }
  if (/miniatur.?wunderland|wunderland/.test(t)) return 180;
  if (/museum|galerie|kunsthalle/.test(t)) return 90;
  if (/kirche|dom|cathedral/.test(t)) return 25;
  if (/elbphilharmonie|elbphi|aussicht|panorama|turm|michel/.test(t)) return 45;
  if (/park|garten|wiese|strand|hafen|speicherstadt|elbbrücken|elbbruecken/.test(t)) {
    return 40;
  }
  if (/zoo|tierpark/.test(t)) return 150;
  return 50;
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
    const local = (profileCity || bagCity || '').toLowerCase();
    if (
      !local ||
      known.toLowerCase() === local ||
      local.includes(known.toLowerCase()) ||
      known.toLowerCase().includes(local)
    ) {
      return known;
    }
    // Explizit andere Stadt (z. B. „Hamburg erkunden“) — erlauben
    if (
      /\b(?:in|nach|für|fuer)\s+/i.test(blob) ||
      new RegExp(
        `^${known.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s+(?:erkunden|highlights?)`,
        'i',
      ).test(blob)
    ) {
      return known;
    }
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

/** Walking-Tour-Reihenfolge: Nearest-Neighbor ab Stadtzentrum. */
function orderAsWalkingTour<T extends { lat: number; lng: number; name: string }>(
  places: T[],
  start: { lat: number; lng: number },
  max: number,
  maxLegM = 12_000,
): T[] {
  const remaining = [...places];
  const ordered: T[] = [];
  let cur = { ...start };
  while (remaining.length > 0 && ordered.length < max) {
    remaining.sort(
      (a, b) =>
        haversineMeters(cur.lat, cur.lng, a.lat, a.lng) -
        haversineMeters(cur.lat, cur.lng, b.lat, b.lng),
    );
    const next = remaining.shift()!;
    // Ausreißer vom aktuellen Cluster skippen
    if (
      ordered.length > 0 &&
      haversineMeters(cur.lat, cur.lng, next.lat, next.lng) > maxLegM
    ) {
      continue;
    }
    ordered.push(next);
    cur = { lat: next.lat, lng: next.lng };
  }
  return ordered;
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
 * Explore: volle Highlight-Route in sinnvoller Lauf-Reihenfolge — kein Pitch, keine 2er-Auswahl.
 * User bestätigt oder sagt was nicht passt.
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
  const homeRef = resolveDistanceRef(wish);
  const walk = isWalkWish(wish);
  const parsedHours = parseWishFreeHours(wish);
  const freeHours =
    parsedHours ??
    opts.freeHoursHint ??
    estimateExploreFreeHours(wish, dayKey);
  const maxStops = exploreStopCount({
    fixedCount: opts.fixedCount,
    freeHoursHint: freeHours,
  });

  // Suche im Zielort — Default: aktuelle Stadt (Lock), Distanz-Label = Home-GPS
  let searchAnchor = {
    lat: homeRef.lat,
    lng: homeRef.lng,
    hint: homeRef.title === 'hier' ? 'GPS' : homeRef.title,
  };
  const cityHint = extractExploreCityHint(wish);
  const explicitOtherCity = extractCityFromText(`${wish.title} ${wish.context}`);
  const profileCityLower = (() => {
    try {
      const p = getCachedUserProfile();
      return (p?.cityName || p?.cityId || '').toLowerCase();
    } catch {
      return '';
    }
  })();
  const cityMatchesProfile =
    !!cityHint &&
    !!profileCityLower &&
    (cityHint.toLowerCase().includes(profileCityLower.split(/\s/)[0]!) ||
      profileCityLower.includes(cityHint.toLowerCase().split(/\s/)[0]!));
  const localOnly =
    wantsLocalCityStay(`${wish.title} ${wish.context}`) ||
    walk ||
    (!explicitOtherCity && !!cityHint) ||
    cityMatchesProfile;
  if (cityHint) {
    try {
      const geo = await geocodePlaceName(cityHint, { cityHint });
      if (geo?.lat != null && geo?.lng != null) {
        searchAnchor = { lat: geo.lat, lng: geo.lng, hint: cityHint };
      }
    } catch {
      /* soft — GPS bleibt Anker */
    }
  }

  const placesRaw = await discoverCandidates(
    {
      ...wish,
      title: wish.title || (walk ? 'Abendspaziergang' : 'Must-see Highlights'),
      context: walk
        ? `${wish.context} Parks Aussicht Spazierweg — keine Restaurants`
        : `${wish.context || ''} ${cityHint || ''} Must-sees Sehenswürdigkeiten Aussicht — kompakte Fußroute, keine Restaurants`,
    },
    { lat: searchAnchor.lat, lng: searchAnchor.lng },
    {
      localOnly,
      cityName: cityHint,
      cityBoundM: localOnly ? 6_000 : undefined,
    },
  );

  const places = orderAsWalkingTour(
    placesRaw,
    { lat: searchAnchor.lat, lng: searchAnchor.lng },
    Math.min(maxStops + 2, 14),
    localOnly ? 5_000 : 12_000,
  );

  const fixed = useFuturePlanStore
    .getState()
    .getPlanForDay(dayKey)
    .stops.filter(
      (s) =>
        s.kind !== 'wish' &&
        s.kind !== 'nav_leg' &&
        !s.id.startsWith('choice_') &&
        !s.id.startsWith('explore_') &&
        s.plannedStartMs != null,
    )
    .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0));

  // Zeitfenster: Lücken zwischen Fixterminen, sonst freies Fenster ab estimatedTime
  const gaps: Array<{ startMs: number; endMs: number }> = [];
  for (let i = 0; i < fixed.length - 1; i++) {
    const a = fixed[i]!;
    const b = fixed[i + 1]!;
    const aEnd = a.plannedEndMs ?? a.plannedStartMs! + 45 * 60_000;
    const bStart = b.plannedStartMs!;
    if (bStart - aEnd >= 50 * 60_000) {
      gaps.push({
        startMs: aEnd + 10 * 60_000,
        endMs: bStart - 10 * 60_000,
      });
    }
  }
  if (fixed.length > 0) {
    const last = fixed[fixed.length - 1]!;
    const lastEnd = last.plannedEndMs ?? last.plannedStartMs! + 45 * 60_000;
    gaps.push({
      startMs: lastEnd + 15 * 60_000,
      endMs: lastEnd + Math.round(freeHours * 60 * 60_000),
    });
  }
  if (gaps.length === 0) {
    const [y, mo, d] = dayKey.split('-').map(Number);
    const startH = (() => {
      const m = wish.estimatedTime?.match(/^(\d{1,2}):(\d{2})$/);
      return m ? Number(m[1]) : 10;
    })();
    const startMin = (() => {
      const m = wish.estimatedTime?.match(/^(\d{1,2}):(\d{2})$/);
      return m ? Number(m[2]) : 0;
    })();
    const endH = Math.min(19, Math.max(startH + Math.round(freeHours), 17));
    gaps.push({
      startMs: new Date(y!, mo! - 1, d!, startH, startMin, 0, 0).getTime(),
      endMs: new Date(y!, mo! - 1, d!, endH, 0, 0, 0).getTime(),
    });
  }

  for (const s of [...useFuturePlanStore.getState().getPlanForDay(dayKey).stops]) {
    if (s.id.startsWith(`explore_${wish.id ?? 'x'}`)) {
      useFuturePlanStore.getState().removeStop(s.id);
    }
  }

  let inserted = 0;
  const names: string[] = [];
  let prev = {
    lat: homeRef.lat,
    lng: homeRef.lng,
    title: 'hier' as string,
  };
  let pi = 0;
  const walkMPerMin = getPlanWalkMPerMin();

  for (const gap of gaps) {
    if (pi >= places.length || inserted >= maxStops) break;
    let cursor = gap.startMs;
    while (pi < places.length && inserted < maxStops) {
      const p = places[pi++]!;
      const distM = haversineMeters(prev.lat, prev.lng, p.lat, p.lng);
      const walkMin = Math.max(3, Math.ceil(distM / walkMPerMin));
      // Lokale Fußroute: nie als Fern-ÖPNV skalieren
      const longHaul = !localOnly && inserted === 0 && distM > 5000;
      const travelMin = longHaul
        ? Math.min(90, Math.max(35, Math.round(distM / 450)))
        : walkMin > 20
          ? Math.max(12, Math.round(walkMin * 0.55))
          : walkMin;
      cursor += travelMin * 60_000;
      const dwell = estimateDwellMin(p.name, wish.context, true);
      const end = cursor + dwell * 60_000;
      if (end > gap.endMs + 20 * 60_000) {
        // passt nicht mehr — nächsten Kandidaten versuchen wenn kürzer
        if (dwell > 50) continue;
        break;
      }
      const distBullet =
        inserted === 0
          ? formatDistFromPrev(p.lat, p.lng, {
              lat: homeRef.lat,
              lng: homeRef.lng,
              title: 'hier',
            })
          : formatDistFromPrev(p.lat, p.lng, prev);

      useFuturePlanStore.getState().upsertStopOnDay(dayKey, {
        id: `explore_${wish.id ?? 'x'}_${inserted}_${p.placeId ?? p.name.slice(0, 10)}`,
        title: p.name,
        lat: p.lat,
        lng: p.lng,
        plannedStartMs: cursor,
        plannedEndMs: end,
        bufferMin: 8,
        transport: localOnly || (!longHaul && walkMin <= 25) ? 'walk' : longHaul || walkMin > 20 ? 'transit' : 'walk',
        kind: 'stop',
        status: 'pending_change',
        planPriority: 6,
        planTaskId: wish.id ?? wish.title,
        notes: normalizePlanBullets([
          ratingLabel(p.rating),
          `~${dwell} Min`,
          distBullet,
        ]).join('\n'),
        mapsUrl: p.mapsUrl,
        emoji: '✨',
        userFixedTime: false,
      });
      names.push(p.name);
      inserted += 1;
      prev = { lat: p.lat, lng: p.lng, title: p.name };
      cursor = end;
    }
  }

  if (wish.id) {
    try {
      useFuturePlanStore.getState().removeStop(wish.id);
    } catch {
      /* soft */
    }
  }

  try {
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }

  const spokenText = sanitizePlanSpeech(
    inserted > 0
      ? [
          cityHint
            ? `Hab eine ${walk ? 'Spazier' : 'Highlight'}-Route mit ${inserted} Stopps in ${cityHint} gelegt:`
            : `Hab eine ${walk ? 'Spazier' : 'Highlight'}-Route mit ${inserted} Stopps in Laufreihenfolge gelegt:`,
          names.slice(0, 6).join(', '),
          names.length > 6 ? `und ${names.length - 6} mehr.` : null,
          freeHours <= 3
            ? `Passt in etwa ${Math.round(freeHours * 60)} Minuten.`
            : null,
          'Timeline ist gefüllt — Tour starten, oder soll ich neu suchen?',
        ]
          .filter(Boolean)
          .join(' ')
      : 'Keine sinnvolle lokale Route gefunden — sag mir ein Zeitfenster oder andere Orte.',
  ).slice(0, 420);

  try {
    usePlanCalendarUiStore.getState().setHeadlessPlanning(false);
    usePlanCalendarUiStore.getState().requestDayKey(dayKey);
    requestOpenPlanCalendar();
  } catch {
    /* soft */
  }

  const exploreStops = useFuturePlanStore
    .getState()
    .getPlanForDay(dayKey)
    .stops.filter(
      (s) =>
        s.id.startsWith('explore_') &&
        typeof s.lat === 'number' &&
        typeof s.lng === 'number',
    )
    .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0));

  const mirrored: QuickAction[] = [];
  if (exploreStops.length >= 2) {
    mirrored.push({
      type: 'START_NAVIGATION',
      label: 'Tour starten',
      payload: {
        destName: exploreStops[0]!.title,
        destLat: exploreStops[0]!.lat!,
        destLng: exploreStops[0]!.lng!,
        multiStop: exploreStops.map((s) => ({
          name: s.title,
          lat: s.lat!,
          lng: s.lng!,
        })),
      },
    });
  } else if (exploreStops[0]) {
    mirrored.push({
      type: 'START_NAVIGATION',
      label: `Zu ${exploreStops[0].title}`.slice(0, 20),
      payload: {
        destName: exploreStops[0].title,
        destLat: exploreStops[0].lat!,
        destLng: exploreStops[0].lng!,
      },
    });
  }
  usePlanCalendarUiStore.getState().clearPendingChoice();
  usePlanCalendarUiStore.getState().setMirroredActions(mirrored.slice(0, 4));

  return { spokenText, inserted };
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
