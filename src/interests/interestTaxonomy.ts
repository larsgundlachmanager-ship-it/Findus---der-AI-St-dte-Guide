/**
 * Interest taxonomy — data-driven POI ↔ User matching (no hardcoded if/else).
 * New dimensions = new rows here + optional EXPERIENCE_CARDS entry.
 */

export type InterestDimension = {
  /** Maps to experiencePrefs / preferences key. */
  prefKey: string;
  /** Match against normalized POI tags (substring). */
  tagMatchers: string[];
  /** Match against normalized POI category. */
  categoryMatchers: string[];
  /** Weight for prompt ranking (higher = more important in stories). */
  promptWeight: number;
  /** POI is "specialized" — requires explicit user interest when user has ≥2 likes. */
  specialized?: boolean;
};

/** Semantic attribute conflicts — user pref vs POI attribute bag. */
export type SemanticConflictRule = {
  userPrefKey: string;
  whenUserPref: 'yes' | 'no';
  poiAttributeKey: string;
  poiAttributeValue: string | boolean | number;
};

export const INTEREST_DIMENSIONS: InterestDimension[] = [
  {
    prefKey: 'kirchen',
    tagMatchers: ['kirche', 'kapelle', 'dom', 'sakral', 'church', 'cathedral'],
    categoryMatchers: ['kirche', 'church', 'kapelle'],
    promptWeight: 1.2,
    specialized: true,
  },
  {
    prefKey: 'museen',
    tagMatchers: ['museum', 'galerie', 'ausstellung', 'gallery'],
    categoryMatchers: ['museum', 'galerie'],
    promptWeight: 1.15,
    specialized: true,
  },
  {
    prefKey: 'geschichte',
    tagMatchers: [
      'geschichte',
      'historical',
      'heritage',
      'geschicht',
      'altstadt',
      'stadtmauer',
    ],
    categoryMatchers: ['geschichte', 'altstadt'],
    promptWeight: 1.1,
  },
  {
    prefKey: 'denkmaeler',
    tagMatchers: [
      'denkmal',
      'denkmaeler',
      'denkmaeler_klein',
      'statue',
      'monument',
      'brunnen',
      'gedenkstein',
    ],
    categoryMatchers: ['denkmal'],
    promptWeight: 1.05,
    specialized: true,
  },
  {
    prefKey: 'personen',
    tagMatchers: ['person', 'promi', 'celebs', 'berühmt', 'famous', 'biografie'],
    categoryMatchers: [],
    promptWeight: 1.05,
  },
  {
    prefKey: 'nachtleben',
    tagMatchers: ['bar', 'club', 'nightlife', 'kneipe', 'pub', 'disco'],
    categoryMatchers: ['bar', 'nightlife', 'club'],
    promptWeight: 1.0,
    specialized: true,
  },
  {
    prefKey: 'geheimtipps',
    tagMatchers: ['hidden', 'geheim', 'insider', 'locals', 'lokal'],
    categoryMatchers: [],
    promptWeight: 0.95,
  },
  {
    prefKey: 'streetart',
    tagMatchers: ['streetart', 'graffiti', 'mural', 'wandkunst'],
    categoryMatchers: ['streetart'],
    promptWeight: 1.0,
    specialized: true,
  },
  {
    prefKey: 'architektur',
    tagMatchers: [
      'architektur',
      'architecture',
      'fassade',
      'backstein',
      'jugendstil',
      'bauhaus',
    ],
    categoryMatchers: ['architektur', 'architecture'],
    promptWeight: 1.1,
    specialized: true,
  },
  {
    prefKey: 'natur',
    tagMatchers: ['natur', 'park', 'ufer', 'wald', 'wiese', 'garten', 'fluss'],
    categoryMatchers: ['natur', 'park', 'garten'],
    promptWeight: 1.0,
    specialized: true,
  },
  {
    prefKey: 'aussichten',
    tagMatchers: ['aussicht', 'viewpoint', 'panorama', 'skyline', 'ausguck'],
    categoryMatchers: ['aussicht'],
    promptWeight: 1.05,
    specialized: true,
  },
  {
    prefKey: 'wandern',
    tagMatchers: ['wanderung', 'wanderweg', 'lehrpfad', 'trail', 'wandern'],
    categoryMatchers: ['wanderung'],
    promptWeight: 1.0,
    specialized: true,
  },
  {
    prefKey: 'fahrrad',
    tagMatchers: [
      'radweg',
      'fahrradweg',
      'radroute',
      'radtour',
      'fernradweg',
      'veloroute',
      'fahrrad',
    ],
    categoryMatchers: ['radweg'],
    promptWeight: 1.0,
    specialized: true,
  },
  {
    prefKey: 'theater',
    tagMatchers: [
      'theater',
      'bühne',
      'buehne',
      'kabarett',
      'schauspiel',
      'operette',
    ],
    categoryMatchers: ['theater'],
    promptWeight: 1.05,
    specialized: true,
  },
  {
    prefKey: 'kino',
    tagMatchers: ['kino', 'cinema', 'filmtheater', 'kinoprogramm'],
    categoryMatchers: ['kino', 'cinema'],
    promptWeight: 1.05,
    specialized: true,
  },
  {
    prefKey: 'konzert_musical',
    tagMatchers: [
      'konzert',
      'oper',
      'musical',
      'konzerthalle',
      'musikhalle',
      'philharmonie',
    ],
    categoryMatchers: ['konzert', 'musical'],
    promptWeight: 1.05,
    specialized: true,
  },
  {
    prefKey: 'cafes',
    tagMatchers: ['café', 'cafe', 'kaffee', 'coffee', 'rösterei', 'roesterei'],
    categoryMatchers: ['cafe', 'café', 'bakerei'],
    promptWeight: 0.95,
    specialized: true,
  },
  {
    prefKey: 'aktivitaeten',
    tagMatchers: [
      'minigolf',
      'beachvolley',
      'beachvolleyball',
      'bowling',
      'escape',
      'klettern',
      'bouldern',
      'wasserski',
      'wakeboard',
      'laser',
      'trampolin',
      'kart',
    ],
    categoryMatchers: ['freizeit', 'freizeitpark', 'activity'],
    promptWeight: 0.95,
    specialized: true,
  },
  {
    prefKey: 'freizeitparks',
    tagMatchers: [
      'freizeitpark',
      'zoo',
      'tierpark',
      'paintball',
      'bootsverleih',
      'activity',
      'erlebnis',
    ],
    categoryMatchers: ['freizeitpark', 'zoo', 'activity', 'tour', 'bootsverleih'],
    promptWeight: 0.95,
    specialized: true,
  },
  {
    prefKey: 'souvenirs',
    tagMatchers: ['souvenir', 'andenken', 'geschenkeladen', 'postkarte'],
    categoryMatchers: ['souvenir'],
    promptWeight: 0.85,
    specialized: true,
  },
  {
    prefKey: 'lokale_maerkte',
    tagMatchers: ['markt', 'bauernmarkt', 'wochenmarkt', 'flohmarkt'],
    categoryMatchers: ['markt'],
    promptWeight: 0.85,
    specialized: true,
  },
  {
    prefKey: 'sport',
    tagMatchers: [
      'sport',
      'golf',
      'fairway',
      'stadion',
      'fitness',
      'tennis',
      'tennisclub',
      'tennisplatz',
    ],
    categoryMatchers: ['sport', 'golf'],
    promptWeight: 0.9,
    specialized: true,
  },
  {
    prefKey: 'insta',
    tagMatchers: ['foto', 'photo', 'instagram', 'viewpoint', 'aussicht'],
    categoryMatchers: [],
    promptWeight: 0.85,
  },
  {
    prefKey: 'fisch',
    tagMatchers: ['fisch', 'seafood', 'fischrestaurant', 'fischimbiss'],
    categoryMatchers: ['fischrestaurant'],
    promptWeight: 0.9,
  },
  {
    prefKey: 'vegetarisch',
    tagMatchers: ['vegetarisch', 'vegan', 'pflanzlich', 'plant'],
    categoryMatchers: [],
    promptWeight: 0.9,
  },
];

export const SEMANTIC_CONFLICT_RULES: SemanticConflictRule[] = [
  {
    userPrefKey: 'vegetarisch',
    whenUserPref: 'yes',
    poiAttributeKey: 'servesMeat',
    poiAttributeValue: true,
  },
  {
    userPrefKey: 'vegan',
    whenUserPref: 'yes',
    poiAttributeKey: 'servesMeat',
    poiAttributeValue: true,
  },
  {
    userPrefKey: 'vegan',
    whenUserPref: 'yes',
    poiAttributeKey: 'servesFish',
    poiAttributeValue: true,
  },
  {
    userPrefKey: 'fisch',
    whenUserPref: 'no',
    poiAttributeKey: 'servesFish',
    poiAttributeValue: true,
  },
];

/** Prompt weight lookup by interest id. */
export function promptWeightForInterest(prefKey: string): number {
  return (
    INTEREST_DIMENSIONS.find((d) => d.prefKey === prefKey)?.promptWeight ?? 1
  );
}

/** Dimensions that match a normalized tag set + category. */
export function matchingDimensions(
  tags: string[],
  category: string,
): InterestDimension[] {
  const cat = category.trim().toLowerCase();
  return INTEREST_DIMENSIONS.filter((dim) => {
    const catHit = dim.categoryMatchers.some(
      (m) => cat === m || cat.includes(m),
    );
    const tagHit = dim.tagMatchers.some((m) =>
      tags.some((t) => t.includes(m) || m.includes(t)),
    );
    return catHit || tagHit;
  });
}
