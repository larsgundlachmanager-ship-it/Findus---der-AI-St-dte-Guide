/**
 * SSOT: Google-/Pack-Kategorien → place_tier / pack_role / Interest-Keys.
 * Nutzung: skeleton, directory-expand, classifyPackCategories, neue Städte.
 */

/** Story Tier 2+ (proaktiv wenn Interesse / Touri) — nie Tourist-Info. */
export const STORY_CATEGORY_TIERS = {
  museum: 2,
  galerie: 2,
  denkmal: 2,
  geschichte: 2,
  kirche: 2,
  aussicht: 2,
  natur: 2,
  park: 2,
  garten: 2,
  altstadt: 1,
  wanderung: 2,
  radweg: 2,
  theater: 2,
  konzert: 2,
  kino: 2,
  zoo: 2,
  freizeitpark: 2,
  activity: 2,
  bootsverleih: 2,
  tour: 2,
  souvenir: 2,
  hafen: 2,
};

/**
 * Nie proaktiv triggern — nur Offline-Katalog.
 * Gastro/Markt: früher Tier-3-Story → blähte Packs auf; Modul-2/Offline + Interesse reichen.
 * Explizite Must-Sees bleiben über Tags master_report / must_have / place_tier 1 geschützt.
 */
export const DIRECTORY_ONLY_CATEGORIES = new Set([
  'supermarket',
  'apotheke',
  'gesundheit',
  'hotel',
  'tankstelle',
  'service',
  'toilette',
  'gepaeck',
  'transit',
  'bahnhof',
  'tourist_info',
  'verwaltung', // außer Rathaus/Altstadt-Anker bewusst als story gesetzt
  'spielplatz',
  'golf',
  'sport',
  'wasser',
  'einkaufen',
  'directory',
  'markt',
  'cafe',
  'restaurant',
  'bakerei',
  'bakery',
  'freizeit', // Bäder etc. — außer explizit gemastert
  'transport',
]);

export const INTEREST_BY_CATEGORY = {
  museum: 'museen',
  galerie: 'museen',
  denkmal: 'denkmaeler',
  geschichte: 'geschichte',
  kirche: 'kirchen',
  aussicht: 'aussichten',
  natur: 'natur',
  park: 'natur',
  garten: 'natur',
  wanderung: 'wandern',
  radweg: 'fahrrad',
  theater: 'theater_kultur',
  konzert: 'theater_kultur',
  kino: 'theater_kultur',
  zoo: 'freizeitparks',
  freizeitpark: 'freizeitparks',
  activity: 'freizeitparks',
  bootsverleih: 'freizeitparks',
  tour: 'freizeitparks',
  souvenir: 'souvenirs',
  markt: 'lokale_maerkte',
  cafe: 'kulinarik',
  restaurant: 'kulinarik',
  altstadt: 'geschichte',
  hafen: 'geschichte',
};

/**
 * Extra Places-Textsuche für Story-Abdeckung (alle Städte).
 * Lieber zu viele Treffer als zu wenige — große Städte brauchen Breite.
 * classify/skeleton paginieren und nehmen bis ~20 Treffer pro Query.
 */
export const STORY_DISCOVERY_QUERIES = [
  { q: 'Altstadt OR historischer Stadtkern', categoryHint: 'altstadt', tier: 1 },
  { q: 'Sehenswürdigkeit OR Tourist attraction', categoryHint: 'denkmal', tier: 2 },
  { q: 'Denkmal OR Monument OR Statue OR Brunnen', categoryHint: 'denkmal', tier: 2 },
  { q: 'Museum OR Galerie OR Kunsthalle', categoryHint: 'museum', tier: 2 },
  { q: 'Kirche OR Dom OR Kloster OR Kapelle', categoryHint: 'kirche', tier: 2 },
  { q: 'Rathaus OR Rathausplatz OR Marktplatz', categoryHint: 'geschichte', tier: 1 },
  { q: 'Schloss OR Burg OR Festung OR Tor', categoryHint: 'denkmal', tier: 2 },
  { q: 'Aussichtspunkt OR Viewpoint OR Panorama OR Leuchtturm', categoryHint: 'aussicht', tier: 2 },
  { q: 'Park OR Botanischer Garten OR Stadtgarten OR Wallanlagen', categoryHint: 'natur', tier: 2 },
  { q: 'Wanderweg OR Wandergebiet OR Lehrpfad OR Uferweg', categoryHint: 'wanderung', tier: 2 },
  { q: 'Radweg OR Fahrradweg OR Radroute OR Fernradweg OR Veloroute', categoryHint: 'radweg', tier: 2 },
  { q: 'Theater OR Konzerthalle OR Oper OR Figurentheater', categoryHint: 'theater', tier: 2 },
  { q: 'Hafen OR Museumshafen OR Marina OR Anleger', categoryHint: 'hafen', tier: 2 },
  { q: 'Zoo OR Tierpark OR Freizeitpark', categoryHint: 'freizeitpark', tier: 2 },
  { q: 'Bootsverleih OR Stadtrundfahrt OR Tourenanbieter', categoryHint: 'tour', tier: 2 },
  { q: 'Souvenir OR Andenken OR Geschenkeladen OR Marzipan', categoryHint: 'souvenir', tier: 2 },
  { q: 'Wochenmarkt OR Bauernmarkt', categoryHint: 'markt', tier: 3 },
  { q: 'Öffentliche Toilette OR WC', categoryHint: 'toilette', tier: 4 },
  { q: 'Gepäckaufbewahrung OR Luggage storage', categoryHint: 'gepaeck', tier: 4 },
];

/** Orientierungs-Mindestzahlen Story (nicht hart prune — eher Warnung/Rückfrage). */
export const STORY_COUNT_GUIDANCE = {
  village: { minStory: 12, radiusM: 3500 },
  town: { minStory: 25, radiusM: 6000 },
  city: { minStory: 45, radiusM: 10000 },
  metro: { minStory: 80, radiusM: 15000 },
};

export function citySizeHint(packOrName) {
  const name = String(
    packOrName?.name || packOrName?.city_id || packOrName || '',
  ).toLowerCase();
  if (
    /hamburg|berlin|münchen|muenchen|köln|koeln|frankfurt|stuttgart|düsseldorf|duesseldorf|dortmund|essen|leipzig|dresden|bremen|hannover|nürnberg|nuernberg/i.test(
      name,
    )
  ) {
    return 'metro';
  }
  if (
    /lübeck|luebeck|kiel|flensburg|rostock|schwerin|lüneburg|lueneburg|pinneberg|hechingen|tettnang/i.test(
      name,
    )
  ) {
    return 'city';
  }
  if (/wangerooge|prisdorf|tornesch/i.test(name)) return 'town';
  const n = Number(packOrName?._pack_index?.total || 0);
  if (n >= 250) return 'metro';
  if (n >= 120) return 'city';
  if (n >= 40) return 'town';
  return 'village';
}

export function suggestedDiscoveryRadius(packOrName) {
  const size = citySizeHint(packOrName);
  return STORY_COUNT_GUIDANCE[size]?.radiusM || 6000;
}

export function suggestedMinStory(packOrName) {
  const size = citySizeHint(packOrName);
  return STORY_COUNT_GUIDANCE[size]?.minStory || 20;
}

export function defaultRoleAndTier(category, { forceStory = false } = {}) {
  const cat = String(category || 'ort').toLowerCase();
  if (DIRECTORY_ONLY_CATEGORIES.has(cat) && !forceStory) {
    return { pack_role: 'directory', place_tier: 4 };
  }
  if (cat in STORY_CATEGORY_TIERS) {
    const tier = STORY_CATEGORY_TIERS[cat];
    if (tier >= 4) return { pack_role: 'directory', place_tier: 4 };
    return { pack_role: 'story', place_tier: tier };
  }
  return { pack_role: 'directory', place_tier: 4 };
}

export function interestTagsForCategory(category) {
  const cat = String(category || '').toLowerCase();
  const pref = INTEREST_BY_CATEGORY[cat];
  const tags = [cat];
  if (pref) tags.push(`interest:${pref}`, pref);
  if (cat === 'souvenir') tags.push('touristic', 'typisch_touri');
  if (['museum', 'denkmal', 'altstadt', 'geschichte', 'kirche'].includes(cat)) {
    tags.push('touristic');
  }
  return tags;
}

export function stubNarration(name, category, cityName) {
  const cat = category || 'Ort';
  return `${name} ist ein ${cat}-Punkt in ${cityName || 'der Stadt'} — Orientierung und Offline-Lookup. LIVE: Öffnungszeiten und aktuelle Angebote frisch prüfen.`;
}
