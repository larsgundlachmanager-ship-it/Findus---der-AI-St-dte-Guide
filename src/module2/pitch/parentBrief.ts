/**
 * Parent-Helfer: searchMode + visitAt + Pref-Slice + Bridge-Länge.
 */

import type {
  PitchKind,
  PitchPrefSlice,
  PitchSearchMode,
  PitchWish,
} from './types';
import {
  looksLikePannfisch,
  looksLikeSpokenMeatOrFish,
  looksLikeCattleBreed,
  looksLikeTrainRestaurant,
  canonicalCattleBreed,
} from './specializedFoodMatch';
import { extractNamedRestaurantWish } from './namedVenueIntent';

const BEST_CITY_RE =
  /\b(beste[rn]?|den\s+besten|die\s+beste|das\s+beste|top[\s-]?(italiener|restaurant|hotel|ort)|in\s+der\s+ganzen\s+stadt|stadtweit|absolut\s+beste)\b/iu;

const LANDMARK_RE =
  /\b(an\s+der\s+elbe|elbe|hafen|förde|foerde|seeufer|am\s+wasser|promenade|altstadt)\b/iu;

const NOW_RE =
  /\b(jetzt|gleich|sofort|hier\s+und\s+jetzt|gerade|heute\s+mittag)\b/iu;

const EVENING_RE =
  /\b(heute\s+abend|abendessen|dinner|tonight|um\s+(\d{1,2})\s*uhr)\b/iu;

const LATE_SNACK_RE =
  /\b(snack|snacks|nachtisch|spät\s*noch|spaet\s*noch|noch\s+was\s+essen|was\s+essen|hunger|imbiss|döner|doener|dönerladen|kebab)\b/iu;

const FOOD_KIND_RE =
  /\b(essen|restaurant|pizza|italiener|grieche|sushi|imbiss|café|cafe|frühstück|fruehstueck|mittag|abendessen|burger|fisch|pannfisch|pannenfisch|pfannfisch|pfannenfisch|snack|snacks|döner|doener|kebab|eis|spaghettieis|gelato|steak|vegan\w*|vegetarisch\w*|asiatisch\w*|angus|wagyu|zugrestaurant|speisewagen)\b/;

export function detectCityBestIntent(text: string): boolean {
  return BEST_CITY_RE.test(text.replace(/\s+/g, ' ').trim());
}

export function detectPitchKind(text: string): PitchKind {
  const t = text.toLowerCase();
  // Reise-/Wochenend-Plan vor Gastro — sonst wird „Wochenende nach Lissabon“ zum Food-Pitch
  if (
    /\b(wochenende|wochenendurlaub|städtetrip|staedtetrip|kurztrip|urlaub\s+(?:nach|in)|plane\s+mir|einplanen)\b/iu.test(
      t,
    ) &&
    !FOOD_KIND_RE.test(t) &&
    !/\b(hotel|übernacht|uebernacht|airbnb|unterkunft)\b/iu.test(t)
  ) {
    return 'generic';
  }
  // Parkplatz-Suche vor Tour/Hotel — sonst frisst „Tour zusammenstellen“ den Park-Pitch
  try {
    const { isParkingSearchIntent } = require('../../services/concierge/timeCareIntent') as {
      isParkingSearchIntent: (s: string) => boolean;
    };
    // Essen/Steak vor Parkplatz — sonst wird „essen gehen, steak, Parkplatz“ zur Lot-Suche
    if (isParkingSearchIntent(text) && !FOOD_KIND_RE.test(t)) return 'generic';
  } catch {
    /* soft */
  }
  if (/\b(hotel|übernacht|uebernacht|airbnb|pension|unterkunft)\b/.test(t)) {
    return 'hotel';
  }
  if (
    /\bbleiben\b/.test(t) &&
    /\b(nacht|heute\s+bis\s+morgen|heute\s+auf\s+morgen|von\s+heute)\b/.test(t)
  ) {
    return 'hotel';
  }
  if (/\b(kino|film|cinema)\b/.test(t)) return 'cinema';
  if (/\b(bar|pub|biergarten|cocktail)\b/.test(t)) return 'bar';
  if (
    /\b(michel|museum|kirche|dom|turm|aussichtsturm|denkmal|aussicht|sehenswürdigkeit|sehenswuerdigkeit|strand|strände|straende|beach|baden|badestelle|freibad|dinosaur|dinosaurier|dino\b|t[-\s]?rex|zoo|aquarium|planetarium|science\s*center)\b/.test(
      t,
    ) ||
    (/\b(lust|bock|möcht|moecht|will|sehen|anschauen)\b/.test(t) &&
      /\b(dinosaur|dinosaurier|dino\b|museum|zoo|aquarium|aussicht)\b/.test(t))
  ) {
    return 'sight';
  }
  if (/\b(tour|ausflug|ticket|führung|fuehrung)\b/.test(t)) return 'tour';
  try {
    const { looksLikePicnicQuery } = require('./picnicIntent') as {
      looksLikePicnicQuery: (s: string) => boolean;
    };
    if (looksLikePicnicQuery(t)) return 'sight';
  } catch {
    if (/\b(picknick|picnic|grillen|grillplatz|liegewiese)\b/.test(t)) return 'sight';
  }
  if (FOOD_KIND_RE.test(t) || looksLikeCattleBreed(t) || looksLikeTrainRestaurant(t)) {
    return 'food';
  }
  if (extractNamedRestaurantWish(text)) {
    return 'food';
  }
  // Workspace / Café-Amenities ohne explizites „essen“ → trotzdem Gastro-Pitch
  if (
    /\b(wlan|wifi|wi-?fi|steckdose|cowork|co-?working|zum\s+arbeiten|arbeitsplatz|laptop)\b/.test(
      t,
    )
  ) {
    return 'food';
  }
  return 'generic';
}

export function resolveSearchMode(opts: {
  text: string;
  hasActiveNav: boolean;
  hasTimelineNext: boolean;
  landmarkHint?: string | null;
}): PitchSearchMode {
  const t = opts.text.replace(/\s+/g, ' ').trim();
  if (detectCityBestIntent(t)) return 'city_best';
  // Explizite Stadt/Stadtteil → dort suchen, nicht am GPS
  try {
    const { extractCityFromText } = require('../context/shortTermContext') as {
      extractCityFromText: (s: string) => string | null;
    };
    if (extractCityFromText(t) && !/\b(hier|in\s+der\s+nähe|nahe\s+bei\s+mir)\b/iu.test(t)) {
      return 'city_best';
    }
  } catch {
    /* soft */
  }
  if (LANDMARK_RE.test(t) || opts.landmarkHint) return 'landmark';
  // „auf dem Weg“ nur wenn der User das EXPLIZIT will — nie auto wegen Nav
  const wantsAlongRoute =
    /\b(auf\s+dem\s+weg|unterwegs|zwischenstopp|voraus|zwischen\s+(?:hier\s+und|den\s+stops?))\b/iu.test(
      t,
    );
  if (wantsAlongRoute && (opts.hasActiveNav || opts.hasTimelineNext)) {
    return /\bzwischen\b/iu.test(t) ? 'between_stops' : 'on_route';
  }
  // Spät abends Snacks / „heute Abend noch“ → jetzt öffnen, nicht future_place
  const hour = new Date().getHours();
  if (
    hour >= 18 &&
    (LATE_SNACK_RE.test(t) ||
      /\bheute\s+abend\b/iu.test(t) ||
      /\bnoch\s+(was|etwas|snacks?|essen)\b/iu.test(t))
  ) {
    return 'here_now';
  }
  if (EVENING_RE.test(t) && !NOW_RE.test(t) && hour < 18) return 'future_place';
  if (
    /\b(morgen|übermorgen|uebermorgen)\b/iu.test(t) &&
    !/\bguten\s+morgen\b/iu.test(t) &&
    !/\bheut(?:e)?\s+morgen\b/iu.test(t)
  ) {
    return 'future_place';
  }
  return 'here_now';
}

/** visitAt aus Text — „um 18 Uhr“ / jetzt / Abend ≈ 19:00 */
export function resolveVisitAtMs(text: string, nowMs = Date.now()): number {
  const t = text.replace(/\s+/g, ' ').trim();
  let dayOffset = 0;
  if (/\bübermorgen|uebermorgen\b/iu.test(t)) dayOffset = 2;
  else if (
    /\bmorgen\b/iu.test(t) &&
    !/\bguten\s+morgen\b/iu.test(t) &&
    !/\bheut(?:e)?\s+morgen\b/iu.test(t)
  ) {
    dayOffset = 1;
  } else {
    try {
      const {
        tryResolveDateKeyFromUserText,
        todayDateKey,
        offsetDateKey,
      } = require('../../utils/dateKeys') as {
        tryResolveDateKeyFromUserText: (s: string, n?: number) => string | null;
        todayDateKey: () => string;
        offsetDateKey: (d: number, n?: number) => string;
      };
      const key = tryResolveDateKeyFromUserText(t, nowMs);
      if (key && key !== todayDateKey()) {
        if (key === offsetDateKey(2, nowMs)) dayOffset = 2;
        else if (key === offsetDateKey(1, nowMs)) dayOffset = 1;
        else {
          // Wochentag / Absolut → Uhrzeit auf diesem Kalendertag
          const [y, mo, d] = key.split('-').map(Number);
          const clock = t.match(/\bum\s+(\d{1,2})(?:[:.](\d{2}))?\s*uhr\b/iu);
          if (clock) {
            const h = Math.min(23, Math.max(0, Number(clock[1])));
            const m = clock[2] ? Math.min(59, Number(clock[2])) : 0;
            return new Date(y!, mo! - 1, d!, h, m, 0, 0).getTime();
          }
          return new Date(y!, mo! - 1, d!, 12, 0, 0, 0).getTime();
        }
      }
    } catch {
      /* soft */
    }
  }

  const clock = t.match(/\bum\s+(\d{1,2})(?:[:.](\d{2}))?\s*uhr\b/iu);
  if (clock) {
    const h = Math.min(23, Math.max(0, Number(clock[1])));
    const m = clock[2] ? Math.min(59, Number(clock[2])) : 0;
    const d = new Date(nowMs);
    if (dayOffset > 0) d.setDate(d.getDate() + dayOffset);
    d.setHours(h, m, 0, 0);
    if (dayOffset === 0 && d.getTime() < nowMs - 30 * 60_000) {
      d.setDate(d.getDate() + 1);
    }
    return d.getTime();
  }
  // „heute Abend“ abends → JETZT (offene Orte), nicht morgen 19:00
  if (EVENING_RE.test(t) && !NOW_RE.test(t)) {
    const d = new Date(nowMs);
    const hour = d.getHours();
    if (dayOffset === 0 && hour >= 18) return nowMs;
    if (dayOffset > 0) d.setDate(d.getDate() + dayOffset);
    d.setHours(19, 0, 0, 0);
    if (dayOffset === 0 && d.getTime() < nowMs) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  if (LATE_SNACK_RE.test(t) && dayOffset === 0) return nowMs;
  if (dayOffset > 0) {
    const d = new Date(nowMs);
    d.setDate(d.getDate() + dayOffset);
    if (
      /frühstück(?:en)?|fruehstueck(?:en)?|breakfast|brunch/iu.test(t) ||
      /\b(früh|frueh|morgens)\b/iu.test(t)
    ) {
      d.setHours(8, 0, 0, 0);
    } else {
      d.setHours(12, 0, 0, 0);
    }
    return d.getTime();
  }
  return nowMs;
}

export function dietLabelsFromProfile(
  profile: Record<string, unknown> | null,
): string[] {
  if (!profile) return [];
  const out: string[] = [];
  const push = (raw: string) => {
    const t = raw.toLowerCase().trim();
    if (!t) return;
    if (/vegan/.test(t)) out.push('vegan');
    else if (/vegetar|veggie/.test(t)) out.push('vegetarisch');
    else if (/kein\s*fleisch|ohne\s*fleisch|fleisch\s*nein/.test(t)) {
      out.push('vegetarisch');
    }
  };
  try {
    const { resolvePersonaEngine } = require('../../services/personaEngine') as {
      resolvePersonaEngine: (p: unknown) => {
        preferences?: { dietaryRestrictions?: string[] };
      };
    };
    for (const d of resolvePersonaEngine(profile).preferences?.dietaryRestrictions ?? []) {
      push(String(d));
    }
  } catch {
    /* structured fields below */
  }
  const tags = profile.dietaryTags;
  if (Array.isArray(tags)) {
    for (const t of tags) push(String(t));
  }
  const prefs = profile.experiencePrefs as Record<string, string> | undefined;
  if (prefs?.vegan === 'yes') push('vegan');
  if (prefs?.vegetarisch === 'yes' || prefs?.fleisch === 'no') push('vegetarisch');
  return [...new Set(out)];
}

export function buildPrefSliceForPitch(text: string): PitchPrefSlice {
  const slice: PitchPrefSlice = {};
  try {
    const { getCachedUserProfile } = require('../../services/userProfileService') as {
      getCachedUserProfile: () => Record<string, unknown> | null;
    };
    const profile = getCachedUserProfile();
    if (!profile) return slice;
    const blob = JSON.stringify(profile).toLowerCase();
    const allergies: string[] = [];
    for (const a of [
      'nuss',
      'erdnuss',
      'gluten',
      'laktose',
      'milch',
      'ei',
      'soja',
      'fisch',
      'schalen',
    ]) {
      if (
        blob.includes(a) &&
        /allerg|unverträglich|unvertraeglich|meide/.test(blob)
      ) {
        allergies.push(a);
      }
    }
    if (allergies.length) slice.allergies = allergies;
    const diet = dietLabelsFromProfile(profile);
    if (diet.length) slice.diet = diet;
    if (/\b(günstig|guenstig|budget|billig)\b/.test(blob + text.toLowerCase())) {
      slice.budgetHint = 'günstig';
    }
  } catch {
    /* soft */
  }
  return slice;
}

const MEAT_DISH_RE =
  /\b(steak|rumpsteak|ribeye|entrecôte|entrecote|schnitzel|burger|döner|doener|kebab|pannfisch|pannenfisch|pfannfisch|grillhaxe|wurst|steakhouse|angus|wagyu|kobe|fleckvieh|simmental|charolais)\b/i;

/** Einrichtung (vegan/vegetarisch) wird Must-Cuisine — außer der Satz verlangt explizit Fleisch/Fisch. */
export function mergeProfileDietIntoWishes(
  wishes: PitchWish[],
  prefs: PitchPrefSlice,
  kind: PitchKind,
  spokenText?: string,
): PitchWish[] {
  if (kind !== 'food' && kind !== 'bar') return wishes;
  const diets = (prefs.diet ?? []).map((d) => d.toLowerCase());
  const vegan = diets.some((d) => /vegan/.test(d));
  const veg = vegan || diets.some((d) => /vegetar/.test(d));
  if (!vegan && !veg) return wishes;
  if (wishes.some((w) => w.kind === 'venue' && w.hardness === 'must')) {
    return wishes;
  }
  const spoken = [
    spokenText ?? '',
    ...wishes
      .filter((w) => w.kind === 'dish' || w.kind === 'cuisine')
      .map((w) => w.text),
  ].join(' ');
  if (MEAT_DISH_RE.test(spoken) || looksLikeSpokenMeatOrFish(spoken)) {
    return wishes;
  }
  const label = vegan ? 'vegan' : 'vegetarisch';
  if (wishes.some((w) => w.kind === 'cuisine' && new RegExp(label, 'i').test(w.text))) {
    return wishes;
  }
  return [...wishes, { text: label, hardness: 'must', kind: 'cuisine' }];
}

export function parseWishesFromText(text: string): PitchWish[] {
  let t = text.replace(/\s+/g, ' ').trim();
  try {
    const { normalizeFoodStt } = require('./specializedFoodMatch') as {
      normalizeFoodStt: (s: string) => string;
    };
    t = normalizeFoodStt(t);
  } catch {
    /* soft */
  }
  const wishes: PitchWish[] = [];
  const pushMust = (w: PitchWish) => {
    if (
      wishes.some(
        (x) =>
          x.kind === w.kind &&
          x.text.toLowerCase() === w.text.toLowerCase(),
      )
    ) {
      return;
    }
    wishes.push(w);
  };

  const namedVenue = extractNamedRestaurantWish(t);
  if (namedVenue) {
    pushMust({ text: namedVenue, hardness: 'must', kind: 'venue' });
  }

  try {
    const { looksLikePicnicQuery } = require('./picnicIntent') as {
      looksLikePicnicQuery: (s: string) => boolean;
    };
    if (looksLikePicnicQuery(t)) {
      pushMust({ text: 'picknick', hardness: 'must', kind: 'amenity' });
    }
  } catch {
    /* soft */
  }

  // Interesse / Sight (Dinosaurier, Zoo, …) — Hard-Theme für Pitch
  for (const m of t.matchAll(
    /\b(dinosaurier|dinosaur(?:en)?|dinos?|t[-\s]?rex|tyrannosaurus|aquarium|planetarium|zoo|safaripark)\b/giu,
  )) {
    if (!m[1]) continue;
    let text = m[1].replace(/\s+/g, ' ').trim().toLowerCase();
    if (/^dinos?$|^dinosaur/.test(text) || /t[-\s]?rex|tyranno/.test(text)) {
      text = 'dinosaurier';
    }
    pushMust({ text, hardness: 'must', kind: 'theme' });
  }

  // Spezifische Gerichte zuerst (Hard-Match) — „kein Steak“ ist Ablehnung, kein Wunsch.
  for (const m of t.matchAll(
    /\b(spaghetti[- ]?eis|eisbecher|p(?:f)?ann(?:en)?fisch|pizza\s*hawaii|schnitzel|burger|sushi|döner|doener|kebab|kebap|ramen|pasta carbonara|steak|rumpsteak|ribeye|entrecôte|entrecote)\b/giu,
  )) {
    if (!m[1]) continue;
    const raw = m[1].replace(/\s+/g, ' ').trim();
    let text = looksLikePannfisch(raw) ? 'pannfisch' : raw;
    if (/^(doener|kebab|kebap)$/i.test(text)) text = 'döner';
    const before = t.slice(Math.max(0, (m.index ?? 0) - 28), m.index ?? 0);
    if (
      /\b(?:kein(?:e|en)?|keine[rn]?|ohne|nicht|nix)\s*$/iu.test(before) ||
      /\bmag\s+(?:eigentlich\s+)?kein/iu.test(before) ||
      /\bniemals\s*$/iu.test(before)
    ) {
      continue;
    }
    pushMust({ text, hardness: 'must', kind: 'dish' });
  }
  // Rinderrasse (Angus/Wagyu/…) — Hard dish, Soft-Fail → Steakhouse
  if (looksLikeCattleBreed(t)) {
    const breed = canonicalCattleBreed(t);
    if (breed) {
      pushMust({ text: breed, hardness: 'must', kind: 'dish' });
    }
  }
  // Zugrestaurant / Speisewagen — Amenity, nie Transit
  if (looksLikeTrainRestaurant(t)) {
    pushMust({ text: 'zugrestaurant', hardness: 'must', kind: 'amenity' });
  }
  // Generisches „X-Eis“ / Eis als Produktwunsch
  if (
    !wishes.some((w) => w.kind === 'dish') &&
    /\b([\wäöüß-]{3,20}[- ]?eis)\b/iu.test(t)
  ) {
    const m = t.match(/\b([\wäöüß-]{3,20}[- ]?eis)\b/iu);
    if (m?.[1]) pushMust({ text: m[1], hardness: 'must', kind: 'dish' });
  }
  if (
    !wishes.some((w) => w.kind === 'dish') &&
    /\b(eis|gelato|ice\s*cream)\b/iu.test(t) &&
    /\b(will|möcht|moecht|such|nehm|bitte|lust|bock)\b/iu.test(t)
  ) {
    pushMust({ text: 'Eis', hardness: 'must', kind: 'dish' });
  }

  // Plain „Pizza“ = Cuisine (nicht nur pizza hawaii)
  if (/\bpizza\b/iu.test(t) && !wishes.some((w) => /pizza/i.test(w.text))) {
    pushMust({ text: 'pizza', hardness: 'must', kind: 'cuisine' });
  }
  // Mitnehmen / Take-away = hartes Amenity (kein Beach-Bar-Essen am Tisch)
  if (
    /\b(mitnehmen|take[-\s]?away|to[-\s]?go|zum\s+mitnehmen|abholen)\b/iu.test(
      t,
    ) &&
    !wishes.some((w) => /takeaway|mitnehmen|to[-\s]?go/i.test(w.text))
  ) {
    pushMust({ text: 'takeaway', hardness: 'must', kind: 'amenity' });
  }
  const cuisineRe =
    /\b(italiener|italienisch|grieche|griechisch|japanisch|indisch|türkisch|tuerkisch|asian|asiatisch(?:es|er|e)?|thai|chinesisch|vietnamesisch|koreanisch|mexikanisch|steakhouse|vegan(?:es|er|en|e)?|vegetarisch(?:es|er|en|e)?|vegetarian)\b/giu;
  for (const m of t.matchAll(cuisineRe)) {
    if (!m[1]) continue;
    const raw = m[1].toLowerCase();
    const text = /^vegan/.test(raw)
      ? 'vegan'
      : /^vegetar/.test(raw)
        ? 'vegetarisch'
        : /^asiatisch|^asian/.test(raw)
          ? 'asiatisch'
          : m[1];
    pushMust({ text, hardness: 'must', kind: 'cuisine' });
  }

  // Alle Amenities (Pool + Sauna + Massage + …), nicht nur das erste
  for (const m of t.matchAll(
    /\b(pool|sauna|spa|jacuzzi|whirlpool|massagen?)\b/giu,
  )) {
    if (m[1]) pushMust({ text: m[1], hardness: 'must', kind: 'amenity' });
  }
  if (/\ball[\s-]*inclusive\b|\ballinclusive\b/iu.test(t)) {
    pushMust({ text: 'all-inclusive', hardness: 'must', kind: 'amenity' });
  }
  for (const m of t.matchAll(
    /\b([A-Za-zÄÖÜäöüß]{2,16}blick|river\s*view|sea\s*view|lake\s*view)\b/giu,
  )) {
    if (m[1]) {
      pushMust({
        text: m[1].replace(/\s+/g, ' ').trim(),
        hardness: 'must',
        kind: 'vibe',
      });
    }
  }
  if (/\b(biergarten|terrasse|sonnenuntergang|außen|aussen)\b/iu.test(t)) {
    const m = t.match(/\b(biergarten|terrasse|sonnenuntergang)\b/iu);
    pushMust({
      text: m?.[1] ?? 'Outdoor',
      hardness: /\bsonnenuntergang\b/iu.test(t) ? 'nice' : 'must',
      kind: 'vibe',
    });
  }
  if (/\b(wlan|wifi|wi-?fi)\b/iu.test(t)) {
    pushMust({ text: 'wlan', hardness: 'must', kind: 'amenity' });
  }
  if (/\b(steckdose|socket|strom\s+zum\s+laptop|laptop\s+laden)\b/iu.test(t)) {
    pushMust({ text: 'steckdose', hardness: 'must', kind: 'amenity' });
  }
  if (/\b(ruhig|nicht\s+laut|zum\s+arbeiten|cowork|co-?working|arbeitsplatz)\b/iu.test(
      t,
    )
  ) {
    pushMust({ text: 'ruhig', hardness: 'must', kind: 'vibe' });
  }
  // Atmosphäre / Dorfküche — nice (Boost), nie Must-Wipe
  if (
    /\b(authentisch|heimisch|heimelig|dorfküche|dorfkueche|homestyle|gemütlich|gemuetlich|nicht\s+steril|hausgemacht|traditionell|rustikal)\b/iu.test(
      t,
    ) &&
    !wishes.some((w) => w.kind === 'vibe' && /authentisch|heimisch|dorf|homestyle|gemütlich/i.test(w.text))
  ) {
    wishes.push({
      text: 'authentisch',
      hardness: 'nice',
      kind: 'vibe',
      weight: 12,
    });
  }
  if (
    /\b(toilette|klo|\bwc\b|apotheke|geldautomat|\batm\b|ladestation|powerbank)\b/iu.test(
      t,
    )
  ) {
    const m = t.match(
      /\b(toilette|klo|wc|apotheke|geldautomat|atm|ladestation|powerbank)\b/iu,
    );
    pushMust({
      text: m?.[1] ?? 'Amenity',
      hardness: 'must',
      kind: 'amenity',
    });
  }
  if (
    /frühstück(?:en)?|fruehstueck(?:en)?|breakfast|brunch/iu.test(t) &&
    !wishes.some((w) => /frühstück|fruehstueck|breakfast|brunch/i.test(w.text))
  ) {
    pushMust({ text: 'Frühstück', hardness: 'must', kind: 'cuisine' });
  }
  if (
    /frühstück(?:en)?|fruehstueck(?:en)?|breakfast|brunch/iu.test(t) &&
    /\b(typisch|hamburgerisch|hanseatisch|hamburger)\b/iu.test(t) &&
    !wishes.some((w) => /hamburgerisch|hanseatisch|franzbrötchen/i.test(w.text))
  ) {
    pushMust({
      text: 'typisch hamburgerisch',
      hardness: 'must',
      kind: 'cuisine',
    });
  }
  if (!wishes.length) {
    wishes.push({ text: t.slice(0, 80), hardness: 'nice', kind: 'generic' });
  }
  return wishes;
}

/** Parent liefert keine Warte-Floskel — Manager/contextualBridge ist die Einleitung. */
export function buildPitchParentBridge(_opts: {
  searchMode: PitchSearchMode;
  kind: PitchKind;
  cityBest: boolean;
}): string {
  return '';
}

export function countWords(s: string): number {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Clamp Bridge auf max. 22 Wörter — kein zweites Bridging-Pad (sonst Doppel-Bridge). */
export function clampBridgeWords(text: string): string {
  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  if (words.length > 22) return words.slice(0, 22).join(' ');
  return words.join(' ');
}
