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

/** Asia-Küche inkl. Places-Types — für „kein Asiatisch“ / AYCE-Avoid. */
const ASIAN_CUISINE_RE =
  /\b(asiatisch|asian|\basia\b|asia[\s-]?buffet|asia[\s-]?küche|asia[\s-]?kueche|sushi|sashimi|\bmaki\b|ramen|\bpho\b|wok|dim[\s-]?sum|poke|teppan(?:yaki)?|mongol(?:isch(?:er|es|e)?)?|hot[\s-]?pot|shabu|running[\s-]?sushi|sushi[\s-]?(?:boot|boat|gürtel|guertel)|thai|vietnam(?:esisch)?|chinesisch|chinese_restaurant|japanisch|japanese_restaurant|koreanisch|korean_restaurant|indisch|indian_restaurant|tandoori|curry[\s-]?haus|pan[\s-]?asian|sichuan|szechuan|cantonese|kantones)\b/iu;

export function looksLikeAsianCuisineVenue(blob: string): boolean {
  const b = String(blob || '').toLowerCase().replace(/\s+/g, ' ');
  if (!b) return false;
  return ASIAN_CUISINE_RE.test(b);
}

export function prefsAvoidAsianCuisine(avoid: string[] | null | undefined): boolean {
  return (avoid ?? []).some((a) =>
    /asia|asiatisch|asian|sushi|thai|chines|japan|vietnam|korea|indisch|ramen|poke|hot.?pot|mongol|cuisine_not_asian|avoid_cuisine_asian/i.test(
      String(a || ''),
    ),
  );
}

/** Metzgerei/Theke — kein Speiselokal, auch mit „Steak“ im Namen. */
export function looksLikeButcherNotDining(blob: string): boolean {
  const b = String(blob || '').toLowerCase();
  if (!b) return false;
  const butcher =
    /\b(fleischerei|metzgerei|metzger|butcher_shop|butcher)\b/.test(b);
  if (!butcher) return false;
  return !/\b(steakhouse|steak.?haus|grillhaus|restaurant|parrilla|churrasco|meal_takeaway|bistro)\b/.test(
    b,
  );
}

/** Sight-/Themen-Ask — nie als Gastro-Specialty lesen. */
const SIGHT_THEME_RE =
  /\b(museum|dinosaur(?:ier)?|dino\b|t[-\s]?rex|zoo|aquarium|planetarium|aussicht(?:spunkt|sturm)?|sehenswürdigkeit|sehenswuerdigkeit|kirche|dom|turm|denkmal|strand|beach|baden|picknick|picnic|grillplatz)\b/iu;

const CRAVING_RE =
  /\b((?:lust|bock)\s+auf|(?:möcht|moecht|will|hätt|haett)\w*\s+(?:gern(?:e)?\s+)?(?:einen?|eine|ein)\b|appetit\s+auf|hunger\s+auf)\b/iu;

const FOOD_ADJ_RE =
  /\b(lecker(?:e[rnms]?)?|geil(?:e[rnms]?)?|gut(?:e[rnms]?)?|beste[rn]?|richtig(?:e[rnms]?)?|perfekt(?:e[rnms]?)?)\b/iu;

const GO_OR_FIND_RE =
  /\b(wo\s+kann|wo\s+gibt|hingehen|gibt\s+es|empfehl|suche|find(?:e|en)?|probieren|bestellen)\b/iu;

const CRAVING_STOP =
  /^(heute|abend|morgen|mittag|nacht|etwas|was|mehr|mich|dich|uns|dort|hier|einen|eine|ein|den|die|das|lecker|geil|gut|besten|richtige|perfekte)$/i;

/**
 * Specialty-Gericht ohne Whitelist: „Lust auf einen leckeren Croque / Poke / …“.
 * Struktur: Craving + Item (± Adj) + oft Wo/Hingehen — nie Sight-Themen.
 */
export function looksLikeSpecialtyFoodAsk(text: string): boolean {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw || raw.length < 8) return false;
  const t = normalizeFoodStt(raw);
  const low = t.toLowerCase();
  if (SIGHT_THEME_RE.test(low) && !/\b(essen|restaurant|café|cafe|imbiss|hunger|bistro|bäck|baeck)\b/iu.test(low)) {
    return false;
  }
  if (extractCravingDishToken(t)) return true;
  const craving = CRAVING_RE.test(low) || FOOD_ADJ_RE.test(low);
  const go = GO_OR_FIND_RE.test(low);
  if (!craving || !(go || CRAVING_RE.test(low))) return false;
  try {
    const { extractEvidenceItems } = require('../evidence/evidenceNeeds') as {
      extractEvidenceItems: (s: string) => string[];
    };
    if (extractEvidenceItems(t).length > 0) return true;
  } catch {
    /* soft */
  }
  return false;
}

/** Token nach „Lust/Bock auf (Adj) X“ — stadt-/gericht-agnostisch. */
export function extractCravingDishToken(text: string): string | null {
  const t = normalizeFoodStt(String(text || '').replace(/\s+/g, ' ').trim());
  if (!t) return null;
  const low = t.toLowerCase();
  if (SIGHT_THEME_RE.test(low) && !/\b(essen|restaurant|café|cafe|imbiss)\b/iu.test(low)) {
    return null;
  }
  const m = t.match(
    /\b(?:lust|bock|appetit|hunger)\s+auf\s+(?:einen?|eine|ein|das|die|den)?\s*(?:leckere[rnms]?|geile[rnms]?|gute[rnms]?|beste[rn]?|richtige[rnms]?|perfekte[rnms]?)?\s*([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß-]{2,28})\b/iu,
  );
  const token = (m?.[1] || '').trim();
  if (!token || CRAVING_STOP.test(token)) return null;
  if (SIGHT_THEME_RE.test(token)) return null;
  return token.slice(0, 48);
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
  if (/\b(vegan|vegetarisch|vegetarier|vegetarian|veggie)\b/i.test(t)) {
    return true;
  }
  return /\b(?:kein(?:e|en)?|ohne|nicht|nix)\s+fleisch\b/i.test(t);
}

/** Belegte vegane Küche/Option — „Auch Veganer“ in Biergarten-Review reicht nicht. */
export function hasStrongVeganEvidence(blob: string): boolean {
  const b = String(blob || '').toLowerCase();
  if (
    /kein(?:e|en)?\s+vegan|nicht\s+vegan|nichts\s+vegan|ohne\s+vegan/.test(b) &&
    !/vegan(?:es|e|er|en)?\s+(gericht|essen|option|küche|kueche|speise|menu|bowl|bistro)/.test(
      b,
    )
  ) {
    return false;
  }
  if (
    /vegan(?:es|e|er|en)?\s+(gericht|essen|option|küche|kueche|speise|menu|bowl|bistro|restaurant)/.test(
      b,
    )
  ) {
    if (looksLikeBiergartenPrimaryVenue(b) || looksLikeMeatPrimaryVenue(b)) {
      return false;
    }
    return true;
  }
  if (/\b(?:rein\s+)?vegan(?:es|er|en)?\s+(?:restaurant|bistro|café|cafe|bowl)\b/.test(b)) {
    return true;
  }
  if (
    /\bvegan\b/.test(b) &&
    !/\bbiergarten\b|\bwein[\s-]*&|\bweingarten\b|\bsteakhouse\b|\bgrill(?:haus|erei)?\b/.test(
      b,
    ) &&
    /vegetarisch|veggie|pflanzlich|plant[-\s]?based|vegane\s+speisekarte/.test(b)
  ) {
    return true;
  }
  return false;
}

function looksLikeBiergartenPrimaryVenue(blob: string): boolean {
  const b = String(blob || '').toLowerCase();
  return /\bbiergarten\b|\bwein[\s-]*&\s*bier|\bweingarten\b|\bbeer[\s-]*garden\b/.test(
    b,
  );
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

  // Explizit nicht asiatisch → Asia/Sushi/Thai/… raus
  if (
    /\b(?:nicht|kein(?:e|en)?|ohne|garantiert\s+nicht)\s+(?:asiatisch\w*|asian|sushi|thai|chinesisch|japanisch)\b/iu.test(
      wish,
    ) ||
    /\bab(?:er)?\s+nicht\s+asiatisch\b/iu.test(wish) ||
    /avoid_cuisine_asian|cuisine_not_asian/.test(wish)
  ) {
    if (looksLikeAsianCuisineVenue(b)) return true;
  }

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
    if (looksLikeBiergartenPrimaryVenue(b)) return true;
    if (looksLikeMeatPrimaryVenue(b)) return true;
    if (hasStrongVeganEvidence(b)) return false;
    return false;
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
    // Metzgerei/Fleischerei ≠ Speiselokal — auch wenn „Steak“ im Namen steht
    const butcherOnly =
      blobHas(b, /\b(fleischerei|metzgerei|metzger|butcher)\b/) &&
      !blobHas(
        b,
        /\b(steakhouse|steak.?haus|grillhaus|restaurant|parrilla|churrasco|meal_takeaway|bistro)\b/,
      );
    if (butcherOnly) return 0;
    if (
      blobHas(
        b,
        /steakhouse|steak.?haus|\bsteaks?\b|prime\s*rib|ribeye|rinderfilet|rumpsteak|hüftsteak|hueftsteak|filetsteak|entrecote|entrecôte|filet.{0,16}gegrillt|gegrilltes?\s+filet/,
      ) &&
      !butcherOnly
    ) {
      return 3;
    }
    // Soft-Fail-Familie: Grill-/Steakhouse-Träger — nie Metzgerei/Döner
    if (
      blobHas(
        b,
        /steakhouse|steak.?haus|grillhaus|\bribs?\b|prime\s*rib|rumpsteak|ribeye|churrasco|asado|parrilla|steak\s*frites/,
      ) &&
      !blobHas(b, /\bd[öo]ner\b|kebab|kebap|shawarma|fleischerei|metzgerei|metzger|butcher/)
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
    if (hasStrongVeganEvidence(b)) return 3;
    if (blobHas(b, /\bvegan/) && !looksLikeBiergartenPrimaryVenue(b)) return 1;
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
