/**
 * AWIN-Pauschal / Versicherung — öffentliche Deep-URLs.
 * Keine session-IDs, city_id, hotelId, GIATA, seed, searchId erfinden.
 */

function ymd(raw?: string | null): string | null {
  const m = String(raw || '').match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return m?.[1] ?? null;
}

function clampAdults(n?: number | null, fallback = 2): number {
  const v = n != null && n > 0 ? Math.floor(n) : fallback;
  return Math.min(8, Math.max(1, v));
}

function nightsBetween(start?: string | null, end?: string | null): number | null {
  const a = ymd(start);
  const b = ymd(end);
  if (!a || !b) return null;
  const ms = Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms / 86400000);
}

export function check24DurationBand(nights: number): string {
  if (nights <= 4) return '1-4';
  if (nights <= 8) return '5-8';
  if (nights <= 14) return '9-14';
  return '15-22';
}

const DE_IATA_RE =
  /\b(HAM|BER|MUC|FRA|DUS|STR|HAJ|NUE|BRE|CGN|LEJ|DRS|FMO|PAD|SCN|HHN|FKB|FMM|NRN|DTM|GWT|LBC|RLG|HDF|FMO)\b/i;

export function parseOriginIata(text?: string | null): string | null {
  const m = String(text || '').toUpperCase().match(DE_IATA_RE);
  return m?.[1] ?? null;
}

export function slugifyHolidayPath(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** CHECK24 Pauschal-Vergleich — Daten/Airport/Personen, keine erfundenen city_id/hotelId. */
export function buildCheck24PackageSearchUrl(opts?: {
  departureDate?: string | null;
  returnDate?: string | null;
  airport?: string | null;
  adults?: number | null;
  childrenCount?: number | null;
}): string {
  const u = new URL('https://www.check24.net/pauschalreisen-vergleich/');
  const dep = ymd(opts?.departureDate);
  const ret = ymd(opts?.returnDate);
  if (dep) u.searchParams.set('c24pp_departure_date', dep);
  if (ret) u.searchParams.set('c24pp_return_date', ret);
  const nights = nightsBetween(dep, ret);
  if (nights != null) {
    u.searchParams.set('c24pp_travel_duration', check24DurationBand(nights));
  }
  const iata = (opts?.airport || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(iata)) u.searchParams.set('c24pp_airport', iata);
  const adults = clampAdults(opts?.adults);
  u.searchParams.set('c24pp_adult', String(adults));
  const kids =
    opts?.childrenCount != null && opts.childrenCount >= 0
      ? Math.min(4, Math.floor(opts.childrenCount))
      : 0;
  u.searchParams.set('c24pp_childrenCount', String(kids));
  for (let i = 0; i < 4; i++) {
    u.searchParams.set(`c24pp_children_${i}[age]`, '-');
  }
  return u.toString();
}

export function buildCheck24CarCompareUrl(): string {
  return 'https://www.check24.net/mietwagen-preisvergleich/';
}

const WEG_EPHEMERAL =
  /^(seed|searchId|vcSearchId|extReferenceId|extReferenceType|rctx|rsign|clickId|click_on_card|bfSubSource|hotelListId|source)$/i;

const WEG_KEEP = new Set([
  'destination',
  'dateFrom',
  'dateTo',
  'origin',
  'adults',
  'searchMode',
  'sort',
  'rating',
  'q',
]);

/** weg.de: tote Session-Token raus, Daten/Ziel/Origin behalten. */
export function sanitizeWegDeUrl(url: string): string {
  try {
    const u = new URL(url);
    const brokenDetail = /\/s\/tsx\//i.test(u.pathname);
    const hasEphemeral = [...u.searchParams.keys()].some((k) =>
      WEG_EPHEMERAL.test(k),
    );
    if (brokenDetail || hasEphemeral) {
      const out = new URL('https://staedtereisen.weg.de/');
      for (const key of WEG_KEEP) {
        const v = u.searchParams.get(key);
        if (v) out.searchParams.set(key, v);
      }
      return out.toString();
    }
    for (const key of [...u.searchParams.keys()]) {
      if (WEG_EPHEMERAL.test(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return url;
  }
}

export function buildWegDeSearchUrl(opts?: {
  cityOrQuery?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  origin?: string | null;
  adults?: number | null;
}): string {
  const q = (opts?.cityOrQuery || '').trim();
  const u = new URL('https://staedtereisen.weg.de/');
  const from = ymd(opts?.dateFrom);
  const to = ymd(opts?.dateTo);
  if (from) u.searchParams.set('dateFrom', from);
  if (to) u.searchParams.set('dateTo', to);
  const iata = (opts?.origin || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(iata)) u.searchParams.set('origin', iata);
  u.searchParams.set('adults', String(clampAdults(opts?.adults)));
  if (q) u.searchParams.set('q', q);
  return u.toString();
}

function aiduRooms(adults: number): string {
  return Array.from({ length: adults }, () => 'A').join(',');
}

/** ab-in-den-urlaub: Hotel-GIATA nur durchreichen. */
export function buildAbInDenUrlaubOffersUrl(opts?: {
  hotelGiataId?: string | null;
  destinationId?: string | null;
  dateMin?: string | null;
  dateMax?: string | null;
  airports?: string | null;
  adults?: number | null;
  durationMin?: number | null;
  durationMax?: number | null;
}): string {
  const giata = (opts?.hotelGiataId || '').replace(/\D/g, '');
  const path = giata
    ? `https://www.ab-in-den-urlaub.de/find/hotel/${giata}-giata/offers`
    : 'https://www.ab-in-den-urlaub.de/find/offers';
  const u = new URL(path);
  const destId = (opts?.destinationId || '').trim();
  if (destId) u.searchParams.set('destinationId', destId);
  const min = ymd(opts?.dateMin);
  const max = ymd(opts?.dateMax);
  if (min) u.searchParams.set('dateMin', min);
  if (max) u.searchParams.set('dateMax', max);
  const iata = (opts?.airports || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(iata)) u.searchParams.set('airports', iata);
  u.searchParams.set('rooms', aiduRooms(clampAdults(opts?.adults)));
  const nights = nightsBetween(min, max);
  const dMin = opts?.durationMin ?? (nights != null ? nights : 5);
  const dMax = opts?.durationMax ?? dMin;
  u.searchParams.set('durationMin', String(dMin));
  u.searchParams.set('durationMax', String(dMax));
  u.searchParams.set('travelType', 'packageTour');
  return u.toString();
}

export function extractAbInDenUrlaubGiataId(url: string): string | null {
  const m = url.match(/\/find\/hotel\/(\d+)-giata/i);
  return m?.[1] ?? null;
}

export function extractAbInDenUrlaubDestinationId(url: string): string | null {
  try {
    return new URL(url).searchParams.get('destinationId');
  } catch {
    return null;
  }
}

/** Solmar: Stadt und optional Hotel-Slug, keine erfundenen Hotel-IDs. */
export function buildSolmarHotelUrl(opts: {
  citySlug?: string | null;
  hotelSlug?: string | null;
}): string {
  const city = slugifyHolidayPath(opts.citySlug || '');
  const hotel = slugifyHolidayPath(opts.hotelSlug || '');
  if (city && hotel) {
    const h = hotel.startsWith('hotel-') ? hotel : `hotel-${hotel}`;
    return `https://www.solmar.de/${encodeURIComponent(city)}/${encodeURIComponent(h)}`;
  }
  if (city) return `https://www.solmar.de/${encodeURIComponent(city)}`;
  return 'https://www.solmar.de/';
}

export const TRAVELSECURE_TARIFRECHNER_URL =
  'https://www.travelsecure.de/tarifrechnerts/tarifrechner-rr.html';
