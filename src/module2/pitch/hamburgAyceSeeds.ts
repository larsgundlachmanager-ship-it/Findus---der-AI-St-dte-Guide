/**
 * Hamburg AYCE Soft-Seeds — Pitch-Pool-Overlay, kein Stadt-Pack / GPS-Feinschliff.
 *
 * Architektur (bewusst):
 * - Statische Soft-Seeds + optionaler Places-Resolve im Pitch
 * - DiscoveryHarvest / Places liefern Live-Belege
 * - NICHT: city:auto, gps-wegweiser, upload:city, OSM-Footprints für diese Orte
 *
 * Koordinaten sind grobe Anker (Stadtviertel), keine Pack-Pin-Qualität.
 */

export type AyceWeekday =
  | 'montag'
  | 'dienstag'
  | 'mittwoch'
  | 'donnerstag'
  | 'freitag'
  | 'samstag'
  | 'sonntag'
  | 'daily';

export type HamburgAyceSeed = {
  placeId: string;
  name: string;
  /** Grober Anker — kein Pack-GPS */
  lat: number;
  lng: number;
  softTags: string[];
  evidence: string[];
  asian: boolean;
  /** Tage mit belegtem AYCE-/Special-Fenster (soft) */
  weekdays: AyceWeekday[];
  areaHint?: string;
  websiteUrl?: string | null;
};

/** Belegte Soft-Seeds (Presse/Site) — Qualität vor Nähe, non-Asia first filterbar. */
export const HAMBURG_AYCE_SEEDS: HamburgAyceSeed[] = [
  {
    placeId: 'hh_ayce_panthera_neustadt',
    name: 'Panthera Rodizio',
    lat: 53.5456,
    lng: 9.9845,
    softTags: [
      'ayce',
      'all_you_can_eat',
      'rodizio',
      'brasilianisch',
      'grill',
      'fleisch',
      'non_asia',
      'ayce_schedule:daily',
      'ayce_price:~38',
    ],
    evidence: [
      'Brasilianisches Rodizio All-you-can-eat (Fleisch am Spieß + Buffet)',
      'Nicht asiatisch · Freitag ab ~16 Uhr offen (live prüfen)',
    ],
    asian: false,
    weekdays: ['daily', 'freitag', 'samstag', 'sonntag'],
    areaHint: 'Portugiesenviertel / Neustadt',
    websiteUrl: 'https://www.panthera-rodizio.de/',
  },
  {
    placeId: 'hh_ayce_panthera_harburg',
    name: 'Panthera Rodizio Harburg',
    lat: 53.4605,
    lng: 9.9835,
    softTags: [
      'ayce',
      'all_you_can_eat',
      'rodizio',
      'brasilianisch',
      'grill',
      'non_asia',
      'ayce_schedule:daily',
    ],
    evidence: [
      'Rodizio-Ableger Harburg — All-you-can-eat Grill',
      'Nicht asiatisch',
    ],
    asian: false,
    weekdays: ['daily', 'freitag', 'samstag', 'sonntag'],
    areaHint: 'Harburg',
    websiteUrl: 'https://www.panthera-rodizio.de/',
  },
  {
    placeId: 'hh_ayce_down_under',
    name: 'Down Under Hamburg',
    lat: 53.5685,
    lng: 9.9785,
    softTags: [
      'ayce',
      'all_you_can_eat',
      'australian',
      'pub',
      'wings',
      'ribs',
      'non_asia',
      'ayce_schedule:dienstag',
      'ayce_schedule:sonntag',
      'ayce_schedule:donnerstag',
      'fireabend',
    ],
    evidence: [
      'Australischer Pub — Wings/Ribs AYCE Di+So (Presse); Do Spare-Ribs AYCE',
      'Freitag oft Fireabend/Pub-Abend — AYCE live prüfen, nicht asiatisch',
    ],
    asian: false,
    weekdays: ['dienstag', 'donnerstag', 'sonntag', 'freitag'],
    areaHint: 'Rotherbaum / Grindel',
    websiteUrl: 'https://www.down-under-hamburg.de/',
  },
  {
    placeId: 'hh_ayce_mezedes',
    name: 'Mezedes',
    lat: 53.5502,
    lng: 9.9788,
    softTags: [
      'ayce',
      'all_you_can_eat',
      'greek',
      'tapas',
      'non_asia',
      'ayce_schedule:daily',
    ],
    evidence: [
      'Griechische Tapas All-you-can-eat (Mezedes)',
      'Nicht asiatisch',
    ],
    asian: false,
    weekdays: ['daily'],
    areaHint: 'Neustadt / Großneumarkt',
  },
  {
    placeId: 'hh_ayce_kofookoo',
    name: 'Kofookoo Yam’cha',
    lat: 53.5605,
    lng: 9.9655,
    softTags: [
      'ayce',
      'all_you_can_eat',
      'sushi',
      'asia',
      'yamcha',
      'ayce_schedule:daily',
    ],
    evidence: ['Asiatisches AYCE / Yam’cha-Runden — nur wenn Asia ok'],
    asian: true,
    weekdays: ['daily'],
    areaHint: 'St. Pauli / Rindermarkthalle',
  },
  {
    placeId: 'hh_ayce_jamjam',
    name: 'Jam Jam Running Sushi',
    lat: 53.573,
    lng: 10.068,
    softTags: [
      'ayce',
      'all_you_can_eat',
      'sushi',
      'asia',
      'running_sushi',
      'ayce_schedule:daily',
    ],
    evidence: ['Running Sushi Buffet — nur wenn Asia ok'],
    asian: true,
    weekdays: ['daily'],
    areaHint: 'Wandsbek',
  },
  {
    placeId: 'hh_ayce_copper_house',
    name: 'Copper House',
    lat: 53.5495,
    lng: 9.9625,
    softTags: [
      'ayce',
      'all_you_can_eat',
      'asia',
      'teppanyaki',
      'ayce_schedule:daily',
    ],
    evidence: ['Asiatisches Buffet + Live-Cooking — nur wenn Asia ok'],
    asian: true,
    weekdays: ['daily'],
    areaHint: 'St. Pauli',
  },
];

const WEEKDAY_RE: Array<{ re: RegExp; day: AyceWeekday }> = [
  { re: /\bmontags?|mo\b/, day: 'montag' },
  { re: /\bdienstags?|di\b/, day: 'dienstag' },
  { re: /\bmittwochs?|mi\b/, day: 'mittwoch' },
  { re: /\bdonnerstags?|do\b/, day: 'donnerstag' },
  { re: /\bfreitags?|fr\b|freitag/, day: 'freitag' },
  { re: /\bsamstags?|sa\b/, day: 'samstag' },
  { re: /\bsonntags?|so\b/, day: 'sonntag' },
];

export function detectAyceWeekdayFromQuery(query: string): AyceWeekday | null {
  const q = query.toLowerCase();
  for (const { re, day } of WEEKDAY_RE) {
    if (re.test(q)) return day;
  }
  return null;
}

function matchesWeekday(seed: HamburgAyceSeed, day: AyceWeekday | null): boolean {
  if (!day) return true;
  if (seed.weekdays.includes('daily')) return true;
  return seed.weekdays.includes(day);
}

/**
 * Soft-Seeds für Pitch-Pool — nur Hamburg + AYCE-Intent.
 * avoidAsia filtert asiatische Soft-Seeds raus (Hard-Filter bleibt Harvest/Places).
 */
export function hamburgAyceSeedsForQuery(opts: {
  cityHint?: string | null;
  query?: string | null;
  avoidAsia?: boolean;
  weekday?: AyceWeekday | null;
}): HamburgAyceSeed[] {
  const city = `${opts.cityHint || ''}`.toLowerCase();
  const q = `${opts.query || ''}`.toLowerCase();
  const inHamburg =
    /hamburg|hh\b|altona|st\.?\s*pauli|hafencity|harburg|roth?erbaum|neustadt|wandsbek/.test(
      city,
    ) || /hamburg/.test(q);
  if (!inHamburg) return [];

  const ayce =
    /all\s*you\s*can\s*eat|ayce|unbegrenzt|flatrate|schlemmer|rodizio|buffet/.test(q) ||
    /ayce|buffet|rodizio/.test(city);
  if (!ayce) return [];

  const avoidAsia =
    opts.avoidAsia === true ||
    /kein\s+asiat|nicht\s+asiat|no\s+asia|ohne\s+asia|kein\s+sushi/.test(q);
  const weekday = opts.weekday ?? detectAyceWeekdayFromQuery(q);

  let list = HAMBURG_AYCE_SEEDS.filter((s) => matchesWeekday(s, weekday));
  if (avoidAsia) list = list.filter((s) => !s.asian);

  // Freitag + non-Asia: Rodizio vor Pub (Live-QA: Panthera + Down Under)
  if (weekday === 'freitag' && avoidAsia) {
    list = [...list].sort((a, b) => {
      const score = (s: HamburgAyceSeed) =>
        (/rodizio/i.test(s.name) ? 20 : 0) +
        (/down under/i.test(s.name) ? 10 : 0) +
        (s.weekdays.includes('freitag') ? 5 : 0);
      return score(b) - score(a);
    });
  }

  return list;
}

/** Soft-Seed → Maps-Suche (kein Pack-Deep-Link). */
export function hamburgAyceMapsUrl(seed: HamburgAyceSeed): string {
  const q = `${seed.name} ${seed.areaHint || 'Hamburg'}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
