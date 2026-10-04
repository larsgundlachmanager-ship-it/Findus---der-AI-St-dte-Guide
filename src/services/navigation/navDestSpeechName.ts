/**
 * Nav-Zielname für Speech/HUD-Bridge — nie Straße+Hausnummer+PLZ vorlesen.
 * Geocode-Labels (Nominatim display_name, Google formatted_address) → kurzer Name.
 */

const PLZ_CITY_RE = /\b\d{4,5}\s+[A-ZÄÖÜ][\wÄÖÜäöüß.-]+/gu;
const STREET_PLUS_NR_RE =
  /\b([\wÄÖÜäöüß.-]+(?:straße|strasse|str\.|allee|weg|platz|gasse|ring|damm|chaussee))\s+\d{1,4}[a-zA-Z]?\b/iu;
const HOUSE_NR_TAIL_RE = /\s+\d{1,4}[a-zA-Z]?(?=\s*,|\s*$)/u;

/** True wenn Label wie Adresszeile wirkt (nicht als Zielname sprechen). */
export function looksLikeNavAddressLabel(raw: string): boolean {
  const t = (raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (PLZ_CITY_RE.test(t)) return true;
  PLZ_CITY_RE.lastIndex = 0;
  if (STREET_PLUS_NR_RE.test(t)) return true;
  STREET_PLUS_NR_RE.lastIndex = 0;
  // „Name, Straße 2, 25497 Ort, Deutschland“
  if (/,/.test(t) && /\b\d{4,5}\b/.test(t)) return true;
  if (/,/.test(t) && STREET_PLUS_NR_RE.test(t.split(',')[0] ?? '')) return true;
  return false;
}

/**
 * Speech-/Bridge-Name: POI-Name behalten; Adress-Müll → erstes sinnvolles Token
 * oder User-Query. Nie PLZ/Straße+Nr. in die Bridge.
 */
export function resolveNavDestSpeechName(opts: {
  /** User-Query / Hard-Dest („Kindergarten …“, „Tennis Club“) */
  query?: string | null;
  /** Geocode/Places label (kann Adresse sein) */
  geoLabel?: string | null;
  /** Places name wenn getrennt verfügbar */
  placeName?: string | null;
  /** Explizite Straßen-Navigation: Straße ohne PLZ ok */
  streetMode?: boolean;
}): string {
  const query = (opts.query || '').replace(/\s+/g, ' ').trim();
  const place = (opts.placeName || '').replace(/\s+/g, ' ').trim();
  const geo = (opts.geoLabel || '').replace(/\s+/g, ' ').trim();

  if (place && !looksLikeNavAddressLabel(place)) {
    return place.slice(0, 80);
  }

  if (opts.streetMode) {
    const street = scrubAddressForSpeech(geo || query);
    return street || query || 'dein Ziel';
  }

  // User tippte Straße+Nr. → HUD/Button behalten ("Heisterhoop 12")
  if (query && /\b\d{1,4}[a-zA-Z]?\b/.test(query) && query.length >= 3 && query.length <= 48) {
    const qFirst = query.split(',')[0]?.trim() || query;
    if (!/,/.test(qFirst) && !/\b\d{4,5}\b/.test(qFirst)) {
      return qFirst.slice(0, 80);
    }
  }

  // Query ist klarer Ortsname → dem Geocode-Adress-Müll vorziehen
  if (query && !looksLikeNavAddressLabel(query) && query.length >= 3) {
    if (!geo || looksLikeNavAddressLabel(geo) || geo.includes(',')) {
      return query.slice(0, 80);
    }
  }

  if (geo && !looksLikeNavAddressLabel(geo)) {
    // „POI, Stadt“ → nur POI
    const first = geo.split(',')[0]?.trim();
    if (first && first.length >= 3) return first.slice(0, 80);
    return geo.slice(0, 80);
  }

  if (geo) {
    const first = geo.split(',')[0]?.trim() ?? '';
    if (first && !looksLikeNavAddressLabel(first) && !HOUSE_NR_TAIL_RE.test(first)) {
      return first.slice(0, 80);
    }
    const scrubbed = scrubAddressForSpeech(first || geo);
    if (scrubbed) return scrubbed;
  }

  return (query || place || 'dein Ziel').slice(0, 80);
}

function scrubAddressForSpeech(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  s = s.replace(PLZ_CITY_RE, '').trim();
  s = s.replace(/\bDeutschland\b/giu, '').trim();
  s = s.replace(/,+/g, ',').replace(/^,\s*|,\s*$/g, '').trim();
  // Straße + Nr. behalten (HUD/Button: "Heisterhoop 12") — nur PLZ/Land weg
  const m = s.match(STREET_PLUS_NR_RE);
  if (m?.[0]) return m[0].trim().slice(0, 80);
  // Kein Street-Match: Hausnummer am Ende behalten wenn Query so war
  const house = s.match(/^([\wÄÖÜäöüß.-]+)\s+(\d{1,4}[a-zA-Z]?)$/u);
  if (house) return `${house[1]} ${house[2]}`.slice(0, 80);
  if (looksLikeNavAddressLabel(s) || !s) return '';
  return s.slice(0, 80);
}
