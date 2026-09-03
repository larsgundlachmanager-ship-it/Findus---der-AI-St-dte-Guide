/**
 * Stabile Gastro-Facetten aus Review-/Editorial-Text.
 * Keine Preise, keine Speisekarten, keine „heute Abend“-Signale.
 * Keep in sync with src/module2/pitch/gastroFacetTags.ts
 *
 *   node scripts/cityPack/reviewFacetTags.mjs --self-test
 */

/** @type {Array<{ tag: string, re: RegExp, negate?: RegExp }>} */
export const REVIEW_FACET_DEFS = [
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
    re: /asiatisch|\basia\b|thai|vietnam|chinesisch|korea|pho\b|ramen|indisch|curry/i,
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
  { tag: 'fisch', re: /\bfisch\b|seafood|meeresfrüchte|meeresfruechte|fischbrötchen|p(?:f)?ann(?:en)?fisch/i },
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
    re: /\bsteckdose\b|\bsocket\b|usb.?lade|power.?outlet|zum\s+arbeiten|cowork/i,
  },
  {
    tag: 'ruhig',
    re: /\bruhig\b|\bquiet\b|zum\s+arbeiten|arbeitsfreundlich|nicht\s+laut/i,
  },
  { tag: 'fleisch', re: /\bfleisch\b|rinder|steak|grillteller|braten/i },
  { tag: 'angus', re: /\b(?:black\s+)?angus\b/i },
  { tag: 'wagyu', re: /\bwagyu\b|\bkobe\b/i },
  { tag: 'fleckvieh', re: /\bfleckvieh\b|\bsimmental\b/i },
  {
    tag: 'zugrestaurant',
    re: /zugrestaurant|zug[\s-]?restaurant|bahnrestaurant|speisewagen|dining[\s-]?car|restaurantwagen|eisenbahn[\s-]?(?:restaurant|wirtshaus|gasthof)/i,
  },
  { tag: 'labskaus', re: /\blabskaus\b/i },
  // Getränke
  { tag: 'weißbier', re: /wei[ßs]bier|hefewei[ßs]en|weizenbier|hefeweizen/i },
  {
    tag: 'craftbeer',
    re: /craft.?beer|craft.?bier|hausbrauerei|mikrobrauerei|india\s+pale\s+ale|\bipa\b|pale\s+ale|brewpub|brauhaus/i,
  },
  {
    tag: 'cocktail',
    re: /\bcocktails?\b|cocktailbar|\blongdrinks?\b|caipirinha|mojito|gin.?tonic|aperol/i,
  },
  // Hotel
  {
    tag: 'parkplatz',
    re: /\bparkplatz\b|parkpl[aä]tze|kostenlos(?:e|es)?\s+park|tiefgarage|hotelparkplatz|eigene?\s+parkpl|parkm[oö]glichkeit/i,
  },
  {
    tag: 'familie',
    re: /famili(?:e|en)freundlich|f[uü]r\s+famili|family.?friendly|familienzimmer/i,
  },
  {
    tag: 'zentral',
    re: /\bzentral\b|zentrale\s+lage|zentrumsnah|mitten\s+im\s+zentrum|innenstadtlage|zentrumslage/i,
  },
  {
    tag: 'spa',
    re: /\bspa\b|wellness|\bsauna\b|dampfbad|whirlpool|thermalbad/i,
  },
  {
    tag: 'hundefreundlich',
    re: /hundefreundlich|hunde\s+(?:erlaubt|willkommen)|dog.?friendly|haustiere?\s+erlaubt/i,
  },
  // Museum
  {
    tag: 'kinderfreundlich',
    re: /kinderfreundlich|f[uü]r\s+kinder|kinderprogramm|mitmach|familienausstellung/i,
  },
  {
    tag: 'ausstellung',
    re: /ausstellung|sonderausstellung|dauerausstellung|exponat|ausgestellt/i,
  },
  // Park
  {
    tag: 'spielplatz',
    re: /\bspielplatz\b|spielpl[aä]tze|spielger[aä]t|kletterger[uü]st|sandkasten/i,
  },
  {
    tag: 'picknick',
    re: /\bpicknick\b|picknickplatz|picknickwiese|picknicken|liegewiese/i,
  },
  {
    tag: 'hundewiese',
    re: /hundewiese|hundeauslauf|hunde(?:auslauf)?freilauf|freilauffl[aä]che/i,
  },
  {
    tag: 'aussicht',
    re: /\baussicht\b|ausblick|panorama|aussichtspunkt|blick\s+[uü]ber/i,
  },
  // Aktivität
  {
    tag: 'anfaenger',
    re: /anf[aä]nger|einsteiger|beginner|schnupperkurs|f[uü]r\s+einsteiger/i,
  },
  {
    tag: 'ausruestung',
    re: /ausr[uü]stung|leihausr[uü]stung|equipment|material\s+gestellt|leihmaterial/i,
  },
  {
    tag: 'buchbar',
    re: /\bbuchbar\b|online\s+buchen|voranmeldung|kurse?\s+buchen|termin\s+buchen|reservierung\s+n[oö]tig/i,
  },
];

export function extractReviewFacetTags(text) {
  const blob = String(text || '').replace(/\s+/g, ' ').trim();
  if (blob.length < 8) return [];
  const tags = new Set();
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

function positiveDietHit(blob, tag) {
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

function selfTest() {
  const steak = extractReviewFacetTags(
    'Leckeres Steak, Filet gegrillt, super Sättigungsbeilage.',
  );
  if (!steak.includes('steak')) throw new Error('review steak tag missing');
  const veganNo = extractReviewFacetTags('Leider nichts veganes auf der Karte.');
  if (veganNo.includes('vegan')) throw new Error('negated vegan should not tag');
  const veganYes = extractReviewFacetTags('Tolle vegane Optionen und veganes Gericht.');
  if (!veganYes.includes('vegan')) throw new Error('positive vegan should tag');
  const pann = extractReviewFacetTags(
    'Spezialität: hamburger pannfisch, uriges Fischrestaurant.',
  );
  if (!pann.includes('pannfisch')) throw new Error('pannfisch tag missing');
  if (pann.includes('burger')) throw new Error('hamburger pannfisch must not tag burger');
  const angus = extractReviewFacetTags('Black Angus Steak vom Grill, super Fleisch.');
  if (!angus.includes('angus') || !angus.includes('steak')) {
    throw new Error('angus breed tags missing');
  }
  const zug = extractReviewFacetTags('Gemütliches Zugrestaurant im alten Speisewagen.');
  if (!zug.includes('zugrestaurant')) throw new Error('zugrestaurant tag missing');
  const drinks = extractReviewFacetTags(
    'Frisches Weißbier vom Fass, dazu Cocktails und Craft Beer aus der Hausbrauerei.',
  );
  for (const t of ['weißbier', 'cocktail', 'craftbeer']) {
    if (!drinks.includes(t)) throw new Error(`drinks tag ${t} missing`);
  }
  const labskaus = extractReviewFacetTags('Norddeutsche Küche mit Labskaus und Matjes.');
  if (!labskaus.includes('labskaus')) throw new Error('labskaus tag missing');
  const hotel = extractReviewFacetTags(
    'Zentrale Lage, eigener Parkplatz, Sauna und Spa, hundefreundlich, familienfreundlich.',
  );
  for (const t of ['zentral', 'parkplatz', 'spa', 'hundefreundlich', 'familie']) {
    if (!hotel.includes(t)) throw new Error(`hotel tag ${t} missing`);
  }
  const museum = extractReviewFacetTags(
    'Sonderausstellung mit Mitmach-Stationen, kinderfreundlich.',
  );
  for (const t of ['ausstellung', 'kinderfreundlich']) {
    if (!museum.includes(t)) throw new Error(`museum tag ${t} missing`);
  }
  const park = extractReviewFacetTags(
    'Großer Spielplatz, Liegewiese zum Picknicken, Hundewiese und toller Ausblick.',
  );
  for (const t of ['spielplatz', 'picknick', 'hundewiese', 'aussicht']) {
    if (!park.includes(t)) throw new Error(`park tag ${t} missing`);
  }
  const activity = extractReviewFacetTags(
    'Schnupperkurs für Einsteiger, Ausrüstung wird gestellt, online buchbar.',
  );
  for (const t of ['anfaenger', 'ausruestung', 'buchbar']) {
    if (!activity.includes(t)) throw new Error(`activity tag ${t} missing`);
  }
  console.log('reviewFacetTags.mjs self-test ok');
}

if (process.argv.includes('--self-test')) {
  selfTest();
}
