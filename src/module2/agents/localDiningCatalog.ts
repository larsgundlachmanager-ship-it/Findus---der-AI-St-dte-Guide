/**
 * Gastro-Suche — tageszeitbewusst, GPS-nah, nur offen (oder bald offen).
 * Drafts = Fakten/FLOW-Hints für Synthese (keine Vorlese-Skripte).
 */

import {
  searchOpenPlacesAhead,
  searchPlacesByText,
  geocodePlaceName,
} from '../../services/navigation/googleMapsNav';
import { closingTimeAllowsStay } from '../../services/concierge/closingHours';
import { haversineMeters } from '../../db/database';
import type { GpsPoint } from '../types';
import { placeFitsPlanVisit } from './placeHoursFit';
import { searchPackDining } from './packDiningSearch';
import {
  isGroceryOrMarketCounterVenue,
  isParkingOrForestLotVenue,
} from '../pitch/nonFoodVenueGate';

export type MealSlot =
  | 'breakfast'
  | 'lunch'
  | 'coffee'
  | 'dinner'
  | 'generic';

/** Sitzdauer nach Mahlzeit (Minuten). */
export function stayMinForMeal(slot: MealSlot): number {
  switch (slot) {
    case 'breakfast':
      return 45;
    case 'coffee':
      return 35;
    case 'lunch':
      return 60;
    case 'dinner':
      return 75;
    default:
      return 60;
  }
}

export const DINING_STAY_MIN = 75;

/** Expanding rings from live GPS (km → m). */
const DISTANCE_RINGS_M = [1_500, 3_500, 8_000, 15_000, 30_000, 50_000];

export type DiningPick = {
  name: string;
  city: string;
  rating: number | null;
  /** Nur bei ≥ MIN_RATING_COUNT in Speech erwähnen */
  ratingCount: number | null;
  priceEurMain: number | null;
      /** z. B. Haus-Burger — Heuristik für Preisbeispiel, keine Live-Karte */
      priceExampleDish: string;
  vibe: string;
  topDishes: [string, string];
  specialty: string;
  mapsUrl: string;
  websiteUrl: string | null;
  menuUrl: string | null;
  phoneNumber: string | null;
  lat: number;
  lng: number;
  distanceHint: string;
  walkMin: number;
  openNow: boolean;
  closesAtMin: number | null;
  hoursFitHint: string | null;
  reviewTip?: string | null;
  mealFit: MealSlot;
  venueKind: 'bakery' | 'cafe' | 'restaurant' | 'other';
};

/** Sterne nur ab so vielen Google-Bewertungen erwähnen. */
export const MIN_RATING_COUNT_FOR_SPEECH = 20;

import { mapsGpsUrl } from '../timeline/planTravelHelpers';

const MEDALS = ['🥇', '🥈', '🥉'] as const;

function mapsPlaceUrl(_name: string, _city: string): string {
  return '';
}

const CITY_CENTER: Record<string, GpsPoint> = {
  Wedel: { lat: 53.5836, lng: 9.698, atMs: 0 },
  Pinneberg: { lat: 53.661, lng: 9.796, atMs: 0 },
  Prisdorf: { lat: 53.68, lng: 9.7607, atMs: 0 },
  Hamburg: { lat: 53.5511, lng: 9.9937, atMs: 0 },
};

export function citySearchAnchor(
  city: string | null | undefined,
  userAnchor: GpsPoint,
  preferCityCenter = false,
): GpsPoint {
  if (!preferCityCenter || !city?.trim()) return userAnchor;
  const key = Object.keys(CITY_CENTER).find(
    (k) => k.toLowerCase() === city.trim().toLowerCase(),
  );
  const hit = key ? CITY_CENTER[key] : undefined;
  if (hit) return { ...hit, atMs: Date.now() };
  return userAnchor;
}

/**
 * Named-City: immer Stadtzentrum (bekannt oder geocodiert) — nie User-GPS,
 * wenn der User eine andere Stadt meint (Prisdorf → Hamburg).
 */
export async function resolveDiningSearchAnchor(opts: {
  city: string | null | undefined;
  userAnchor: GpsPoint;
  preferCityCenter: boolean;
}): Promise<{ anchor: GpsPoint; geocoded: boolean; distanceFromUserKm: number }> {
  const sync = citySearchAnchor(
    opts.city,
    opts.userAnchor,
    opts.preferCityCenter,
  );
  const movedFromGps =
    Math.abs(sync.lat - opts.userAnchor.lat) > 1e-4 ||
    Math.abs(sync.lng - opts.userAnchor.lng) > 1e-4;

  if (!opts.preferCityCenter || !opts.city?.trim()) {
    return {
      anchor: opts.userAnchor,
      geocoded: false,
      distanceFromUserKm: 0,
    };
  }

  let anchor = sync;
  let geocoded = movedFromGps;
  if (!movedFromGps) {
    try {
      const geo = await geocodePlaceName(opts.city.trim(), {
        biasLat: opts.userAnchor.lat,
        biasLng: opts.userAnchor.lng,
      });
      if (geo) {
        anchor = { lat: geo.lat, lng: geo.lng, atMs: Date.now() };
        geocoded = true;
      }
    } catch {
      /* soft — GPS nur als Notfall */
    }
  }

  const distanceFromUserKm =
    haversineMeters(
      opts.userAnchor.lat,
      opts.userAnchor.lng,
      anchor.lat,
      anchor.lng,
    ) / 1000;

  return { anchor, geocoded, distanceFromUserKm };
}

/**
 * Explizite Mahlzeit aus Text, sonst Tageszeit aus Uhr —
 * universell, keine Orts-Hardcodes.
 */
export function detectMealSlot(query: string, now = new Date()): MealSlot {
  const q = query.toLowerCase();
  if (/frühstück|fruehstueck|breakfast|brunch|powernap.*früh|aufsteh/.test(q)) {
    return 'breakfast';
  }
  if (/mittag(?:essen)?|lunch/.test(q)) return 'lunch';
  if (
    /kaffee|café|cafe|cappuccino|kaffeetrinken/.test(q) &&
    !/restaurant|abendessen|mittag/.test(q)
  ) {
    return 'coffee';
  }
  if (/abendessen|dinner|abend\s*essen|heute\s*abend.*essen/.test(q)) {
    return 'dinner';
  }
  if (/pizza|burger|nudeln|pasta|döner|doener|sushi|steak|vegan|vegetar|asia|asiatisch/.test(q)) {
    const h = now.getHours();
    if (h < 11) return 'breakfast';
    if (h < 15) return 'lunch';
    return 'dinner';
  }
  // Generisches „essen“ → Tageszeit
  if (/\bessen\b|hunger|restaurant|gasthof|wo\s+kann\s+ich/.test(q)) {
    const h = now.getHours();
    if (h < 11) return 'breakfast';
    if (h < 15) return 'lunch';
    if (h < 17) return 'coffee';
    return 'dinner';
  }
  const h = now.getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 17) return 'coffee';
  return 'dinner';
}

function minutesNow(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function clockFromMin(min: number): string {
  const m = ((min % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function hoursFitHint(
  closesAtMin: number | null,
  walkMin: number,
  openNow: boolean,
  stayMin: number,
  arriveAtMs?: number | null,
): string | null {
  if (closesAtMin == null) return null;
  const now = Date.now();
  const planned = arriveAtMs ?? now;
  // Zukunftsplan (≥3 h): kein „jetzt schließt / zu knapp“-Pitch
  if (planned - now >= 3 * 60 * 60_000) {
    const until = clockFromMin(closesAtMin);
    const arrivalMin =
      new Date(planned).getHours() * 60 + new Date(planned).getMinutes();
    const ok = closingTimeAllowsStay(arrivalMin, closesAtMin, stayMin);
    return ok ? `offen bis ca. ${until}` : null;
  }
  if (!openNow) return null;
  const arrival = minutesNow() + Math.max(0, walkMin);
  const ok = closingTimeAllowsStay(arrival, closesAtMin, stayMin);
  const until = clockFromMin(closesAtMin);
  if (ok) return `offen bis ca. ${until} — ${stayMin} Min passen`;
  // Zu knapp für JETZT → nicht als Positiv-Pitch; Caller filtert
  return null;
}

function venueKindFrom(
  name: string,
  types?: string[],
): DiningPick['venueKind'] {
  if (!isFoodDiningPlace(name, types)) return 'other';
  const blob = `${name} ${(types ?? []).join(' ')}`.toLowerCase();
  if (/bakery|bäckerei|baeckerei|bäcker|baecker/.test(blob)) return 'bakery';
  if (/cafe|café|coffee|kaffee|coffee_shop/.test(blob)) return 'cafe';
  if (/restaurant|gasthof|bistro|trattoria|meal_takeaway/.test(blob)) {
    return 'restaurant';
  }
  return 'other';
}

/** Echte Gastro — kein Freizeitpark mit Eltern-Café als Frühstücks-Tipp. */
const FOOD_PLACE_TYPES_RE =
  /\b(bakery|cafe|café|coffee_shop|restaurant|meal_takeaway|meal_delivery|food|bar|pub|biergarten|ice_cream)\b/i;

const NON_FOOD_PLACE_TYPES_RE =
  /\b(amusement_center|amusement_park|aquarium|bowling_alley|casino|movie_theater|museum|parking|parking_space|park_and_ride|park|zoo|tourist_attraction|gym|spa|school|church|lodging|stadium|night_club|supermarket|grocery_store|convenience_store|hypermarket|discount_store|shopping_mall)\b/i;

const NON_FOOD_NAME_RE =
  /\b(spielstadt|spielplatz|indoorspiel|indoor\s*play|freizeitpark|trampolin|bowling|kino|museum|galerie|kirche|zoo|schwimmbad|fitnessstudio|kletterhalle|laser\s*tag|kartbahn|escape\s*room|waldparkplatz|wanderparkplatz|parkplatz|parkhaus)\b/i;

/** Produktion/Verwaltung ohne Theke — kein Brötchen-Kauf. */
export function isProductionOnlyBakery(
  name: string,
  tags?: string | null,
): boolean {
  const blob = `${name} ${tags ?? ''}`.toLowerCase();
  if (!/bäck|baeck|bakery|backstube|backhaus|konditor/.test(blob)) return false;
  return /\b(zentralwerkstatt|zentralbackstube|produktion|verwaltung|grossbaeckerei|großbäckerei|backstube\s+gmbh)\b/.test(
    blob,
  );
}

export function isFoodDiningPlace(
  name: string,
  types?: string[] | null,
): boolean {
  const nameBlob = (name ?? '').toLowerCase();
  const typeBlob = (types ?? []).join(' ').toLowerCase();
  if (isParkingOrForestLotVenue(name, types)) return false;
  if (
    isGroceryOrMarketCounterVenue(name, types ?? [])
  ) {
    return false;
  }
  if (NON_FOOD_NAME_RE.test(nameBlob)) return false;
  if (isProductionOnlyBakery(nameBlob, typeBlob)) return false;
  // Café/Kaffee im Namen einer Spielstadt reicht nicht
  if (NON_FOOD_PLACE_TYPES_RE.test(typeBlob)) return false;
  if (typeBlob.trim()) {
    return FOOD_PLACE_TYPES_RE.test(typeBlob);
  }
  // Ohne Types: nur wenn der Name klar nach Gastro klingt
  return /bäck|baeck|bakery|café|cafe|restaurant|bistro|imbiss|gasthof|pizzeria|frühstück|fruehstueck/.test(
    nameBlob,
  );
}

/** Meal-fit: breakfast ≠ dinner-only names; pizza-query ≠ bakery-only. */
function mealFitsVenue(
  slot: MealSlot,
  kind: DiningPick['venueKind'],
  name: string,
  query: string,
  types?: string[] | null,
): boolean {
  if (!isFoodDiningPlace(name, types) || kind === 'other') return false;
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (/pizza/.test(q) && /bäck|baeck|bakery/.test(n)) return false;
  if (/burger/.test(q) && /bäck|baeck|bakery|frühstück|fruehstueck/.test(n)) {
    return false;
  }
  if (slot === 'breakfast') {
    if (/steakhouse|nachtclub|disco|\bbar\b(?!ista)/.test(n)) return false;
    if (
      /\b(hotel|lodging|pension)\b/.test(
        `${n} ${(types ?? []).join(' ').toLowerCase()}`,
      ) &&
      kind !== 'restaurant' &&
      kind !== 'cafe' &&
      !/frühstück|fruehstueck|restaurant|bistro/.test(n)
    ) {
      return false;
    }
    return kind === 'bakery' || kind === 'cafe' || kind === 'restaurant';
  }
  if (slot === 'coffee') {
    return kind === 'cafe' || kind === 'bakery' || /café|cafe|kaffee/.test(n);
  }
  if (slot === 'dinner' || slot === 'lunch') {
    if (kind === 'bakery' && !/imbiss|bistro/.test(n)) return false;
  }
  return true;
}

type RawHit = {
  name: string;
  lat: number;
  lng: number;
  distanceM: number;
  rating: number | null;
  ratingCount?: number | null;
  websiteUri?: string | null;
  phoneNumber?: string | null;
  placeId?: string;
  openNow?: boolean;
  opensAtMin?: number | null;
  closesAtMin?: number | null;
  types?: string[];
};

async function collectHits(opts: {
  slot: MealSlot;
  query: string;
  city: string | null;
  searchAt: GpsPoint;
  radiusM: number;
  harborBias?: boolean;
}): Promise<RawHit[]> {
  const city = opts.city;
  const hits: RawHit[] = [];
  const push = (list: RawHit[]) => {
    for (const h of list) {
      if (!isFoodDiningPlace(h.name, h.types)) continue;
      hits.push(h);
    }
  };

  const dedupe = (): RawHit[] => {
    const seen = new Set<string>();
    const out: RawHit[] = [];
    for (const h of hits) {
      const key = `${h.name.toLowerCase()}|${h.lat.toFixed(4)}|${h.lng.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(h);
    }
    return out;
  };

  // 1) Pack-first (€0) — Stadt-Datensatz / Directory
  try {
    const packHits = await searchPackDining({
      lat: opts.searchAt.lat,
      lng: opts.searchAt.lng,
      radiusM: opts.radiusM,
      query: [
        opts.query,
        opts.slot === 'breakfast' ? 'Frühstück Bäckerei Café' : '',
        opts.slot === 'coffee' ? 'Café Kaffee' : '',
        opts.harborBias ? 'Hafen Aussicht' : '',
      ]
        .filter(Boolean)
        .join(' '),
      minResults: 2,
    });
    push(
      packHits.map((p) => ({
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        distanceM: p.distanceM,
        rating: p.rating,
        ratingCount: p.ratingCount,
        websiteUri: p.websiteUri,
        phoneNumber: p.phoneNumber,
        placeId: p.placeId,
        openNow: p.openNow,
        opensAtMin: p.opensAtMin,
        closesAtMin: p.closesAtMin,
        types: p.types,
      })),
    );
  } catch {
    /* soft */
  }

  const packEnough =
    dedupe().length >= 2 &&
    !wantsLiveDiningResearch(opts.query) &&
    !/\bhamburg\b/i.test(opts.query ?? '');
  if (packEnough) {
    // Nur Allerwelts-Essen: Pack reicht. Spezialwunsch → immer Live nachziehen.
    return dedupe();
  }

  // 2) OSM / Cache (€0) via searchOpenPlacesAhead — Google nur als Fallback dort
  if (opts.slot === 'breakfast' || opts.slot === 'coffee') {
    const types =
      opts.slot === 'coffee'
        ? (['cafe', 'bakery'] as const)
        : (['bakery', 'cafe', 'restaurant'] as const);
    for (const t of types) {
      try {
        const found = await searchOpenPlacesAhead({
          lat: opts.searchAt.lat,
          lng: opts.searchAt.lng,
          placeType: t,
          radiusM: Math.min(opts.radiusM, 5_000),
          openNow: true,
          keyword:
            opts.slot === 'breakfast'
              ? 'Frühstück bakery cafe'
              : 'Kaffee cafe',
        });
        push(
          found.map((p) => ({
            name: p.name,
            lat: p.lat,
            lng: p.lng,
            distanceM: p.distanceM,
            rating: p.rating,
            ratingCount: p.ratingCount ?? null,
            websiteUri: p.websiteUri ?? null,
            phoneNumber: p.phoneNumber ?? null,
            placeId: p.placeId,
            openNow: p.openNow,
            opensAtMin: p.opensAtMin ?? null,
            closesAtMin: p.closesAtMin ?? null,
            types: p.types,
          })),
        );
      } catch {
        /* soft */
      }
    }
  } else {
    const cuisine =
      /pizza|burger|sushi|pasta|nudeln|döner|doener|fisch|steak|vegan|vegetarisch|asiatisch|asian/.exec(
        opts.query.toLowerCase(),
      )?.[0] ?? null;
    try {
      const nearby = await searchOpenPlacesAhead({
        lat: opts.searchAt.lat,
        lng: opts.searchAt.lng,
        placeType: 'restaurant',
        radiusM: Math.min(opts.radiusM, 5_000),
        openNow: true,
        keyword: cuisine,
      });
      push(
        nearby.map((p) => ({
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          distanceM: p.distanceM,
          rating: p.rating,
          ratingCount: p.ratingCount ?? null,
          websiteUri: p.websiteUri ?? null,
          phoneNumber: p.phoneNumber ?? null,
          placeId: p.placeId,
          openNow: p.openNow,
          opensAtMin: p.opensAtMin ?? null,
          closesAtMin: p.closesAtMin ?? null,
          types: p.types,
        })),
      );
    } catch {
      /* soft */
    }
  }

  if (dedupe().length >= 2 && !wantsLiveDiningResearch(opts.query)) {
    return dedupe();
  }

  // 3) Places Text nur bei echter Lücke (teuer)
  const cuisine =
    /pizza|burger|sushi|pasta|nudeln|döner|doener|fisch|steak|vegan|vegetarisch|asiatisch|asian/.exec(
      opts.query.toLowerCase(),
    )?.[0] ?? null;
  const textQ =
    opts.slot === 'breakfast' || opts.slot === 'coffee'
      ? city
        ? `Frühstück ${city} Bäckerei Café`
        : 'Frühstück Bäckerei Café Restaurant offen'
      : opts.harborBias
        ? city
          ? `Restaurant Hafen ${city}`
          : 'Restaurant Hafen'
        : cuisine
          ? city
            ? `${cuisine} Restaurant ${city}`
            : `${cuisine} Restaurant`
          : city
            ? `Restaurant ${city}`
            : 'Restaurant offen';
  try {
    const text = await searchPlacesByText({
      query: textQ,
      lat: opts.searchAt.lat,
      lng: opts.searchAt.lng,
      radiusM: opts.radiusM,
    });
    push(
      text.map((p) => ({
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        distanceM: p.distanceM,
        rating: p.rating,
        ratingCount: p.ratingCount ?? null,
        websiteUri: p.websiteUri ?? null,
        phoneNumber: p.phoneNumber ?? null,
        placeId: p.placeId,
        openNow: p.openNow,
        opensAtMin: p.opensAtMin ?? null,
        closesAtMin: p.closesAtMin ?? null,
        types: p.types,
      })),
    );
  } catch {
    /* soft */
  }

  return dedupe();
}

function diningFitsArrival(h: RawHit, walkMin: number, stayMin: number): boolean {
  return placeFitsPlanVisit(
    {
      openNow: h.openNow !== false,
      opensAtMin: h.opensAtMin ?? null,
      closesAtMin: h.closesAtMin ?? null,
    },
    {
      arriveAtMs: Date.now() + Math.max(0, walkMin) * 60_000,
      stayMin,
    },
  );
}

export async function findDiningPicks(opts: {
  anchor: GpsPoint;
  city: string | null;
  query: string;
  harborBias?: boolean;
  preferCityCenter?: boolean;
}): Promise<{
  primary: DiningPick;
  alts: DiningPick[];
  mealSlot: MealSlot;
  searchMeta: {
    distanceFromUserKm: number;
    suggestOvernight: boolean;
    searchCity: string | null;
  };
}> {
  const slot = detectMealSlot(opts.query);
  const stayMin = stayMinForMeal(slot);
  const localTypical = wantsLocalTypicalFood(opts.query);
  const profileDiet = (() => {
    try {
      const { getCachedUserProfile } = require('../../services/userProfileService') as {
        getCachedUserProfile: () => Record<string, unknown> | null;
      };
      const { dietLabelsFromProfile } = require('../pitch/parentBrief') as {
        dietLabelsFromProfile: (p: Record<string, unknown> | null) => string[];
      };
      return dietLabelsFromProfile(getCachedUserProfile());
    } catch {
      return [] as string[];
    }
  })();
  const hardNeeds = parseDiningHardNeeds(opts.query, profileDiet);
  const namedCity = (() => {
    try {
      const { extractCityFromText } = require('../context/shortTermContext') as {
        extractCityFromText: (s: string) => string | null;
      };
      return extractCityFromText(opts.query);
    } catch {
      return null;
    }
  })();
  const metroCity = (() => {
    if (namedCity) return null;
    if (!hardNeeds.length && !localTypical) return null;
    if (!hardNeeds.length && slot === 'breakfast') return null;
    try {
      const { nearestCommercialAirport } = require('../../services/flights/airportIata') as {
        nearestCommercialAirport: (
          lat: number,
          lng: number,
        ) => { city: string } | null;
      };
      return nearestCommercialAirport(opts.anchor.lat, opts.anchor.lng)?.city ?? null;
    } catch {
      return null;
    }
  })();
  const city = namedCity?.trim() || metroCity || opts.city?.trim() || null;
  const placeLabel = city || 'hier';
  const hardBoost = hardNeeds.map((n) => n.searchBoost).join(' ');
  const searchQuery = [
    opts.query,
    hardBoost,
    localTypical
      ? /hamburg/i.test(city ?? '') || /hamburg/i.test(opts.query)
        ? 'Fischrestaurant Pannfisch Fischbrötchen lokal Hamburg'
        : 'Fisch regional lokal Hausmannskost'
      : '',
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const resolved = await resolveDiningSearchAnchor({
    city,
    userAnchor: opts.anchor,
    preferCityCenter:
      opts.preferCityCenter === true ||
      hardNeeds.length > 0 ||
      Boolean(namedCity),
  });
  const searchAt = resolved.anchor;
  const suggestOvernight = resolved.distanceFromUserKm >= 100;

  for (const radiusM of DISTANCE_RINGS_M) {
    const raw = await collectHits({
      slot,
      query: searchQuery,
      city,
      searchAt,
      radiusM,
      harborBias: opts.harborBias || hardNeeds.some((n) => n.id === 'view'),
    });

    let ranked = raw
      .filter((p) => p.distanceM <= radiusM + 80)
      .filter((p) => p.rating == null || p.rating >= 3.5)
      .filter((p) => isFoodDiningPlace(p.name, p.types))
      .filter((p) => !NON_FOOD_NAME_RE.test(p.name))
      .filter((p) => !(localTypical && isDiningChainName(p.name)))
      .map((p) => {
        const walkMin = Math.max(1, Math.ceil(p.distanceM / 80));
        const kind = venueKindFrom(p.name, p.types);
        return { p, walkMin, kind };
      })
      .filter(({ p, kind }) =>
        mealFitsVenue(slot, kind, p.name, opts.query, p.types),
      )
      .filter(({ p, walkMin }) => diningFitsArrival(p, walkMin, stayMin));

    // Hard-Match: Pack-Tags/Name sind Vorfilter; Live-Reviews zusätzlich (Maps-Stil).
    if (hardNeeds.length && ranked.length) {
      const nameHits = ranked.filter(({ p }) =>
        hitMatchesDiningNeeds(p, hardNeeds),
      );
      try {
        const { fetchPlacePitchDetails } = await import(
          '../../services/navigation/placePitchDetails'
        );
        const sample = ranked.slice(0, 6);
        const verified: typeof ranked = [];
        const seen = new Set<string>();
        const push = (row: (typeof ranked)[number]) => {
          const key = `${row.p.name}|${row.p.lat.toFixed(4)}|${row.p.lng.toFixed(4)}`;
          if (seen.has(key)) return;
          seen.add(key);
          verified.push(row);
        };
        for (const row of nameHits) push(row);
        await Promise.all(
          sample.map(async (row) => {
            try {
              const details = await fetchPlacePitchDetails({
                placeId: String(row.p.placeId || '').startsWith('pack:')
                  ? undefined
                  : row.p.placeId,
                query: `${row.p.name} ${city ?? ''}`.trim(),
                lat: row.p.lat,
                lng: row.p.lng,
                includeAtmosphere: true,
              });
              const evidence = [
                details?.editorialSummary,
                details?.generativeSummary,
                ...(details?.reviews ?? []).map((r) => r.text),
                details?.name,
                (row.p.types ?? []).join(' '),
              ]
                .filter(Boolean)
                .join('\n');
              if (hitMatchesDiningNeeds(row.p, hardNeeds, evidence)) push(row);
            } catch {
              /* soft */
            }
          }),
        );
        ranked = verified.length ? verified : [];
      } catch {
        ranked = nameHits;
      }
    }

    ranked = ranked.sort((a, b) => {
      const da = a.p.distanceM;
      const db = b.p.distanceM;
      if (Math.abs(da - db) > 400) return da - db;
      return (b.p.rating ?? 0) - (a.p.rating ?? 0);
    });

    if (ranked.length >= 1) {
      // Diversität: wenn möglich Bäckerei + Restaurant für Frühstück
      const picked: typeof ranked = [];
      if (slot === 'breakfast' && !hardNeeds.length) {
        const bakery = ranked.find((r) => r.kind === 'bakery' || r.kind === 'cafe');
        const sitDown = ranked.find(
          (r) => r.kind === 'restaurant' && r !== bakery,
        );
        if (bakery) picked.push(bakery);
        if (sitDown) picked.push(sitDown);
      }
      for (const r of ranked) {
        if (picked.length >= 3) break;
        if (!picked.includes(r)) picked.push(r);
      }

      const mapped = picked.slice(0, 3).map(({ p, walkMin, kind }, i) => {
        const pick = toPick(p, placeLabel, i === 0, walkMin, stayMin, slot, kind);
        if (hardNeeds.length) {
          const labels = hardNeeds.map((n) => n.label).join(', ');
          pick.specialty = pick.specialty
            ? `${pick.specialty} · belegt: ${labels}`
            : `belegt: ${labels}`;
          pick.vibe = `${pick.vibe} — passt zu ${labels}`;
          if (hardNeeds.some((n) => n.id === 'pannfisch')) {
            pick.topDishes = [
              'Pannfisch',
              pick.topDishes[1] ?? 'Fisch',
            ];
            pick.priceExampleDish = 'Pannfisch';
          } else if (hardNeeds.some((n) => n.id === 'outdoor')) {
            pick.specialty = pick.specialty.includes('Terrasse')
              ? pick.specialty
              : `${pick.specialty} · Terrasse`;
          }
        }
        return pick;
      });
      return {
        primary: mapped[0]!,
        alts: mapped.slice(1),
        mealSlot: slot,
        searchMeta: {
          distanceFromUserKm: resolved.distanceFromUserKm,
          suggestOvernight,
          searchCity: city,
        },
      };
    }
  }

  // Hard-Needs ohne Beleg: ehrlich + beste allgemeine Alternativen (ohne Fake-Match)
  if (hardNeeds.length) {
    const softQuery = opts.query;
    for (const radiusM of DISTANCE_RINGS_M) {
      const raw = await collectHits({
        slot,
        query: softQuery,
        city,
        searchAt,
        radiusM,
        harborBias: opts.harborBias,
      });
      const ranked = raw
        .filter((p) => p.distanceM <= radiusM + 80)
        .filter((p) => p.rating == null || p.rating >= 3.5)
        .filter((p) => isFoodDiningPlace(p.name, p.types))
        .filter((p) => !NON_FOOD_NAME_RE.test(p.name))
        .map((p) => {
          const walkMin = Math.max(1, Math.ceil(p.distanceM / 80));
          const kind = venueKindFrom(p.name, p.types);
          return { p, walkMin, kind };
        })
        .filter(({ p, kind }) =>
          mealFitsVenue(slot, kind, p.name, opts.query, p.types),
        )
        .filter(({ p, walkMin }) => diningFitsArrival(p, walkMin, stayMin))
        .sort((a, b) => a.p.distanceM - b.p.distanceM)
        .slice(0, 3);
      if (ranked.length) {
        const needLabels = hardNeeds.map((n) => n.label).join(', ');
        const mapped = ranked.map(({ p, walkMin, kind }, i) => {
          const pick = toPick(
            p,
            placeLabel,
            i === 0,
            walkMin,
            stayMin,
            slot,
            kind,
          );
          pick.vibe = `Kein belegter Match für ${needLabels} — Alternative ohne diesen Nachweis`;
          pick.specialty = `fehlt Beleg: ${needLabels}`;
          return pick;
        });
        return {
          primary: mapped[0]!,
          alts: mapped.slice(1),
          mealSlot: slot,
          searchMeta: {
            distanceFromUserKm: resolved.distanceFromUserKm,
            suggestOvernight,
            searchCity: city,
          },
        };
      }
    }
  }

  // Kein Offline-Ortsscript — ehrlicher leerer Fakt-Pack für Synthese
  const missLabels = hardNeeds.map((n) => n.label).join(', ');
  return {
    primary: {
      name: placeLabel,
      city: placeLabel,
      rating: null,
      ratingCount: null,
      priceEurMain: null,
      priceExampleDish: 'Hauptgericht',
      vibe: missLabels
        ? `Kein belegter Treffer für ${missLabels} — Suche weiter`
        : 'Live-Suche dünn — weiter passende Optionen prüfen',
      topDishes: ['—', '—'],
      specialty: missLabels ? `fehlt: ${missLabels}` : 'nachladen',
      mapsUrl: mapsPlaceUrl(
        slot === 'breakfast' ? 'Frühstück' : 'Restaurant',
        placeLabel,
      ),
      websiteUrl: null,
      menuUrl: null,
      phoneNumber: null,
      lat: searchAt.lat,
      lng: searchAt.lng,
      distanceHint: 'Suche läuft weiter',
      walkMin: 0,
      openNow: false,
      closesAtMin: null,
      hoursFitHint: null,
      mealFit: slot,
      venueKind: 'other',
    },
    alts: [],
    mealSlot: slot,
    searchMeta: {
      distanceFromUserKm: resolved.distanceFromUserKm,
      suggestOvernight,
      searchCity: city,
    },
  };
}

function toPick(
  p: RawHit,
  city: string,
  primary: boolean,
  walkMin: number,
  stayMin: number,
  slot: MealSlot,
  kind: DiningPick['venueKind'],
): DiningPick {
  const mapsUrl =
    Number.isFinite(p.lat) && Number.isFinite(p.lng)
      ? mapsGpsUrl(p.name, p.lat, p.lng, p.placeId)
      : p.placeId
        ? mapsGpsUrl(p.name, NaN, NaN, p.placeId)
        : mapsPlaceUrl(p.name, city);
  const openNow = p.openNow !== false;
  const closesAtMin = p.closesAtMin ?? null;
  const dishes = dishesFromName(p.name, slot, kind);
  const websiteUrl = p.websiteUri?.trim() || null;
  const menuUrl =
    websiteUrl &&
    /speisekarte|speisen|menue?|menu|karte|\.pdf|\/ugd\/|_files\/ugd/i.test(
      websiteUrl,
    )
      ? websiteUrl
      : null;

  return {
    name: p.name,
    city,
    rating: p.rating,
    ratingCount: p.ratingCount ?? null,
    priceEurMain: null, // Nie erfinden — nur Deep-Research / echte Speisekarte
    priceExampleDish: dishes.topDishes[0],
    vibe: vibeFromName(p.name, slot, kind),
    topDishes: dishes.topDishes,
    specialty: dishes.specialty,
    mapsUrl,
    websiteUrl,
    menuUrl,
    phoneNumber: p.phoneNumber?.trim() || null,
    lat: p.lat,
    lng: p.lng,
    distanceHint:
      p.distanceM < 800
        ? `~${Math.round(p.distanceM)} m · ~${walkMin} Min zu Fuß`
        : `${(p.distanceM / 1000).toFixed(1).replace('.', ',')} km · ~${walkMin} Min`,
    walkMin,
    openNow,
    closesAtMin,
    hoursFitHint: hoursFitHint(closesAtMin, walkMin, openNow, stayMin, null),
    reviewTip: null,
    mealFit: slot,
    venueKind: kind,
  };
}

function estimatePrice(
  _rating: number | null,
  _slot: MealSlot,
  _name?: string,
  _exampleDish?: string,
): number | null {
  // Bewusst deaktiviert: keine Fantasie-Euro. Preise nur aus Speisekarte/Deep-Research.
  return null;
}
void estimatePrice;

function vibeFromName(
  name: string,
  slot: MealSlot,
  kind: DiningPick['venueKind'],
): string {
  if (kind === 'bakery') return 'Bäckerei — schnell Brötchen / Franzbrötchen';
  if (kind === 'cafe') return 'Café — Kaffee und leichter Happen';
  if (slot === 'breakfast') return 'Sit-down mit Frühstücksangebot';
  const n = name.toLowerCase();
  if (/pizza|italia|trattoria/.test(n)) return 'italienisch';
  if (/burger/.test(n)) return 'Burger-Spot';
  if (/sushi|asia/.test(n)) return 'asiatisch';
  return 'Gastro in der Nähe';
}

function dishesFromName(
  name: string,
  slot: MealSlot,
  kind: DiningPick['venueKind'],
): { topDishes: [string, string]; specialty: string } {
  if (kind === 'bakery' || (slot === 'breakfast' && kind === 'cafe')) {
    return {
      topDishes: ['belegte Brötchen / Franzbrötchen', 'Kaffee zum Mitnehmen'],
      specialty: 'schnelles Frühstück to-go',
    };
  }
  if (slot === 'breakfast') {
    return {
      topDishes: ['Frühstücksteller / Buffet', 'Eier- oder Brunch-Klassiker'],
      specialty: 'Frühstück zum Reinhauen',
    };
  }
  const n = name.toLowerCase();
  if (/pizza|italia|trattoria|pasta|ristorante/.test(n)) {
    return {
      topDishes: ['Pizza vom Steinofen', 'Pasta der Saison'],
      specialty: 'italienische Hausgemachte',
    };
  }
  if (/burger/.test(n)) {
    return {
      topDishes: ['Burger-Küche', 'Beilagen je nach Karte'],
      specialty: 'Burger',
    };
  }
  if (/sushi|asia|thai|vietnam|pho|ramen/.test(n)) {
    return {
      topDishes: ['asiatische Küche', 'je nach Speisekarte'],
      specialty: 'asiatisch',
    };
  }
  return {
    topDishes: ['Hausküche', 'Details auf der Speisekarte'],
    specialty: 'Gastro',
  };
}

/** Ketten / Fast-Food — bei „typisch / lokal“ meiden. */
export function isDiningChainName(name: string): boolean {
  return /\b(jim\s*block|mcdonald|burger\s*king|kfc|subway|nordsee\b|vapiano|block\s*house|pizza\s*hut|dominos|five\s*guys|dean\s*&\s*david)\b/i.test(
    name,
  );
}

export function wantsLocalTypicalFood(query: string): boolean {
  return /\b(typisch|original|lokal|heimat|regional|hamburgerisch|hamburgisch|pannfisch|pannenfisch|pfannfisch|pannisch|fischbrötchen|fischbroetchen|labskaus|franzbrötchen)\b/i.test(
    query,
  );
}

/** Harte Gastro-Must-Haves aus der Frage (Gericht / Blick / draußen). */
export type DiningHardNeed = {
  id: string;
  label: string;
  searchBoost: string;
  /** Name, Typen, Editorial, Reviews */
  evidence: RegExp;
};

export function parseDiningHardNeeds(
  query: string,
  diet?: string[] | null,
): DiningHardNeed[] {
  const q = query || '';
  const out: DiningHardNeed[] = [];
  if (/\b(pannfisch|pannisch|pannenfisch|pfannfisch|pfannenfisch)\b/i.test(q)) {
    out.push({
      id: 'pannfisch',
      label: 'Pannfisch',
      searchBoost: 'Pannfisch Fischrestaurant',
      evidence: /\bp(?:f)?ann(?:en)?fisch|pannisch\b/i,
    });
  }
  if (/\b(labskaus)\b/i.test(q)) {
    out.push({
      id: 'labskaus',
      label: 'Labskaus',
      searchBoost: 'Labskaus norddeutsch',
      evidence: /\blabskaus\b/i,
    });
  }
  if (/\b(fischbrötchen|fischbroetchen)\b/i.test(q)) {
    out.push({
      id: 'fischbroetchen',
      label: 'Fischbrötchen',
      searchBoost: 'Fischbrötchen Imbiss',
      evidence: /\bfischbrötchen|fischbroetchen\b/i,
    });
  }
  if (
    /\b(elbblick|elb\s*blick|wasserblick|hafenblic?k|alsterblick|blick\s+auf\s+die\s+elb)\b/i.test(
      q,
    )
  ) {
    out.push({
      id: 'view',
      label: 'Elb-/Wasserblick',
      searchBoost: 'Restaurant Elbblick Wasserblick Terrasse Hafen',
      evidence:
        /\b(elbblick|elb\s*blick|wasserblick|hafenblic|alsterblick|view\s+of\s+the\s+(elbe|harbor|harbour)|river\s*view)\b/i,
    });
  }
  if (/\bsteak\b/i.test(q)) {
    out.push({
      id: 'steak',
      label: 'Steak',
      searchBoost: 'Steak Steakhouse Grill Restaurant',
      evidence: /\b(steak|steakhouse|ribeye|rumpsteak|hüftsteak|hueftsteak|filetsteak|entrecote|entrecôte|rinderfilet|filet.{0,16}gegrillt)\b/i,
    });
  }
  if (/\bvegan/i.test(q)) {
    out.push({
      id: 'vegan',
      label: 'vegan',
      searchBoost: 'vegan Restaurant',
      evidence: /\bvegan/i,
    });
  }
  if (/\bvegetar/i.test(q)) {
    out.push({
      id: 'vegetarian',
      label: 'vegetarisch',
      searchBoost: 'vegetarisch vegetarian Restaurant',
      evidence: /vegetar|vegetarian|\bveggie\b|\bvegan/i,
    });
  }
  if (/\b(sushi)\b/i.test(q)) {
    out.push({
      id: 'sushi',
      label: 'Sushi',
      searchBoost: 'Sushi Restaurant',
      evidence: /sushi|sashimi|maki|japan/i,
    });
  }
  if (/\b(asiatisch|asian)\b/i.test(q) && !/\bsushi\b/i.test(q)) {
    out.push({
      id: 'asian',
      label: 'asiatisch',
      searchBoost: 'asiatisch asian thai Restaurant',
      evidence: /asia|asiatisch|thai|vietnam|china|chinesisch|japan|sushi|pho|ramen|korean/i,
    });
  }
  if (
    /\b(draußen|draussen|terrasse|outdoor|außenbereich|aussenbereich|garten|biergarten)\b/i.test(
      q,
    )
  ) {
    out.push({
      id: 'outdoor',
      label: 'Terrasse/draußen',
      searchBoost: 'Restaurant Terrasse Biergarten outdoor seating',
      evidence:
        /\b(terrasse|outdoor|biergarten|außenbereich|aussenbereich|gartenwirtschaft|patio|terrace)\b/i,
    });
  }
  const dietBlob = (diet ?? []).join(' ').toLowerCase();
  const spokenMeat =
    /\b(steak|rumpsteak|ribeye|entrecôte|entrecote|schnitzel|burger|döner|doener|kebab|wurst|steakhouse|pannfisch|pannenfisch|pfannfisch|fisch)\b/i.test(
      q,
    );
  if (!spokenMeat && /vegan/.test(dietBlob) && !out.some((n) => n.id === 'vegan')) {
    out.push({
      id: 'vegan',
      label: 'vegan',
      searchBoost: 'vegan Restaurant',
      evidence: /\bvegan/i,
    });
  } else if (
    !spokenMeat &&
    /vegetar/.test(dietBlob) &&
    !out.some((n) => n.id === 'vegan' || n.id === 'vegetarian')
  ) {
    out.push({
      id: 'vegetarian',
      label: 'vegetarisch',
      searchBoost: 'vegetarisch vegetarian Restaurant',
      evidence: /vegetar|vegetarian|\bveggie\b|\bvegan/i,
    });
  }
  return out;
}

/** Spezialwunsch → Pack reicht nicht; Places + Reviews nachziehen. */
export function wantsLiveDiningResearch(
  query: string,
  diet?: string[] | null,
): boolean {
  if (parseDiningHardNeeds(query, diet).length > 0) return true;
  try {
    const { queryNeedsLiveFoodResearch } = require('../pitch/specializedFoodMatch') as {
      queryNeedsLiveFoodResearch: (q: string) => boolean;
    };
    return queryNeedsLiveFoodResearch(query);
  } catch {
    return /\b(pizza|burger|sushi|pasta|schnitzel|döner|doener|kebab|terrasse|biergarten)\b/i.test(
      query,
    );
  }
}

function hitMatchesDiningNeeds(
  hit: { name: string; types?: string[] },
  needs: DiningHardNeed[],
  evidenceExtra?: string,
): boolean {
  if (!needs.length) return true;
  const blob = `${hit.name} ${(hit.types ?? []).join(' ')} ${evidenceExtra ?? ''}`;
  return needs.every((n) => n.evidence.test(blob));
}

/**
 * User will an einem konkreten Ort frühstücken/essen?
 * Nur dann Einschätzung + Alternativen — sonst positiv 2 Optionen.
 */
export function extractNamedVenueMealIntent(
  query: string,
  lastPlaceName?: string | null,
): string | null {
  try {
    const { extractNamedRestaurantWish } = require('../pitch/namedVenueIntent') as {
      extractNamedRestaurantWish: (s: string) => string | null;
    };
    const named = extractNamedRestaurantWish(query);
    if (named) return named;
  } catch {
    /* soft */
  }
  const q = query.trim();
  const meal =
    /frühstück|fruehstueck|breakfast|brunch|essen|mittag|abendessen|hingehen|reservier|anrufen|speisekarte|menü|menu|karte\s+empfehl|was\s+nehmen|auswahl/i.test(
      q,
    );
  const timedVisit = /\b(um\s+\d{1,2}|heute\s+abend|heute\s+mittag)\b/i.test(q);
  if (!meal && !timedVisit) return null;

  const m =
    q.match(
      /(?:bei|im|in\s+der|in\s+dem|am|zum|zur|zu|ins|auf\s+dem|auf\s+der|vom|von)\s+([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+){0,5})/i,
    ) ||
    q.match(
      /([A-ZÄÖÜ][\wÄÖÜäöüß\-']+(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß\-']+){0,4})\s+(?:frühstück|fruehstueck|breakfast)/i,
    );
  if (m?.[1]) {
    const name = m[1]
      .replace(/\s+(um|heute|abend|mittag|uhr)\b.*$/i, '')
      .replace(/[.,!?].*$/, '')
      .trim();
    if (
      name.length >= 3 &&
      !/^(hier|der|die|das|dem|den|nähe|nahe|stadt|ort|karte|speisekarte)$/i.test(
        name,
      )
    ) {
      return name;
    }
  }
  if (
    lastPlaceName?.trim() &&
    /(?:dort|da|dort hin|dahin|an\s+dem\s+ort|bei\s+dem|hingehen|reservier|anrufen|um\s+\d|speisekarte|auf\s+der\s+karte|empfehl|nehmen|wählen|waehlen)/i.test(
      q,
    )
  ) {
    return lastPlaceName.trim();
  }
  return null;
}

/**
 * @deprecated Legacy Dual-Guide — offene Auswahl läuft über `src/module2/pitch`.
 * Bleibt nur als No-Op-Stub, falls alte Imports greifen.
 */
export function formatDiningGuideSpeech(
  _primary: DiningPick,
  _alts: DiningPick[],
  _city: string,
  _mealSlot?: MealSlot,
  _opts?: {
    namedVenue?: string | null;
    namedVenueFit?: 'good' | 'weak' | 'closed' | 'unknown' | null;
    companions?: string | null;
    occasion?: string | null;
    suggestOvernight?: boolean;
    distanceFromUserKm?: number;
  },
): string {
  return [
    'FAKTEN Gastro (nicht wörtlich vorlesen):',
    'Legacy Dual-Guide deaktiviert — Auswahl-Pitch-Modul nutzen.',
    'FLOW: keine Medaillen-Optionen improvisieren.',
  ].join('\n');
}

export function medalForRank(index: number): string {
  return MEDALS[index] ?? '•';
}
