/**
 * Cuisine-/Gericht-Facetten aus Venue-Name/Tags/Reviews — nie aus dem User-Wunsch stempeln.
 * Pack + Places nutzen dieselben Marker, damit Steak/vegan/Sushi wie Hotel/Bar findbar sind.
 * Keep in sync with scripts/cityPack/reviewFacetTags.mjs
 */

type FacetDef = { tag: string; re: RegExp; negate?: RegExp };

const REVIEW_FACET_DEFS: FacetDef[] = [
  {
    tag: 'steak',
    re: /steakhouse|steak.?haus|\bsteaks?\b|rumpsteak|hüftsteak|hueftsteak|filetsteak|rinderfilet|entrecote|entrecôte|tomahawk|rib-?eye|prime\s*rib|filet.{0,16}gegrillt|gegrilltes?\s+filet/i,
  },
  { tag: 'steakhouse', re: /steakhouse|steak.?haus/i },
  { tag: 'grill', re: /\bgrill(?:haus|teller|platte)?\b|holzkohle|gegrillt/i },
  {
    tag: 'schnitzel',
    re: /\bschnitzel\b|wiener.?schnitzel|jägerschnitzel|jaegerschnitzel/i,
  },
  { tag: 'burger', re: /\bburger\b/i },
  { tag: 'pizza', re: /\bpizza\b|pizzeria/i },
  { tag: 'pasta', re: /\bpasta\b|spaghetti|tagliatelle|lasagne|risotto/i },
  { tag: 'sushi', re: /\bsushi\b|sashimi|\bmaki\b/i },
  {
    tag: 'asiatisch',
    re: /asiatisch|\basia\b|thai|vietnam|chinesisch|korea|pho\b|ramen|indisch|indian|\bindia\b|tandoori|curry/i,
  },
  {
    tag: 'indisch',
    re: /indisch|indian|\bindia\b|tandoori|curry\s*haus|masala|biryani|tikka|punjabi|thali/i,
  },
  { tag: 'italienisch', re: /italienisch|trattoria|osteria|pizzeria/i },
  {
    tag: 'vegan',
    re: /\bvegan(?:es|e|er|en)?\b/,
    negate: /kein(?:e|en)?\s+vegan|nicht\s+vegan|nichts\s+vegan|ohne\s+vegan/i,
  },
  {
    tag: 'vegetarisch',
    re: /vegetarisch|vegetarian|\bveggie\b/,
    negate: /kein(?:e|en)?\s+vegetar|nicht\s+vegetar/i,
  },
  {
    tag: 'fisch',
    re: /\bfisch\b|seafood|meeresfrüchte|meeresfruechte|fischbrötchen|p(?:f)?ann(?:en)?fisch/i,
  },
  { tag: 'pannfisch', re: /\bp(?:f)?ann(?:en)?fisch\b/i },
  { tag: 'döner', re: /\bdöner\b|\bdoener\b|\bkebab\b/i },
  { tag: 'frühstück', re: /frühstück|fruehstueck|breakfast|brunch/i },
  { tag: 'terrasse', re: /\bterrasse\b|außenbereich|aussenbereich|outdoor.?seating/i },
  { tag: 'biergarten', re: /\bbiergarten\b|beer.?garden/i },
  {
    tag: 'wlan',
    re: /\bwlan\b|\bwifi\b|wi-?fi|internet.?access|kostenloses?\s+internet|free\s+wifi/i,
  },
  {
    tag: 'steckdose',
    re: /\bsteckdose\b|\bsocket\b|usb.?lade|power.?outlet|laptop.?freundlich|zum\s+arbeiten|cowork/i,
  },
  {
    tag: 'ruhig',
    re: /\bruhig\b|\bquiet\b|zum\s+arbeiten|arbeitsfreundlich|nicht\s+laut|entspannt\s+arbeiten/i,
  },
  { tag: 'fleisch', re: /\bfleisch\b|rinder|steak|grillteller|braten/i },
  { tag: 'angus', re: /\b(?:black\s+)?angus\b/i },
  { tag: 'wagyu', re: /\bwagyu\b|\bkobe\b/i },
  { tag: 'fleckvieh', re: /\bfleckvieh\b|\bsimmental\b/i },
  {
    tag: 'zugrestaurant',
    re: /zugrestaurant|zug[\s-]?restaurant|bahnrestaurant|speisewagen|dining[\s-]?car|restaurantwagen|eisenbahn[\s-]?(?:restaurant|wirtshaus|gasthof)/i,
  },
];

function extraBlob(extra?: string | string[] | null): string {
  return Array.isArray(extra) ? extra.join(' ') : extra ?? '';
}

function positiveDietHit(blob: string, tag: string): boolean {
  if (tag === 'vegan') {
    return /vegan(?:es|e|er|en)?\s+(gericht|essen|option|küche|kueche|speise|menu)/i.test(
      blob,
    );
  }
  if (tag === 'vegetarisch') {
    return /vegetarisch(?:e|es|er|en)?\s+(gericht|essen|option|küche|kueche|speise)/i.test(
      blob,
    );
  }
  return false;
}

/** Facetten aus Name + Tags + Review-/Editorial-Text. */
export function extractReviewFacetTags(text: string): string[] {
  const blob = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (blob.length < 8) return [];
  const tags = new Set<string>();
  for (const def of REVIEW_FACET_DEFS) {
    if (!def.re.test(blob)) continue;
    if (def.negate && def.negate.test(blob) && !positiveDietHit(blob, def.tag)) {
      continue;
    }
    tags.add(def.tag);
  }
  if (tags.has('steak')) tags.add('fleisch');
  if (tags.has('angus') || tags.has('wagyu') || tags.has('fleckvieh')) {
    tags.add('fleisch');
    tags.add('steak');
  }
  return [...tags];
}

export function inferGastroFacetTags(
  name: string,
  extra?: string | string[] | null,
): string[] {
  return extractReviewFacetTags(`${name} ${extraBlob(extra)}`);
}
