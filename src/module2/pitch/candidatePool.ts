/**
 * Kandidaten-Pool: Pack first, dann Places (Ringe / Stadt).
 */

import { getAllPois, haversineMeters } from '../../db/database';
import { searchPlacesByText } from '../../services/navigation/googleMapsNav';
import {
  HERE_NOW_RINGS_M,
  hereNowPrio,
  scoreDetourLandmark,
  scoreDetourOnRoute,
} from './detourHeuristic';
import {
  isParkingOrForestLotVenue,
  isWegweiserOrApproachName,
  isSubEntranceName,
} from './nonFoodVenueGate';
import { looksLikePicnicQuery, isPicnicUnsuitableVenue } from './picnicIntent';
import { inferGastroFacetTags } from './gastroFacetTags';
import { looksLikeSpokenMeatOrFish } from './specializedFoodMatch';
import { namedVenueFromWishes, venueNameMatches } from './namedVenueIntent';
import type {
  PitchCandidate,
  PitchKind,
  PitchRequest,
  PitchSearchMode,
} from './types';

export {
  isParkingOrForestLotVenue,
  isWegweiserOrApproachName,
  isSubEntranceName,
} from './nonFoodVenueGate';

function mapsUrlFor(
  name: string,
  _lat: number,
  _lng: number,
  placeId?: string | null,
): string {
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

function wishBlob(req: PitchRequest): string {
  return `${req.title} ${req.context} ${req.wishes.map((w) => w.text).join(' ')}`.toLowerCase();
}

function queryFor(req: PitchRequest): string {
  const city = (req.cityHint || '').trim() || 'in der Nähe';
  if (req.kind === 'hotel') {
    const amen = req.wishes
      .filter((w) => w.hardness === 'must' && (w.kind === 'amenity' || w.kind === 'vibe'))
      .map((w) => w.text)
      .join(' ');
    return `Hotel ${amen} ${city}`.replace(/\s+/g, ' ').trim();
  }
  if (req.kind === 'cinema') return `Kino ${city}`.trim();
  if (req.kind === 'bar') return `Bar Biergarten ${city}`.trim();
  if (req.kind === 'sight') {
    const wish = wishBlob(req);
    const theme = req.wishes
      .filter((w) => w.hardness === 'must' && (w.kind === 'theme' || w.kind === 'amenity'))
      .map((w) => w.text)
      .join(' ');
    if (/dinosaur/i.test(wish) || /dinosaur/i.test(theme)) {
      return `Dinosaurier Museum Naturkunde ${theme || 'Dinosaurier'} ${city}`.replace(
        /\s+/g,
        ' ',
      ).trim();
    }
    if (/zoo|safari/i.test(wish) || /zoo|safari/i.test(theme)) {
      return `Zoo Tierpark ${city}`.trim();
    }
    if (/aquarium/i.test(wish) || /aquarium/i.test(theme)) {
      return `Aquarium ${city}`.trim();
    }
    if (/strand|beach|baden|badestelle|freibad|priwall/.test(wish)) {
      return `Strand Beach Badestelle Freibad ${city}`.trim();
    }
    if (looksLikePicnicQuery(wish)) {
      return `Picknick Park Wiese See Grillplatz Liegewiese ${city}`.trim();
    }
    if (theme) {
      return `${theme} Museum Ausstellung ${city}`.replace(/\s+/g, ' ').trim();
    }
    return `Sehenswürdigkeit Aussicht ${city}`.trim();
  }
  // Activity / Amenity / open find (generic)
  if (req.kind === 'generic') {
    const wish = wishBlob(req);
    if (/basketball/i.test(wish)) {
      return `Basketballplatz Basketball Court outdoor ${city}`.trim();
    }
    if (/tischtennis|table\s*tennis|ping[\s-]?pong/i.test(wish)) {
      return `Tischtennisplatte Ping Pong outdoor ${city}`.trim();
    }
    if (/trinkwasser|drinking\s*water|trinkbrunnen/i.test(wish)) {
      return `Trinkwasser Trinkbrunnen drinking water ${city}`.trim();
    }
    if (/grillplatz|grillstelle|bbq|barbecue/i.test(wish)) {
      return `Grillplatz Grillstelle BBQ ${city}`.trim();
    }
    if (/briefkasten|postkasten|mailbox/i.test(wish)) {
      return `Briefkasten Postkasten ${city}`.trim();
    }
    if (looksLikePicnicQuery(wish)) {
      return `Picknick Park Wiese Grillplatz ${city}`.trim();
    }
    // Open-Find / Must-Amenity zuerst — nie den ganzen Fragesatz als Places-Query
    const mustAmenity = req.wishes
      .filter((w) => w.hardness === 'must' && (w.kind === 'amenity' || w.kind === 'theme'))
      .map((w) => w.text)
      .join(' ');
    if (mustAmenity) {
      return `${mustAmenity} ${city}`.replace(/\s+/g, ' ').trim();
    }
    const must = req.wishes
      .filter((w) => w.hardness === 'must')
      .map((w) => w.text)
      .join(' ');
    if (must) return `${must} ${city}`.replace(/\s+/g, ' ').trim();
    return `${wish || req.title} ${city}`.replace(/\s+/g, ' ').trim();
  }
  if (req.kind === 'food') {
    const venue = namedVenueFromWishes(req.wishes);
    if (venue) {
      return `${venue} Restaurant`.trim();
    }
    const wish = wishBlob(req);
    const dish = req.wishes.find((w) => w.kind === 'dish' && w.hardness === 'must');
    const cuisine = req.wishes.find(
      (w) => w.kind === 'cuisine' && w.hardness === 'must',
    );
    if (dish) {
      const dt = dish.text.toLowerCase();
      if (/eis|gelato|ice\s*cream|spaghetti/.test(dt)) {
        return `Eisdiele Gelateria ${dish.text} ${city}`.trim();
      }
      if (/steak/.test(dt)) {
        return `Steak Steakhouse Grill Restaurant ${city}`.trim();
      }
      if (/\bd[öo]ner\b|kebab|kebap/.test(dt)) {
        return `Döner Kebab Imbiss ${city}`.trim();
      }
      if (
        /angus|wagyu|kobe|fleckvieh|simmental|charolais|hereford|limousin|chianina|galiz/.test(
          dt,
        )
      ) {
        return `${dish.text} Steak Steakhouse Restaurant ${city}`.trim();
      }
      if (/sushi/.test(dt)) return `Sushi Restaurant ${city}`.trim();
      if (/p(?:f)?ann(?:en)?fisch/.test(dt) || /pann/.test(dt) && /fisch/.test(dt)) {
        return `Pannfisch Fischrestaurant ${city}`.trim();
      }
      if (/\bfisch\b/.test(dt)) {
        return `Fischrestaurant Seafood ${dish.text} ${city}`.trim();
      }
      // Specialty-Snack/Gericht: Café/Bäckerei/Bistro mitnehmen (Croque ≠ Sight)
      return `${dish.text} Café Bäckerei Bistro Restaurant ${city}`.trim();
    }
    const amenity = req.wishes.find(
      (w) => w.kind === 'amenity' && w.hardness === 'must',
    );
    if (
      amenity &&
      /all_you_can_eat|ayce|buffet|schlemmer/i.test(amenity.text)
    ) {
      const avoid = (req.prefs.avoidCategories ?? [])
        .map((a) => String(a || '').toLowerCase())
        .filter(Boolean);
      const avoidAsia = avoid.some((a) =>
        /asia|asiatisch|asian|sushi|thai|chines|japan|vietnam|korea|mongol/i.test(a),
      );
      // Avoids aus Call-1 in die Query spiegeln — kein Asia-Default.
      if (avoidAsia) {
        return `All you can eat Buffet Flatrate griechisch mediterran lateinamerikanisch nicht asiatisch ${city}`.trim();
      }
      return `All you can eat Buffet Schlemmerbuffet Flatrate Restaurant ${city}`.trim();
    }
    if (amenity && /zugrestaurant|speisewagen|dining/.test(amenity.text.toLowerCase())) {
      return `Zugrestaurant Speisewagen Dining Car Bahnrestaurant ${city}`.trim();
    }
    if (cuisine) {
      const ct = cuisine.text.toLowerCase();
      if (/vegan/.test(ct)) return `vegan Restaurant ${city}`.trim();
      if (/vegetar/.test(ct)) return `vegetarisch vegetarian Restaurant ${city}`.trim();
      if (/indisch|indian/.test(ct)) {
        return `indisch indian curry Restaurant ${city}`.trim();
      }
      if (/asia|asiatisch/.test(ct)) {
        return `asiatisch asian thai Restaurant ${city}`.trim();
      }
      if (/italien|pizza/.test(ct)) return `Pizza italienisch Restaurant ${city}`.trim();
      return `${cuisine.text} Restaurant ${city}`.trim();
    }
    if (/spaghetti[- ]?eis|eisdiele|gelato|\beis\b/.test(wish)) {
      return `Eisdiele Gelateria Eis ${city}`.trim();
    }
    if (/\bpizza\b/.test(wish)) return `Pizza Restaurant ${city}`.trim();
    if (/sushi/.test(wish)) return `Sushi Restaurant ${city}`.trim();
    if (/\bburger\b/.test(wish)) return `Burger Restaurant ${city}`.trim();
    if (/steak/.test(wish)) return `Steak Steakhouse Grill Restaurant ${city}`.trim();
    if (
      /angus|wagyu|kobe|fleckvieh|simmental|charolais|hereford|limousin|chianina/.test(
        wish,
      )
    ) {
      return `Angus Wagyu Steak Steakhouse Restaurant ${city}`.trim();
    }
    if (/zugrestaurant|speisewagen|dining\s*car|bahnrestaurant/.test(wish)) {
      return `Zugrestaurant Speisewagen Dining Car Bahnrestaurant ${city}`.trim();
    }
    const spokenBlob = `${wish} ${req.title} ${req.context}`;
    if (
      !looksLikeSpokenMeatOrFish(spokenBlob) &&
      (/vegan/.test(wish) || /vegan/.test((req.prefs.diet ?? []).join(' ')))
    ) {
      return `vegan Restaurant ${city}`.trim();
    }
    if (
      !looksLikeSpokenMeatOrFish(spokenBlob) &&
      (/vegetar/.test(wish) || /vegetar/.test((req.prefs.diet ?? []).join(' ')))
    ) {
      return `vegetarisch vegetarian Restaurant ${city}`.trim();
    }
    if (/asiatisch|asian|thai|chinesisch|vietnam|indisch|indian/.test(wish)) {
      if (/indisch|indian/.test(wish)) {
        return `indisch indian curry Restaurant ${city}`.trim();
      }
      return `asiatisch Restaurant ${city}`.trim();
    }
    if (/frühstück|fruehstueck|breakfast/.test(wish)) {
      if (/hamburgerisch|hanseatisch|typisch hamburg|franzbrötchen/.test(wish)) {
        return `typisch hamburgerisch Frühstück Franzbrötchen Fischbrötchen Café Bäckerei ${city}`.trim();
      }
      return `Frühstück Café Brunch ${city}`.trim();
    }
    {
      const amenityBits = req.wishes
        .filter(
          (w) =>
            w.hardness === 'must' &&
            (w.kind === 'amenity' || w.kind === 'vibe'),
        )
        .map((w) => w.text.toLowerCase());
      const wantsWifi =
        amenityBits.some((t) => /wlan|wifi|wi-?fi|internet/.test(t)) ||
        /wlan|wifi|wi-?fi/.test(wish);
      const wantsOutlet =
        amenityBits.some((t) => /steckdose|socket|power|strom/.test(t)) ||
        /steckdose|socket/.test(wish);
      const wantsQuiet =
        amenityBits.some((t) => /ruhig|quiet|arbeiten/.test(t)) ||
        /ruhig|zum\s+arbeiten|cowork/.test(wish);
      if (wantsWifi || wantsOutlet || wantsQuiet) {
        return [
          wantsWifi ? 'WLAN WiFi' : '',
          wantsOutlet ? 'Steckdose laptop' : '',
          wantsQuiet ? 'ruhig' : '',
          'Café Coworking Arbeitsplatz',
          city,
        ]
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }
    if (
      /snack|snacks|döner|doener|kebab|imbiss|spät|spaet/.test(wish) ||
      (req.searchMode === 'here_now' && new Date(req.visitAtMs).getHours() >= 20)
    ) {
      return `Imbiss Döner Spätkauf open now ${city}`.trim();
    }
    return `Restaurant ${city}`.trim();
  }
  const amenityWish = wishBlob(req);
  if (/toilette|\bklo\b|\bwc\b|pinkeln|restroom/.test(amenityWish)) {
    return `Toilette WC Restroom ${city}`.trim();
  }
  if (/briefkasten|postkasten|post_box|mailbox|letter\s*box/.test(amenityWish)) {
    return `Briefkasten Postkasten mailbox post box ${city}`.trim();
  }
  if (/packstation|paketautomat|parcel.?locker|postfiliale/.test(amenityWish)) {
    return `Packstation Paketautomat parcel locker DHL ${city}`.trim();
  }
  if (/apotheke|pharmacy/.test(amenityWish)) {
    return `Apotheke pharmacy ${city}`.trim();
  }
  if (/geldautomat|\batm\b|bargeld/.test(amenityWish)) {
    return `Geldautomat ATM ${city}`.trim();
  }
  if (/parkplatz|parken|parkhaus|parking/.test(amenityWish)) {
    if (
      /\b(essen|restaurant|steak|hunger|pizza|sushi|vegan|vegetar)\b/.test(
        amenityWish,
      )
    ) {
      if (/steak/.test(amenityWish)) {
        return `Steak Steakhouse Grill Restaurant ${city}`.trim();
      }
      if (/vegan/.test(amenityWish)) {
        return `vegan Restaurant ${city}`.trim();
      }
      if (/vegetar/.test(amenityWish)) {
        return `vegetarisch vegetarian Restaurant ${city}`.trim();
      }
      return `Restaurant ${city}`.trim();
    }
    if (/kostenlos|gratis|frei(?:er|en)?\s+park/.test(amenityWish)) {
      return `kostenloser Parkplatz free parking ${city}`.trim();
    }
    return `Parkplatz Parken parking ${city}`.trim();
  }
  const base = `${req.title} ${req.context}`.replace(/\s+/g, ' ').trim();
  return `${base} ${city}`.trim().slice(0, 80);
}

/** Places-Textquery — Steak/vegan müssen im Suchstring stehen, nicht nacktes „Restaurant“. */
export function placesQueryForPitch(req: PitchRequest): string {
  return queryFor(req);
}

/** Places-Hits: Tags nur aus echten Types — nie blind „food“ stempeln. */
function softTagsForPlacesHit(
  req: PitchRequest,
  name: string,
  types?: string[] | null,
): string[] {
  if (req.kind === 'hotel') return ['hotel'];
  const tags = new Set<string>();
  const typeBlob = (types ?? []).join(' ').toLowerCase();
  const n = name.toLowerCase();
  const wish = wishBlob(req);
  if (/briefkasten|postkasten|post_box|mailbox/.test(wish)) {
    if (
      /briefkasten|postkasten|mailbox|letter\s*box|packstation/.test(
        n + ' ' + typeBlob,
      ) ||
      /post_box|mailbox|post_office/.test(typeBlob)
    ) {
      tags.add('briefkasten');
      tags.add('post_box');
    }
  }
  const foodishType =
    /restaurant|cafe|bakery|meal_takeaway|meal_delivery|bar|food|coffee|brunch/.test(
      typeBlob,
    ) ||
    /restaurant|café|cafe|bistro|bäck|baeck|bakery|imbiss|pizzeria|trattoria/.test(
      n,
    );
  if (req.kind === 'food' || req.kind === 'bar') {
    if (isParkingOrForestLotVenue(name, types)) {
      tags.add('parking');
      return [...tags];
    }
    // Metzgerei/Fleischanbieter ≠ Speiselokal (außer klar Steakhouse/Grill)
    if (
      (/butcher_shop/.test(typeBlob) ||
        /\b(fleischerei|metzgerei|metzger|butcher)\b/.test(n)) &&
      !/\b(steakhouse|steak.?haus|grillhaus|restaurant|parrilla|churrasco)\b/.test(n) &&
      !/restaurant|steakhouse|meal_takeaway/.test(typeBlob)
    ) {
      tags.add('butcher');
      return [...tags];
    }
    if (foodishType) {
      tags.add('food');
      tags.add(req.kind);
      if (/restaurant/.test(typeBlob) || /restaurant/.test(n)) {
        tags.add('restaurant');
      }
      if (/cafe|coffee/.test(typeBlob) || /café|cafe/.test(n)) tags.add('cafe');
      if (/bakery/.test(typeBlob) || /bäck|baeck|bakery/.test(n)) {
        tags.add('bakery');
      }
      if (/bar|pub/.test(typeBlob)) tags.add('bar');
    }
    // Landmarken-Types explizit markieren (Filter killt sie)
    if (
      /\b(park|tourist_attraction|point_of_interest|bridge|route|church|museum)\b/.test(
        typeBlob,
      ) &&
      !foodishType
    ) {
      tags.add('tourist_attraction');
      if (/\bpark\b/.test(typeBlob) && !/\bparking\b/.test(typeBlob)) {
        tags.add('park');
      }
    }
  }
  // Cuisine-Tags nur aus Name/Types — nie aus dem User-Wunsch stempeln
  // (sonst wird jedes Food-Hit „pizza“ und Strandbars überleben Hard-Match).
  if (/pizza|pizzeria/.test(n) || /\bpizza\b/.test(typeBlob)) {
    tags.add('pizza');
  }
  if (/sushi/.test(n) || /\bsushi\b/.test(typeBlob)) tags.add('sushi');
  if (/\bburger\b/.test(n) || /\bburger\b/.test(typeBlob)) tags.add('burger');
  for (const f of inferGastroFacetTags(name, typeBlob)) tags.add(f);
  if (
    /eisdiele|gelater|eiscafe|eiscafé|eiscafe|\beis\b|gelato/.test(n) ||
    /ice_cream/.test(typeBlob)
  ) {
    tags.add('eis');
    tags.add('eisdiele');
  }
  // Open-Find / generic: Google-Types in Tags (Must-Stempel nur an Places-Hits unten)
  if (req.kind === 'generic' || req.kind === 'sight') {
    for (const t of types ?? []) {
      const low = String(t || '')
        .toLowerCase()
        .trim();
      if (low.length >= 3 && low.length <= 40) tags.add(low);
    }
  }
  return [...tags];
}

function boundForMode(mode: PitchSearchMode): number {
  if (mode === 'city_best') return 25_000;
  if (mode === 'here_now') return HERE_NOW_RINGS_M[HERE_NOW_RINGS_M.length - 1]!;
  if (mode === 'landmark') return 4_000;
  return 3_500;
}

async function packCandidatesAsync(req: PitchRequest): Promise<PitchCandidate[]> {
  type RawPoi = {
    id?: number;
    name?: string;
    lat?: number;
    lng?: number;
    tags_json?: string | null;
    general_info?: string | null;
    _packId?: string | null;
  };
  let pois: RawPoi[] = [];
  const cityHint = (req.cityHint || '').trim();
  const cityBest =
    req.searchMode === 'city_best' && cityHint && !/\bhier\b/i.test(cityHint);
  let preferredId: string | null = null;
  let activeId = '';
  try {
    const { getActiveCityForConcierge } = require('../../services/concierge/activeCityContext') as {
      getActiveCityForConcierge: () => { cityId: string } | null;
    };
    activeId = String(getActiveCityForConcierge()?.cityId || '')
      .trim()
      .toLowerCase();
  } catch {
    activeId = '';
  }
  if (cityBest) {
    try {
      const {
        resolveCachedCityIdFromHint,
        listCachedPackSpotsForPitch,
      } = await import('../../services/navigation/packPlaceResolve') as {
        resolveCachedCityIdFromHint: (h: string | null | undefined) => Promise<string | null>;
        listCachedPackSpotsForPitch: (
          id: string,
        ) => Promise<
          Array<{ name: string; lat: number; lng: number; tags: string; category: string }>
        >;
      };
      preferredId = await resolveCachedCityIdFromHint(cityHint);
      if (preferredId && preferredId !== activeId) {
        const spots = await listCachedPackSpotsForPitch(preferredId);
        pois = spots.map((s) => ({
          name: s.name,
          lat: s.lat,
          lng: s.lng,
          tags_json: s.tags,
          general_info: s.category,
          _packId: preferredId,
        }));
      } else {
        pois = ((await getAllPois()) as RawPoi[]).map((p) => ({
          ...p,
          _packId: activeId || null,
        }));
      }
    } catch {
      pois = (await getAllPois()) as RawPoi[];
    }
  } else {
    pois = (await getAllPois()) as RawPoi[];
  }

  const mapPoisToCandidates = (list: RawPoi[]): PitchCandidate[] => {
    const bound = boundForMode(req.searchMode);
    const out: PitchCandidate[] = [];
    for (const p of list) {
      if (p.lat == null || p.lng == null || !p.name?.trim()) continue;
      if (isWegweiserOrApproachName(p.name, p.tags_json)) continue;
      if (isSubEntranceName(p.name, p.tags_json)) continue;
      if (
        looksLikePicnicQuery(wishBlob(req)) &&
        isPicnicUnsuitableVenue(p.name, `${p.tags_json ?? ''} ${p.general_info ?? ''}`)
      ) {
        continue;
      }
      if (
        (req.kind === 'food' || req.kind === 'bar') &&
        isParkingOrForestLotVenue(p.name, `${p.tags_json ?? ''} ${p.general_info ?? ''}`)
      ) {
        continue;
      }
      try {
        const { isProductionOnlyBakery } = require('../agents/localDiningCatalog') as {
          isProductionOnlyBakery: (n: string, t?: string | null) => boolean;
        };
        if (isProductionOnlyBakery(p.name, `${p.tags_json ?? ''} ${p.general_info ?? ''}`)) {
          continue;
        }
      } catch {
        /* soft */
      }
      const d = haversineMeters(req.anchor.lat, req.anchor.lng, p.lat, p.lng);
      if (req.searchMode !== 'city_best' && d > bound + 800) continue;
      const tags = `${p.tags_json ?? ''} ${p.general_info ?? ''}`.toLowerCase();
      const name = p.name.toLowerCase();
      const softTags: string[] = [];
      if (
        /restaurant|café|cafe|imbiss|gastro|bäck|baeck|bakery|bistro|breakfast|frühstück/.test(
          tags + name,
        )
      ) {
        softTags.push('food');
      }
      if (/hotel|pension/.test(tags + name)) softTags.push('hotel');
      if (
        /museum|kirche|denkmal|aussicht|strand|beach|baden|freibad|park|wiese|see|teich|grillplatz|picknick/.test(
          tags + name,
        )
      ) {
        softTags.push('sight');
      }
      if (
        /briefkasten|post_box|mailbox|postkasten/.test(tags + name)
      ) {
        softTags.push('briefkasten', 'post_box', 'mailbox');
      }
      if (/packstation|paketautomat|parcel.?locker/.test(tags + name)) {
        softTags.push('packstation', 'parcel_locker');
      }
      for (const f of inferGastroFacetTags(p.name, tags)) {
        if (!softTags.includes(f)) softTags.push(f);
      }
      const wishHit = req.wishes.some((w) => {
        const wt = w.text.toLowerCase().trim();
        if (wt.length < 3) return false;
        if (/^(essen|food|restaurant|abend|mittag|heute|dort|hier)$/i.test(wt)) {
          return false;
        }
        return name.includes(wt) || tags.includes(wt);
      });
      // Theme-Must: Pack nur bei Attraction-Beleg — Souvenir/Bild-Hits → Places/Web
      const themeMusts = req.wishes.filter(
        (w) => w.hardness === 'must' && w.kind === 'theme',
      );
      if (themeMusts.length) {
        try {
          const { packHitTooWeakForThemeMust } = require('../mission/openPlaceFind') as {
            packHitTooWeakForThemeMust: (blob: string, themes: string[]) => boolean;
          };
          const evidenceBlob = `${p.name} ${tags} ${p.general_info ?? ''}`;
          if (
            packHitTooWeakForThemeMust(
              evidenceBlob,
              themeMusts.map((w) => w.text),
            )
          ) {
            continue;
          }
        } catch {
          /* soft */
        }
      }
      if (req.kind === 'food' || req.kind === 'bar') {
        const gastro =
          softTags.includes('food') ||
          /restaurant|café|cafe|pizzeria|imbiss|trattoria|osteria|bistro|gastro|bäck|baeck|bakery|breakfast|frühstück/.test(
            tags + name,
          );
        if (!gastro) continue;
        if (
          /(wald)?parkplatz|parkhaus|p\+r\b|parking[_ -]?lot/.test(`${name} ${tags}`) &&
          !/restaurant|gasthof|wirtshaus|hotel|café|cafe|bistro/.test(`${name} ${tags}`)
        ) {
          continue;
        }
        if (
          /\b(brücke|bruecke|eisenbahn|bahnhof|haltestelle|denkmal|verein|museum|kirche|schule)\b/.test(
            `${name} ${tags}`,
          )
        ) {
          continue;
        }
        // AYCE: Pack-Soft-Fill (Goldschätzchen o. ä.) ohne Beleg nie in den Pool
        try {
          const { looksLikeAyceQuery } = require('./ayceIntent') as {
            looksLikeAyceQuery: (s: string) => boolean;
          };
          const { scoreAyceEvidence } = require('./hardMatchVerify') as {
            scoreAyceEvidence: (b: string) => number;
          };
          const qBlob = wishBlob(req);
          const ayceWish = req.wishes.some((w) =>
            /all_you_can_eat|ayce|buffet|schlemmer/i.test(w.text),
          );
          if (ayceWish || looksLikeAyceQuery(qBlob)) {
            const evidenceBlob = `${p.name} ${tags} ${p.general_info ?? ''}`;
            if (scoreAyceEvidence(evidenceBlob) < 2) continue;
          }
        } catch {
          /* soft */
        }
      } else if (!wishHit && softTags.length === 0) {
        continue;
      }
      out.push({
        name: p.name.trim(),
        lat: p.lat,
        lng: p.lng,
        placeId: null,
        rating: null,
        mapsUrl: mapsUrlFor(p.name, p.lat, p.lng),
        softTags,
        source: 'pack',
        distFromAnchorM: d,
      });
    }
    return out;
  };

  let out = mapPoisToCandidates(pois);

  // Leer/dünn lokal: gecachte Nachbar-Packs — NICHT bei fremder researchCity / city_best Landmark
  const foreignCity =
    Boolean((req.cityHint || '').trim()) &&
    (req.searchMode === 'city_best' ||
      /\b(hamburg|berlin|münchen|muenchen|köln|koeln|alster|elbe)\b/iu.test(
        req.cityHint || '',
      ));
  const needCascade =
    (req.kind === 'food' || req.kind === 'bar' || req.kind === 'sight') &&
    out.length < 4 &&
    !foreignCity;
  if (needCascade) {
    try {
      const {
        listCachedCityPackIdsByDistance,
        listCachedPackSpotsForPitch,
      } = await import('../../services/navigation/packPlaceResolve') as {
        listCachedCityPackIdsByDistance: (
          lat: number,
          lng: number,
          o?: {
            excludeIds?: string[] | null;
            maxKm?: number | null;
            limit?: number | null;
          },
        ) => Promise<Array<{ id: string; distM: number }>>;
        listCachedPackSpotsForPitch: (
          id: string,
        ) => Promise<
          Array<{ name: string; lat: number; lng: number; tags: string; category: string }>
        >;
      };
      const exclude = [preferredId, activeId].filter(Boolean) as string[];
      const neighbors = await listCachedCityPackIdsByDistance(
        req.anchor.lat,
        req.anchor.lng,
        { excludeIds: exclude, maxKm: 100, limit: 5 },
      );
      const seenNames = new Set(out.map((c) => c.name.toLowerCase()));
      for (const n of neighbors) {
        if (out.length >= 8) break;
        const spots = await listCachedPackSpotsForPitch(n.id);
        if (!spots.length) continue;
        const mapped = mapPoisToCandidates(
          spots.map((s) => ({
            name: s.name,
            lat: s.lat,
            lng: s.lng,
            tags_json: s.tags,
            general_info: s.category,
            _packId: n.id,
          })),
        );
        for (const c of mapped) {
          const key = c.name.toLowerCase();
          if (seenNames.has(key)) continue;
          seenNames.add(key);
          // Distanz ehrlich: mind. Pack-Anker-Distanz merken (softTag)
          if (n.distM > 8_000) {
            c.softTags = [...(c.softTags ?? []), `expand_pack_${n.id}`];
            c.hookNotes = [
              ...(c.hookNotes ?? []),
              `Nachbar-Pack ~${Math.round(n.distM / 1000)} km`,
            ].slice(0, 4);
          }
          out.push(c);
          if (out.length >= 12) break;
        }
        if (__DEV__) {
          console.warn(
            `[pitch] pack-cascade id=${n.id} distKm=${(n.distM / 1000).toFixed(1)} added→${out.length}`,
          );
        }
      }
    } catch {
      /* soft — Places-Pfad bleibt */
    }
  }

  return out.slice(0, 40);
}

async function placesCandidates(
  req: PitchRequest,
): Promise<PitchCandidate[]> {
  const bound = boundForMode(req.searchMode);
  const gastroLive = req.kind === 'food' || req.kind === 'bar';
  const interestSight = req.kind === 'sight' || req.kind === 'tour';
  const namedVenue = namedVenueFromWishes(req.wishes);
  const ayceMust = req.wishes.some(
    (w) =>
      w.hardness === 'must' &&
      w.kind === 'amenity' &&
      /all_you_can_eat|ayce|buffet|schlemmer/i.test(w.text),
  );
  const steakMust = req.wishes.some(
    (w) =>
      w.hardness === 'must' &&
      (w.kind === 'dish' || w.kind === 'cuisine') &&
      /steak/i.test(w.text),
  );
  const expandM =
    typeof req.liveExpandRadiusM === 'number' &&
    Number.isFinite(req.liveExpandRadiusM) &&
    req.liveExpandRadiusM > 0
      ? Math.min(120_000, Math.floor(req.liveExpandRadiusM))
      : 0;
  const openPlaceMust =
    req.kind === 'generic' &&
    req.wishes.some(
      (w) =>
        w.hardness === 'must' &&
        (w.kind === 'amenity' || w.kind === 'theme') &&
        !/\b(toilette|klo|wc|briefkasten|postkasten|mailbox|packstation|trinkwasser)\b/i.test(
          w.text,
        ),
    );
  // Sight/Interesse: Pack leer lokal → Places 50–100 km
  // Open-Find (Ortstyp aus Frage): ab 25 km, Expand bis maxRadiusKm (~100)
  // AYCE: Metro-Radius 55 km+, nicht am Dorf-GPS bei ~12–25 km hängen
  const radiusM = expandM
    ? Math.max(bound, expandM)
    : namedVenue
      ? 50_000
      : ayceMust
        ? Math.max(bound, 55_000)
      : steakMust
        ? Math.max(bound, 22_000)
      : openPlaceMust
        ? Math.max(bound, 25_000)
      : interestSight
        ? Math.max(bound, 80_000)
        : gastroLive
          ? Math.max(bound, req.searchMode === 'city_best' ? 15_000 : 12_000)
          : req.searchMode === 'city_best'
            ? Math.max(bound, 15_000)
            : req.searchMode === 'here_now'
              ? Math.max(
                  bound,
                  HERE_NOW_RINGS_M[HERE_NOW_RINGS_M.length - 1] ?? bound,
                )
              : Math.max(bound, 2_500);
  const seen = new Set<string>();
  const out: PitchCandidate[] = [];
  const q = queryFor(req);
  let searchLat = req.anchor.lat;
  let searchLng = req.anchor.lng;
  if (
    (ayceMust || steakMust || req.searchMode === 'city_best') &&
    (req.cityHint || '').trim() &&
    !/\bhier\b/i.test(req.cityHint || '')
  ) {
    try {
      const { geocodePlaceName } = require('../../services/navigation/googleMapsNav') as {
        geocodePlaceName: (
          q: string,
          o?: { cityHint?: string | null },
        ) => Promise<{ lat: number; lng: number } | null>;
      };
      const geo = await geocodePlaceName(String(req.cityHint).trim(), {
        cityHint: req.cityHint,
      });
      if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
        searchLat = geo.lat;
        searchLng = geo.lng;
      }
    } catch {
      /* soft */
    }
  }
  try {
    const hits = await searchPlacesByText({
      query: q,
      lat: searchLat,
      lng: searchLng,
      radiusM,
      enrich: true,
      forVisitMs: req.visitAtMs,
    });
    let extraHits: typeof hits = [];
    const avoidsAsia = (req.prefs?.avoidCategories ?? []).some((a) =>
      /asiatisch|asian|sushi|thai|japan|china|vietnam|korea|indisch|ramen|poke/i.test(
        a,
      ),
    );
    if (ayceMust && (hits?.length ?? 0) < 4 && !avoidsAsia) {
      try {
        extraHits =
          (await searchPlacesByText({
            query: `All you can eat Sushi Buffet Restaurant ${req.cityHint || ''}`.trim(),
            lat: searchLat,
            lng: searchLng,
            radiusM: Math.max(radiusM, 60_000),
            enrich: true,
            forVisitMs: req.visitAtMs,
          })) ?? [];
      } catch {
        extraHits = [];
      }
    } else if (ayceMust && (hits?.length ?? 0) < 4 && avoidsAsia) {
      try {
        extraHits =
          (await searchPlacesByText({
            query: `All you can eat Buffet Flatrate nicht asiatisch ${req.cityHint || ''}`.trim(),
            lat: searchLat,
            lng: searchLng,
            radiusM: Math.max(radiusM, 60_000),
            enrich: true,
            forVisitMs: req.visitAtMs,
          })) ?? [];
      } catch {
        extraHits = [];
      }
    } else if (steakMust && (hits?.length ?? 0) < 4) {
      try {
        extraHits =
          (await searchPlacesByText({
            query: 'Steakhouse Steak Grill Restaurant',
            lat: searchLat,
            lng: searchLng,
            radiusM: Math.max(radiusM, 22_000),
            enrich: true,
            forVisitMs: req.visitAtMs,
          })) ?? [];
      } catch {
        extraHits = [];
      }
    }
    for (const h of [...(hits ?? []), ...extraHits]) {

      if (!h?.name || h.lat == null || h.lng == null) continue;
      if (isWegweiserOrApproachName(h.name)) continue;
      if (isSubEntranceName(h.name)) continue;
      const typesEarly = Array.isArray(h.types) ? h.types : null;
      if (looksLikePicnicQuery(wishBlob(req)) && isPicnicUnsuitableVenue(h.name, typesEarly)) {
        continue;
      }
      if (
        (req.kind === 'food' || req.kind === 'bar') &&
        isParkingOrForestLotVenue(h.name, typesEarly)
      ) {
        continue;
      }
      try {
        const {
          looksLikeAsianCuisineVenue,
          looksLikeButcherNotDining,
        } = require('./specializedFoodMatch') as {
          looksLikeAsianCuisineVenue: (b: string) => boolean;
          looksLikeButcherNotDining: (b: string) => boolean;
        };
        const earlyBlob = `${h.name} ${(typesEarly ?? []).join(' ')}`;
        if (avoidsAsia && looksLikeAsianCuisineVenue(earlyBlob)) continue;
        if (steakMust && looksLikeButcherNotDining(earlyBlob)) continue;
      } catch {
        /* soft */
      }
      const key = h.placeId || `${h.name}_${h.lat}_${h.lng}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = haversineMeters(req.anchor.lat, req.anchor.lng, h.lat, h.lng);
      const nameMatch = Boolean(namedVenue) && venueNameMatches(h.name, namedVenue!);
      const maxDist = expandM
        ? Math.max(expandM, 40_000)
        : ayceMust
          ? 90_000
        : steakMust
          ? 25_000
        : interestSight
          ? 100_000
          : 40_000;
      if (d > 100_000) continue;
      if (!nameMatch && d > maxDist) continue;
      if (
        !nameMatch &&
        !expandM &&
        d > bound + 1000 &&
        req.searchMode !== 'city_best' &&
        !interestSight &&
        !(gastroLive && d <= (steakMust ? 22_000 : 12_000))
      ) {
        continue;
      }
      const types = Array.isArray(h.types) ? h.types : null;
      const typeBlob = (types ?? []).join(' ').toLowerCase();
      if (
        (req.kind === 'food' || req.kind === 'bar') &&
        (/parking|parking_lot|park_and_ride/.test(typeBlob) ||
          (/(wald)?parkplatz|parkhaus/.test(h.name.toLowerCase()) &&
            !/restaurant|gasthof|wirtshaus|hotel/.test(h.name.toLowerCase())))
      ) {
        continue;
      }
      out.push({
        name: h.name,
        lat: h.lat,
        lng: h.lng,
        placeId: h.placeId ?? null,
        rating: typeof h.rating === 'number' ? h.rating : null,
        ratingCount:
          typeof h.ratingCount === 'number' ? h.ratingCount : null,
        address: null,
        mapsUrl: mapsUrlFor(h.name, h.lat, h.lng, h.placeId),
        openNow: h.openNow ?? null,
        opensAtMin: h.opensAtMin ?? null,
        closesAtMin: h.closesAtMin ?? null,
        closedOnVisitDay:
          (h as { closedOnVisitDay?: boolean | null }).closedOnVisitDay ?? null,
        softTags: [
          ...softTagsForPlacesHit(req, h.name, types),
          ...(expandM ? [`live_expand_${Math.round(expandM / 1000)}km`] : []),
          // Places-Query war der Ortstyp → Treffer erfüllen Must ohne Domänen-Synonyme
          ...(openPlaceMust
            ? req.wishes
                .filter(
                  (w) =>
                    w.hardness === 'must' &&
                    (w.kind === 'amenity' || w.kind === 'theme'),
                )
                .map((w) => w.text.toLowerCase().trim())
                .filter((t) => t.length >= 3)
            : []),
        ],
        source: 'places',
        distFromAnchorM: d,
        websiteUrl:
          typeof (h as { websiteUri?: string | null }).websiteUri === 'string'
            ? String((h as { websiteUri: string }).websiteUri).trim() || null
            : null,
      });
      if (out.length >= 24) break;
    }
  } catch {
    /* soft */
  }
  // Strand weit weg (Küste) → zusätzlich nähere Badestellen/Freibäder
  if (
    req.kind === 'sight' &&
    /strand|beach|baden|badestelle|freibad/.test(wishBlob(req))
  ) {
    try {
      const nearHits = await searchPlacesByText({
        query: `Freibad Badestelle Badesee ${req.cityHint || ''}`.trim(),
        lat: req.anchor.lat,
        lng: req.anchor.lng,
        radiusM: 12_000,
        enrich: true,
        forVisitMs: req.visitAtMs,
      });
      for (const h of nearHits ?? []) {
        if (!h?.name || h.lat == null || h.lng == null) continue;
        if (isWegweiserOrApproachName(h.name)) continue;
      if (isSubEntranceName(h.name)) continue;
        const key = h.placeId || `${h.name}_${h.lat}_${h.lng}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const d = haversineMeters(req.anchor.lat, req.anchor.lng, h.lat, h.lng);
        const types = Array.isArray(h.types) ? h.types : null;
        out.push({
          name: h.name,
          lat: h.lat,
          lng: h.lng,
          placeId: h.placeId ?? null,
          rating: typeof h.rating === 'number' ? h.rating : null,
          ratingCount:
            typeof h.ratingCount === 'number' ? h.ratingCount : null,
          address: null,
          mapsUrl: mapsUrlFor(h.name, h.lat, h.lng, h.placeId),
          openNow: h.openNow ?? null,
          opensAtMin: h.opensAtMin ?? null,
          closesAtMin: h.closesAtMin ?? null,
          closedOnVisitDay:
            (h as { closedOnVisitDay?: boolean | null }).closedOnVisitDay ??
            null,
          softTags: softTagsForPlacesHit(req, h.name, types),
          source: 'places',
          distFromAnchorM: d,
          websiteUrl:
            typeof (h as { websiteUri?: string | null }).websiteUri ===
            'string'
              ? String((h as { websiteUri: string }).websiteUri).trim() || null
              : null,
        });
        if (out.length >= 32) break;
      }
    } catch {
      /* soft */
    }
  }
  return out;
}

/** OSM €0: WLAN / Steckdose / Briefkasten wenn Pack die Amenities nicht trägt. */
async function osmAmenityCandidates(
  req: PitchRequest,
): Promise<PitchCandidate[]> {
  const blob = wishBlob(req);
  const amenityBits = req.wishes
    .filter(
      (w) =>
        w.hardness === 'must' && (w.kind === 'amenity' || w.kind === 'vibe'),
    )
    .map((w) => w.text.toLowerCase());
  const wantsWifi =
    amenityBits.some((t) => /wlan|wifi|wi-?fi|internet/.test(t)) ||
    /wlan|wifi|wi-?fi/.test(blob);
  const wantsOutlet =
    amenityBits.some((t) => /steckdose|socket|power|strom/.test(t)) ||
    /steckdose|socket/.test(blob);
  const wantsPostBox =
    amenityBits.some((t) =>
      /briefkasten|postkasten|post_box|mailbox|letter/.test(t),
    ) || /briefkasten|postkasten|post_box|mailbox/.test(blob);
  const wantsParcel =
    amenityBits.some((t) => /packstation|paketautomat|parcel/.test(t)) ||
    /packstation|paketautomat|parcel.?locker/.test(blob);
  const wantsWater =
    amenityBits.some((t) => /trinkwasser|drinking|trinkbrunnen/.test(t)) ||
    /trinkwasser|trinken\s+wasser|trinkbrunnen|drinking\s*water/.test(blob);
  const wantsBasketball =
    amenityBits.some((t) => /basketball/.test(t)) || /basketball/.test(blob);
  const wantsTableTennis =
    amenityBits.some((t) => /tischtennis|table.?tennis|ping.?pong/.test(t)) ||
    /tischtennis|table.?tennis|ping.?pong/.test(blob);
  const wantsBbq =
    amenityBits.some((t) => /grill|bbq|barbecue/.test(t)) ||
    /grillplatz|grillstelle|bbq|barbecue/.test(blob);
  const wantsPicnic =
    amenityBits.some((t) => /picknick|picnic/.test(t)) ||
    /picknick|picnic/.test(blob);
  if (
    !wantsWifi &&
    !wantsOutlet &&
    !wantsPostBox &&
    !wantsParcel &&
    !wantsWater &&
    !wantsBasketball &&
    !wantsTableTennis &&
    !wantsBbq &&
    !wantsPicnic
  ) {
    return [];
  }
  if (
    !wantsPostBox &&
    !wantsParcel &&
    !wantsWater &&
    !wantsBasketball &&
    !wantsTableTennis &&
    !wantsBbq &&
    !wantsPicnic &&
    req.kind !== 'food' &&
    req.kind !== 'bar' &&
    req.kind !== 'generic' &&
    req.kind !== 'sight'
  ) {
    return [];
  }

  const types: Array<{ placeType: string; tags: string[] }> = [];
  if (wantsPostBox) {
    types.push({
      placeType: 'post_box',
      tags: ['briefkasten', 'post_box', 'mailbox'],
    });
  }
  if (wantsParcel) {
    types.push({
      placeType: 'parcel_locker',
      tags: ['packstation', 'parcel_locker'],
    });
  }
  if (wantsWater) {
    types.push({
      placeType: 'drinking_water',
      tags: ['trinkwasser', 'drinking_water'],
    });
  }
  if (wantsBasketball) {
    types.push({
      placeType: 'basketball',
      tags: ['basketball', 'pitch', 'sport'],
    });
  }
  if (wantsTableTennis) {
    types.push({
      placeType: 'table_tennis',
      tags: ['tischtennis', 'table_tennis', 'sport'],
    });
  }
  if (wantsBbq) {
    types.push({
      placeType: 'barbecue',
      tags: ['grillplatz', 'bbq', 'barbecue'],
    });
  }
  if (wantsPicnic) {
    types.push({
      placeType: 'picnic_site',
      tags: ['picknick', 'picnic_site'],
    });
  }
  if (wantsWifi) types.push({ placeType: 'wifi', tags: ['wlan', 'wifi', 'food', 'cafe'] });
  if (wantsOutlet) {
    types.push({
      placeType: 'outlet_cafe',
      tags: ['steckdose', 'food', 'cafe'],
    });
  }

  const radiusM = Math.min(
    Math.max(
      boundForMode(req.searchMode),
      wantsPostBox ||
        wantsParcel ||
        wantsWater ||
        wantsBasketball ||
        wantsTableTennis ||
        wantsBbq ||
        wantsPicnic
        ? 6_000
        : 2_500,
    ),
    20_000,
  );
  const out: PitchCandidate[] = [];
  const seen = new Set<string>();
  try {
    const { searchOsmPlacesNearby } = await import(
      '../../services/navigation/overpassService'
    );
    for (const t of types) {
      const hits = await searchOsmPlacesNearby({
        lat: req.anchor.lat,
        lng: req.anchor.lng,
        placeType: t.placeType,
        radiusM,
      });
      for (const h of hits ?? []) {
        const rawName = String(h?.name || '').trim();
        const name =
          rawName ||
          (t.placeType === 'post_box'
            ? 'Briefkasten'
            : t.placeType === 'parcel_locker'
              ? 'Packstation'
              : t.placeType === 'drinking_water'
                ? 'Trinkwasser'
                : t.placeType === 'basketball'
                  ? 'Basketballplatz'
                  : t.placeType === 'table_tennis'
                    ? 'Tischtennisplatte'
                    : t.placeType === 'barbecue'
                      ? 'Grillplatz'
                      : t.placeType === 'picnic_site'
                        ? 'Picknickplatz'
                        : '');
        if (!name || !Number.isFinite(h.lat) || !Number.isFinite(h.lng)) {
          continue;
        }
        if (isWegweiserOrApproachName(name)) continue;
        if (isParkingOrForestLotVenue(name, h.types)) continue;
        // Briefkasten-Suche: nie Bahnhof/Bäckerei als OSM-Treffer
        if (
          (wantsPostBox || wantsParcel) &&
          /\b(bahnhof|haltestelle|bäck|baeck|bakery|café|cafe|restaurant)\b/i.test(
            name,
          )
        ) {
          continue;
        }
        const key = h.placeId || `${name}_${h.lat}_${h.lng}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const softTags = [
          ...t.tags,
          ...inferGastroFacetTags(name, (h.types ?? []).join(' ')),
        ];
        out.push({
          name,
          lat: h.lat,
          lng: h.lng,
          placeId: h.placeId ?? null,
          rating: null,
          mapsUrl: mapsUrlFor(name, h.lat, h.lng),
          openNow: h.openNow ?? null,
          softTags: [...new Set(softTags)],
          hardEvidence: t.tags.filter(
            (x) =>
              x === 'wlan' ||
              x === 'steckdose' ||
              x === 'briefkasten' ||
              x === 'post_box' ||
              x === 'packstation',
          ),
          source: 'osm',
          distFromAnchorM: h.distanceM,
        });
        if (out.length >= 16) break;
      }
      if (out.length >= 16) break;
    }
  } catch {
    /* soft */
  }
  return out;
}

function applyDetourScores(
  req: PitchRequest,
  list: PitchCandidate[],
): PitchCandidate[] {
  return list.map((c) => {
    if (
      (req.searchMode === 'on_route' || req.searchMode === 'between_stops') &&
      req.route
    ) {
      const s = scoreDetourOnRoute(c, req.route);
      return {
        ...c,
        detourPrio: s.prio,
        detourMinApprox: s.extraMin,
        sideM: s.sideM,
      };
    }
    if (req.searchMode === 'landmark' && req.landmark) {
      const s = scoreDetourLandmark(c, req.landmark);
      return {
        ...c,
        detourPrio: s.prio,
        detourMinApprox: s.extraMin,
        sideM: s.sideM,
      };
    }
    const d = c.distFromAnchorM ?? 0;
    return {
      ...c,
      detourPrio: hereNowPrio(d),
      detourMinApprox: d / 80,
      sideM: d,
    };
  });
}

export async function collectCandidates(
  req: PitchRequest,
): Promise<PitchCandidate[]> {
  // Named city → Anker auf Stadtzentrum (nicht GPS), sonst Hotels in Priestewitz
  let effective = req;
  if (
    req.searchMode === 'city_best' &&
    req.cityHint &&
    !/\bhier\b/i.test(req.cityHint)
  ) {
    try {
      const { geocodePlaceName } = await import(
        '../../services/navigation/googleMapsNav'
      );
      const geo = await geocodePlaceName(req.cityHint, {
        cityHint: req.cityHint,
      });
      if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
        effective = {
          ...req,
          anchor: { lat: geo.lat, lng: geo.lng },
        };
      }
    } catch {
      /* soft — GPS-Anker bleibt */
    }
  }
  if (effective.kind === 'hotel') {
    try {
      const { stay22HotelCandidates } = await import('./stay22HotelCandidates');
      const live = await stay22HotelCandidates(effective);
      if (live.length >= 1) {
        return applyDetourScores(effective, live);
      }
    } catch {
      /* Stay22 leer */
    }
    const named =
      effective.searchMode === 'city_best' &&
      Boolean((effective.cityHint || '').trim()) &&
      !/\bhier\b/i.test(effective.cityHint || '');
    if (named) {
      const places = await placesCandidates(effective);
      if (places.length) {
        try {
          const { buildPitchHotelBookingUrl } = await import('./pitchBookingUrl');
          for (const c of places) {
            if (!c.bookingUrl) {
              c.bookingUrl = buildPitchHotelBookingUrl(
                c.name,
                `${effective.title} ${effective.context}`,
                effective.cityHint,
              );
            }
          }
        } catch {
          /* soft */
        }
        return applyDetourScores(effective, places);
      }
    }
    return [];
  }

  const [pack, places, osm] = await Promise.all([
    packCandidatesAsync(effective),
    placesCandidates(effective),
    osmAmenityCandidates(effective),
  ]);
  console.warn(
    `[pitch] pool kind=${effective.kind} mode=${effective.searchMode} city=${effective.cityHint || '-'} pack=${pack.length} places=${places.length} osm=${osm.length} q=${queryFor(effective).slice(0, 90)}`,
  );
  const merged: PitchCandidate[] = [];
  const seen = new Set<string>();
  // Hamburg AYCE Soft-Seeds (Pitch-Overlay) — bewusst kein Pack/GPS-Upload
  try {
    const {
      hamburgAyceSeedsForQuery,
      hamburgAyceMapsUrl,
      detectAyceWeekdayFromQuery,
    } = await import('./hamburgAyceSeeds');
    const { looksLikeAyceQuery } = await import('./ayceIntent');
    const q = queryFor(effective);
    const blob = `${effective.title} ${effective.context} ${q}`;
    const avoidAsia =
      (effective.prefs?.avoidCategories ?? []).some((c) => /asia|asiat/i.test(c)) ||
      /kein\s+asiat|nicht\s+asiat|ohne\s+asia|no\s+asia|kein\s+sushi/i.test(blob);
    if (looksLikeAyceQuery(q) || /ayce|all\s*you\s*can\s*eat|rodizio/i.test(blob)) {
      const weekday = detectAyceWeekdayFromQuery(blob);
      for (const s of hamburgAyceSeedsForQuery({
        cityHint: effective.cityHint,
        query: blob,
        avoidAsia,
        weekday,
      })) {
        const key = (s.placeId || s.name).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push({
          name: s.name,
          lat: s.lat,
          lng: s.lng,
          placeId: s.placeId,
          mapsUrl: hamburgAyceMapsUrl(s),
          softTags: s.softTags,
          hardEvidence: s.evidence,
          websiteUrl: s.websiteUrl ?? null,
          source: 'soft_seed',
          detourPrio: 3,
        });
      }
    }
  } catch {
    /* soft */
  }
  // Pack first, dann OSM (belegte Amenities), dann Places
  for (const c of [...pack, ...osm, ...places]) {
    const key = (c.placeId || c.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }
  return applyDetourScores(effective, merged);
}

export function kindHint(kind: PitchKind): string {
  return kind;
}
