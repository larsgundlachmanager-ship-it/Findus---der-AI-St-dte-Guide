/**
 * ISO-Helfer für Länder-Namen (Pack-Meta).
 * Sichtbare Ländergrenzen: Protomaps `boundaries_country` (weiß) —
 * siehe yorroProtomapsBasemapStyle.ensureProtomapsBoundaryLayers.
 */

/** Anzeigenamen / Aliase → ISO 3166-1 alpha-3. */
const COUNTRY_NAME_TO_A3: Record<string, string> = {
  deutschland: 'DEU',
  germany: 'DEU',
  de: 'DEU',
  deu: 'DEU',
  niederlande: 'NLD',
  netherlands: 'NLD',
  holland: 'NLD',
  nl: 'NLD',
  nld: 'NLD',
  portugal: 'PRT',
  pt: 'PRT',
  prt: 'PRT',
  'united kingdom': 'GBR',
  uk: 'GBR',
  gbr: 'GBR',
  grossbritannien: 'GBR',
  britain: 'GBR',
  'great britain': 'GBR',
  england: 'GBR',
  frankreich: 'FRA',
  france: 'FRA',
  fr: 'FRA',
  fra: 'FRA',
  oesterreich: 'AUT',
  osterreich: 'AUT',
  austria: 'AUT',
  at: 'AUT',
  aut: 'AUT',
  schweiz: 'CHE',
  switzerland: 'CHE',
  ch: 'CHE',
  che: 'CHE',
  belgien: 'BEL',
  belgium: 'BEL',
  be: 'BEL',
  bel: 'BEL',
  spanien: 'ESP',
  spain: 'ESP',
  es: 'ESP',
  esp: 'ESP',
  italien: 'ITA',
  italy: 'ITA',
  it: 'ITA',
  ita: 'ITA',
  daenemark: 'DNK',
  danemark: 'DNK',
  denmark: 'DNK',
  dk: 'DNK',
  dnk: 'DNK',
  polen: 'POL',
  poland: 'POL',
  pl: 'POL',
  pol: 'POL',
  tschechien: 'CZE',
  'czech republic': 'CZE',
  czechia: 'CZE',
  cz: 'CZE',
  cze: 'CZE',
};

export function normalizeCountryToA3(raw: string | null | undefined): string | null {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (!key) return null;
  if (/^[a-z]{3}$/.test(key) && COUNTRY_NAME_TO_A3[key]) {
    return COUNTRY_NAME_TO_A3[key]!;
  }
  if (/^[a-z]{3}$/.test(key)) return key.toUpperCase();
  return COUNTRY_NAME_TO_A3[key] ?? null;
}

/** Länder-ISO-Codes aus Country-Namen (z. B. CITY_SEARCH_META.country). */
export function packCountryA3CodesFromNames(
  countries: Iterable<string | null | undefined>,
): string[] {
  const out = new Set<string>();
  for (const raw of countries) {
    const a3 = normalizeCountryToA3(raw);
    if (a3) out.add(a3);
  }
  return [...out].sort();
}
