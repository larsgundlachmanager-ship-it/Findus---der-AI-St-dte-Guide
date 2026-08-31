/**
 * Spezialisierte Gastro-Wünsche (Steak, vegan, asiatisch, Rinderrasse, Zugrestaurant, …) —
 * Must-Have wie Hotel-Amenities: Beleg in Name/Tags/Reviews, keine Fremdorte.
 */

import type { PitchWish } from './types';

/** STT/Tipp: Pannfisch, Pannenfisch, Pfannfisch, Pfannenfisch. */
export const PANNFISCH_RE = /\bp(?:f)?ann(?:en)?fisch\b/iu;

/** Rinderrasse / Specialty-Beef — Hard-Match, Soft-Fail → Steakhouse-Familie. */
export const CATTLE_BREED_RE =
  /\b((?:black\s+)?angus|agno|angos|wagyu|kobe|simmental|fleckvieh|charolais|hereford|limousin|chianina|galizisch(?:es|er|e)?\s+rind|galician\s+blond)\b/iu;

/** STT-Toleranz: Agno/Angos → Angus usw. */
export function normalizeFoodStt(text: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\b(agno|angos)\b/giu, 'angus')
    .replace(/\bdoener\b/giu, 'döner')
    .replace(/\bkebap\b/giu, 'kebab')
    .trim();
}

/** Zugrestaurant / Speisewagen — Gastro, kein Transit. */
export const TRAIN_RESTAURANT_RE =
  /\b(zugrestaurant|zug[\s-]?restaurant|bahnrestaurant|bahn[\s-]?restaurant|speisewagen|dining[\s-]?car|restaurantwagen|eisenbahn[\s-]?(?:restaurant|wirtshaus|gasthof)|restaurant\s+im\s+zug)\b/iu;

export function looksLikePannfisch(text: string): boolean {
  return PANNFISCH_RE.test(String(text || ''));
}

export function looksLikeCattleBreed(text: string): boolean {
  return CATTLE_BREED_RE.test(normalizeFoodStt(text));
}

export function looksLikeTrainRestaurant(text: string): boolean {
  return TRAIN_RESTAURANT_RE.test(String(text || ''));
}

/** Canonical dish token for breed wishes (angus, wagyu, fleckvieh, …). */
export function canonicalCattleBreed(text: string): string | null {
  const t = normalizeFoodStt(text);
  if (!t) return null;
  const m = t.match(CATTLE_BREED_RE);
  if (!m?.[1]) return null;
  const raw = m[1].toLowerCase().replace(/\s+/g, ' ');
  if (/black\s+angus|^angus$|^agno$|^angos$/.test(raw)) return 'angus';
  if (/wagyu|kobe/.test(raw)) return raw.includes('kobe') ? 'kobe' : 'wagyu';
  if (/simmental|fleckvieh/.test(raw)) return 'fleckvieh';
  if (/charolais/.test(raw)) return 'charolais';
  if (/hereford/.test(raw)) return 'hereford';
  if (/limousin/.test(raw)) return 'limousin';
  if (/chianina/.test(raw)) return 'chianina';
  if (/galiz|galician/.test(raw)) return 'galizisches rind';
  return raw;
}

/** Gesprochener Fleisch-/Fischwunsch — Profil-vegan darf das nicht überschreiben. */
export function looksLikeSpokenMeatOrFish(text: string): boolean {
  const t = normalizeFoodStt(text).toLowerCase();
  if (looksLikePannfisch(t)) return true;
  if (looksLikeCattleBreed(t)) return true;
  return /\b(steak|rumpsteak|ribeye|entrecôte|entrecote|schnitzel|burger|döner|doener|kebab|grillhaxe|wurst|steakhouse|fisch|seafood|meeresfrüchte|meeresfruechte|labskaus|fischbrötchen|fischbroetchen)\b/i.test(
    t,
  );
}

/** Gesprochener Vegan-/Vegetarisch-Wunsch — Steakhouse ist kein Soft-Fail-Fallback. */
export function looksLikeSpokenVeganOrVeg(text: string): boolean {
  const t = String(text || '').toLowerCase();
  return /\b(vegan|vegetarisch|vegetarier|vegetarian|veggie)\b/i.test(t);
}

/** Fleisch-primäre Venue-Signale (Steakhouse / Grill / Fleisch) ohne Vegan-Beleg. */
function looksLikeMeatPrimaryVenue(blob: string): boolean {
  const b = String(blob || '').toLowerCase();
  return /steakhouse|steak[\s.-]?haus|\bsteaks?\b|\bfleisch\b|\bgrill(?:haus|erei)?\b|burger[\s-]?house|burgerhaus|\bribs?\b|prime\s*rib|rumpsteak|ribeye|entrecôte|entrecote/.test(
    b,
  );
}

/**
 * Gegen-Diät: Fleisch-Wunsch ≠ vegan-primär; Vegan/Veg-Wunsch ≠ Steakhouse/Fleisch/Grill-primär.
 * Beleg für die Wunsch-Diät im Venue-Blob hebt den Opposite-Hit auf.
 */
export function isOppositeDietVenue(venueBlob: string, wishBlob: string): boolean {
  const b = String(venueBlob || '').toLowerCase();
  const wish = String(wishBlob || '');

  if (looksLikeSpokenMeatOrFish(wish)) {
    if (/kein(?:e|en)?\s+vegan|nicht\s+vegan|nichts\s+vegan|ohne\s+vegan/.test(b)) {
      return false;
    }
    if (looksLikePannfisch(b) || /\b(fisch|seafood|meeresfrüchte|meeresfruechte|steak|fleisch|grill)\b/.test(b)) {
      return false;
    }
    return /\bvegan/.test(b);
  }

  if (looksLikeSpokenVeganOrVeg(wish)) {
    const hasVeganEvidence =
      /\bvegan|\bvegetar|\bveggie\b/.test(b) &&
      !(/kein(?:e|en)?\s+vegan|nicht\s+vegan|nichts\s+vegan|ohne\s+vegan/.test(b) &&
        !/vegan(?:es|e|er|en)?\s+(gericht|essen|option|küche|kueche|speise)/.test(b));
    if (hasVeganEvidence) return false;
    return looksLikeMeatPrimaryVenue(b);
  }

  return false;
}

export function specializedFoodNeedles(wishText: string): string[] {
  const t = wishText.toLowerCase().replace(/\s+/g, ' ').trim();
  const out = new Set<string>([t]);
  if (looksLikePannfisch(t)) {
    out.add('pannfisch');
    out.add('pannenfisch');
    out.add('hamburger pannfisch');
  }
  const breed = canonicalCattleBreed(t);
  if (breed) {
    out.add(breed);
    if (breed === 'angus') {
      out.add('black angus');
      out.add('angus steak');
      out.add('angus beef');
    }
    if (breed === 'wagyu' || breed === 'kobe') {
      out.add('wagyu');
      out.add('kobe');
      out.add('wagyu steak');
    }
    if (breed === 'fleckvieh') {
      out.add('simmental');
      out.add('fleckvieh');
    }
    out.add('steak');
    out.add('steakhouse');
  }
  if (looksLikeTrainRestaurant(t) || /zugrestaurant|speisewagen|dining/.test(t)) {
    out.add('zugrestaurant');
    out.add('speisewagen');
    out.add('dining car');
    out.add('bahnrestaurant');
    out.add('restaurantwagen');
    out.add('eisenbahn');
  }
  if (/steak/.test(t)) {
    out.add('steak');
    out.add('steakhouse');
    out.add('steak haus');
    out.add('ribeye');
    out.add('rumpsteak');
    out.add('rinderfilet');
    out.add('hüftsteak');
  }
  if (/\bd[öo]ner\b|kebab|kebap/.test(t)) {
    out.add('döner');
    out.add('doener');
    out.add('kebab');
    out.add('kebap');
  }
  if (/vegan/.test(t)) out.add('vegan');
  if (/vegetar/.test(t)) {
    out.add('vegetarisch');
    out.add('vegetarian');
    out.add('veggie');
  }
  if (/asia|asiatisch/.test(t)) {
    out.add('asia');
    out.add('asiatisch');
    out.add('thai');
    out.add('vietnam');
    out.add('chinesisch');
    out.add('japan');
    out.add('sushi');
  }
  if (/indisch|indian|\bindia\b/.test(t)) {
    out.add('indisch');
    out.add('indian');
    out.add('tandoori');
    out.add('curry');
    out.add('masala');
    out.add('biryani');
  }
  if (/sushi/.test(t)) {
    out.add('sushi');
    out.add('sashimi');
    out.add('maki');
  }
  return [...out].filter((x) => x.length >= 3);
}

function blobHas(blob: string, re: RegExp): boolean {
  return re.test(blob);
}

/**
 * 3 = hartes Namens-/Tag-/Review-Signal, 1 = Gastro-Kategorie (Beleg kommt in hardMatchVerify),
 * 0 = kein Treffer, -1 = Wunsch nicht spezialisiert.
 */
export function scoreSpecializedFoodWish(blob: string, wish: PitchWish): number {
  const wt = wish.text.toLowerCase();
  const b = blob.toLowerCase();

  const breed = canonicalCattleBreed(wt);
  if (breed) {
    const breedHit =
      (breed === 'angus' && blobHas(b, /\b(?:black\s+)?angus\b/)) ||
      (breed === 'wagyu' && blobHas(b, /\bwagyu\b/)) ||
      (breed === 'kobe' && blobHas(b, /\bkobe\b/)) ||
      (breed === 'fleckvieh' && blobHas(b, /\b(fleckvieh|simmental)\b/)) ||
      (breed === 'charolais' && blobHas(b, /\bcharolais\b/)) ||
      (breed === 'hereford' && blobHas(b, /\bhereford\b/)) ||
      (breed === 'limousin' && blobHas(b, /\blimousin\b/)) ||
      (breed === 'chianina' && blobHas(b, /\bchianina\b/)) ||
      (breed === 'galizisches rind' &&
        blobHas(b, /\b(galizisch|galician\s+blond|rubia\s+gallega)\b/)) ||
      blobHas(b, new RegExp(`\\b${breed.replace(/\s+/g, '\\s+')}\\b`, 'i'));
    if (breedHit) return 3;
    // Soft-Fail-Leiter: Steakhouse-Familie, nie vegan
    if (
      blobHas(
        b,
        /steakhouse|steak.?haus|\bsteaks?\b|prime\s*rib|ribeye|rinderfilet|rumpsteak|hüftsteak|hueftsteak|filetsteak|entrecote|entrecôte/,
      )
    ) {
      return 1;
    }
    return 0;
  }

  if (looksLikeTrainRestaurant(wt) || wt === 'zugrestaurant' || /speisewagen|dining\s*car/.test(wt)) {
    if (
      blobHas(
        b,
        /zugrestaurant|zug[\s-]?restaurant|bahnrestaurant|speisewagen|dining[\s-]?car|restaurantwagen|eisenbahn|schienen(?:fahrzeug|gastronomie)|lokomotive|wagen\s*\d+|bordbistro|bordrestaurant/,
      )
    ) {
      return 3;
    }
    // Kein Fake-Bahnhof-Imbiss als Soft-Fail
    return 0;
  }

  if (/steak/.test(wt)) {
    if (
      blobHas(
        b,
        /steakhouse|steak.?haus|\bsteaks?\b|prime\s*rib|ribeye|rinderfilet|rumpsteak|hüftsteak|hueftsteak|filetsteak|entrecote|entrecôte|filet.{0,16}gegrillt|gegrilltes?\s+filet/,
      )
    ) {
      return 3;
    }
    // Soft-Fail-Familie: nur Fleisch/Grill-Träger — nie generisches Restaurant/Bistro/Döner
    if (
      blobHas(
        b,
        /steakhouse|steak.?haus|grillhaus|fleischerei|\bribs?\b|prime\s*rib|rumpsteak|ribeye|churrasco|asado|parrilla|steak\s*frites/,
      ) &&
      !blobHas(b, /\bd[öo]ner\b|kebab|kebap|shawarma/)
    ) {
      return 1;
    }
    return 0;
  }

  if (/\bd[öo]ner\b|kebab|kebap/.test(wt)) {
    if (blobHas(b, /\bd[öo]ner\b|kebab|kebap|shawarma|dürüm|dueruem/)) {
      return 3;
    }
    // Familie: türkischer Imbiss — nie Steakhouse / feines Restaurant
    if (
      blobHas(b, /imbiss|kebap|döner|doener|falafel|lahmacun|pide|türkisch|tuerkisch/) &&
      !blobHas(b, /steakhouse|steak.?haus/)
    ) {
      return 1;
    }
    return 0;
  }

  if (/vegan/.test(wt)) {
    if (
      /kein(?:e|en)?\s+vegan|nicht\s+vegan|nichts\s+vegan|ohne\s+vegan/.test(b) &&
      !/vegan(?:es|e|er|en)?\s+(gericht|essen|option|küche|kueche|speise)/.test(b)
    ) {
      return 0;
    }
    if (blobHas(b, /\bvegan/)) return 3;
    return 0;
  }

  if (/vegetar/.test(wt)) {
    if (
      /kein(?:e|en)?\s+vegetar|nicht\s+vegetar/.test(b) &&
      !/vegetarisch(?:e|es|er|en)?\s+(gericht|essen|option)/.test(b)
    ) {
      return 0;
    }
    if (blobHas(b, /vegetar|vegetarian|\bveggie\b/)) return 3;
    if (blobHas(b, /\bvegan/)) return 2;
    return 0;
  }

  if (/asia|asiatisch/.test(wt)) {
    if (
      blobHas(
        b,
        /asia|asiatisch|thai|vietnam|china|chinesisch|japan|sushi|pho|ramen|korean|indisch|indian/,
      )
    ) {
      return 3;
    }
    return 0;
  }

  if (/indisch|indian|\bindia\b/.test(wt)) {
    if (
      blobHas(
        b,
        /indisch|indian|\bindia\b|tandoori|curry\s*haus|curryhouse|masala|biryani|naan|tikka|punjabi|thali|madras|bollywood/,
      )
    ) {
      return 3;
    }
    // Familie: asiatisch/curry — Soft, kein Wipe
    if (blobHas(b, /asia|asiatisch|\bcurry\b/)) return 1;
    return 0;
  }

  if (/sushi/.test(wt)) {
    if (blobHas(b, /sushi|sashimi|maki|japan/)) return 3;
    return 0;
  }

  if (looksLikePannfisch(wt) || (/pann/.test(wt) && /fisch/.test(wt))) {
    if (blobHas(b, PANNFISCH_RE) || blobHas(b, /hamburger\s+pann/)) return 3;
    if (
      blobHas(
        b,
        /\b(fischrestaurant|fischlokal|fischstube|seafood|meeresfrüchte|meeresfruechte|fisch\s*&\s*co)\b|\bfisch\b/,
      )
    ) {
      return 1;
    }
    return 0;
  }

  return -1;
}

/** Pack reicht für „essen gehen“; Spezialwunsch braucht Live-Places + Reviews. */
export function queryNeedsLiveFoodResearch(query: string): boolean {
  const t = String(query || '').toLowerCase();
  if (looksLikePannfisch(t)) return true;
  try {
    const { extractNamedRestaurantWish } = require('./namedVenueIntent') as {
      extractNamedRestaurantWish: (s: string) => string | null;
    };
    if (extractNamedRestaurantWish(query)) return true;
  } catch {
    /* soft */
  }
  if (looksLikeCattleBreed(t) || looksLikeTrainRestaurant(t)) return true;
  return /steak|vegan|vegetar|sushi|asiatisch|\basia\b|indisch|indian|labskaus|fischbrötchen|fischbroetchen|elbblick|wasserblick|terrasse|biergarten|schnitzel|döner|doener|kebab|\bpizza\b|\bburger\b|\bpasta\b/.test(
    t,
  );
}
