/**
 * 100+ Real-World Friction Categories — Link-Priorisierung & Intent-Hints.
 * scoreLink nutzt diese Keys + dynamische Query-Tokens (nicht als hartes Limit).
 */

export const FRICTION_KEYS = [
  // A. Hotel & Accommodation
  'sauna',
  'wellness',
  'baustelle',
  'renovierung',
  'gesperrt',
  'ausfall',
  'langschläfer',
  'langschlaefer',
  'frühstückszeiten',
  'fruehstueck',
  'frühstück',
  'checkin',
  'checkout',
  'spätanreise',
  'spaetanreise',
  'hunde',
  'haustiere',
  'storno',
  'upgrade',
  'sonderangebot',
  'arrangements',
  'parkplatz',
  'tiefgarage',
  'wallbox',
  'laden',
  // B. Supermarkets & Offers
  'prospekt',
  'angebote',
  'werbung',
  'wochenangebot',
  'rabatt',
  'schnäppchen',
  'schnaeppchen',
  'bier',
  'getränkeangebot',
  'getraenkeangebot',
  'supermarkt',
  'öffnungszeiten-feiertage',
  'oeffnungszeiten',
  'sonntagsöffnung',
  'sonntagsoeffnung',
  'bäcker',
  'baecker',
  'frischetheke',
  // C. Maritime
  'gezeiten',
  'tide',
  'ebbe',
  'flut',
  'hochwasser',
  'niedrigwasser',
  'sturmflut',
  'ersatzfahrplan',
  'seekrankheit',
  'gepäcktransport',
  'gepaeck',
  'inseltaxi',
  'wattenmeer',
  'reederei',
  'anleger',
  'pier',
  'schifffahrt',
  'katamaran',
  'fähre',
  'faehre',
  // D. Mountains / Cable cars
  'bergbahn',
  'seilbahn',
  'gondel',
  'lift',
  'piste',
  'pistenbericht',
  'lawine',
  'sperrung',
  'klettersteig',
  'hütte',
  'huette',
  'übernachtung-hütte',
  'uebernachtung',
  'ruhetag',
  'wettersturz',
  'wanderbus',
  // E. Nightlife / Gastro
  'speisekarte',
  'tageskarte',
  'mittagstisch',
  'happyhour',
  'cocktail',
  'abendkasse',
  'tischreservierung',
  'biergarten',
  'terrasse',
  'küchenschluss',
  'kuechenschluss',
  'vegan',
  'glutenfrei',
  'dresscode',
  'livemusik',
  'dj-set',
  'pub-quiz',
  // F. Events / Sports / Culture
  'turnier',
  'tennisturnier',
  'beachvolleyball',
  'marathon',
  'stadtfest',
  'strassenfest',
  'flohmarkt',
  'kino',
  'openair',
  'theater',
  'ausstellung',
  'museum',
  'kinderprogramm',
  'feuerwerk',
  'kurkonzert',
  'workshop',
  'programm',
  // G. Infrastructure / Health / Public
  'notdienst',
  'apotheke',
  'arzt',
  'tierarzt',
  'geldautomat',
  'ec-automat',
  'post',
  'paketstation',
  'sperrmüll',
  'sperrmuell',
  'baustelle-straße',
  'umleitung',
  'schienenersatzverkehr',
  'sev',
  'wlan-hotspot',
  'wlan',
  'wc',
  'öffentliche-toilette',
  'oeffentliche-toilette',
  'toilette',
  // H. Island / Local tourism
  'kurkarte',
  'gästekarte',
  'gaestekarte',
  'kurbeitrag',
  'strandkorb',
  'strandkorb-mieten',
  'hundestrand',
  'drachensteigen',
  'fahrradverleih',
  'e-bike',
  'akku-wechsel',
  'inlineskates',
  // Generic high-intent
  'fahrplan',
  'ticket',
  'tickets',
  'buch',
  'preis',
  'tarif',
  'öffnung',
  'oeffnung',
  'zeiten',
  'abfahrt',
  'pdf',
  'prospekt',
  'flyer',
  'wartung',
  'gesperrt',
  'hinweis',
  'aktuell',
] as const;

export type FrictionKey = (typeof FRICTION_KEYS)[number];

const FRICTION_SET = new Set(FRICTION_KEYS.map((k) => k.toLowerCase()));

/** Disruption / notice patterns — trigger date validation. */
export const NOTICE_PATTERNS =
  /\b(gesperrt|sperrung|ausfall|wartung|renovierung|baustelle|geändert|geaendert|vorübergehend|voruebergehend|hinweis|achtung|wichtig|geschlossen|außer\s+betrieb|ausser\s+betrieb|fällt\s+aus|faellt\s+aus)\b/iu;

/** PDF brochure filename hints. */
export const PDF_BROCHURE_RE =
  /\b(programm|prospekt|speisekarte|fahrplan|wochenprogramm|flyer|angebote|oeffnungs|öffnungs)[^/\s]*\.pdf\b/i;

export function isFrictionToken(token: string): boolean {
  return FRICTION_SET.has(token.toLowerCase());
}

/** High-intent tokens from user query (length > 4, de-noise stopwords). */
export function extractQueryIntentTokens(goal: string): string[] {
  const stop = new Set([
    'bitte',
    'kannst',
    'könntest',
    'koenntest',
    'heute',
    'morgen',
    'eigentlich',
    'irgendwo',
    'vielleicht',
    'einfach',
    'gerade',
    'wirklich',
    'wegen',
    'oder',
    'aber',
    'auch',
    'noch',
    'mal',
    'dass',
    'wenn',
    'haben',
    'sein',
    'wird',
    'wurde',
    'findus',
    'https',
    'http',
    'www',
  ]);
  return [
    ...new Set(
      goal
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, ' ')
        .split(/[^a-zäöüß0-9\-]+/i)
        .map((w) => w.trim())
        .filter((w) => w.length > 4 && !stop.has(w)),
    ),
  ].slice(0, 16);
}

export function frictionDomainHint(userText: string): string {
  const t = userText.toLowerCase();
  const hits = FRICTION_KEYS.filter((k) => t.includes(k.toLowerCase())).slice(
    0,
    12,
  );
  if (!hits.length) {
    return 'Lokale Friction-Frage: PDFs, Unterseiten, Banner und Hinweise scannen — mit Datumsprüfung.';
  }
  return `Erkannte Friction-Themen: ${hits.join(', ')}. PDFs/Banner/Unterseiten scannen und Daten verifizieren.`;
}
