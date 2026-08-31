/**
 * City / IATA lookup for commercial airports (coords for nearest-origin).
 * Data table — not speech scripts. Unknown cities stay unresolved.
 */

export type CommercialAirport = {
  iata: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  aliases: string[];
};

export const COMMERCIAL_AIRPORTS: readonly CommercialAirport[] = [
  { iata: 'HAM', name: 'Hamburg Airport', city: 'Hamburg', lat: 53.6304, lng: 9.9882, aliases: ['hamburg', 'fuhlsbüttel', 'fuhlsbuettel'] },
  { iata: 'LBC', name: 'Flughafen Lübeck', city: 'Lübeck', lat: 53.8054, lng: 10.7192, aliases: ['lübeck', 'luebeck', 'blankensee'] },
  { iata: 'BRE', name: 'Bremen Airport', city: 'Bremen', lat: 53.0475, lng: 8.7867, aliases: ['bremen'] },
  { iata: 'HAJ', name: 'Hannover Airport', city: 'Hannover', lat: 52.4611, lng: 9.685, aliases: ['hannover', 'hanover'] },
  { iata: 'BER', name: 'BER Brandenburg', city: 'Berlin', lat: 52.3667, lng: 13.5033, aliases: ['berlin', 'brandenburg', 'schönefeld', 'schoenefeld', 'tegel'] },
  { iata: 'FRA', name: 'Frankfurt Airport', city: 'Frankfurt', lat: 50.0379, lng: 8.5622, aliases: ['frankfurt', 'frankfurt am main'] },
  { iata: 'MUC', name: 'München Airport', city: 'München', lat: 48.3538, lng: 11.7861, aliases: ['münchen', 'muenchen', 'munich'] },
  { iata: 'DUS', name: 'Düsseldorf Airport', city: 'Düsseldorf', lat: 51.2895, lng: 6.7668, aliases: ['düsseldorf', 'duesseldorf', 'dusseldorf'] },
  { iata: 'CGN', name: 'Köln/Bonn Airport', city: 'Köln', lat: 50.8659, lng: 7.1427, aliases: ['köln', 'koeln', 'cologne', 'bonn'] },
  { iata: 'STR', name: 'Stuttgart Airport', city: 'Stuttgart', lat: 48.6899, lng: 9.222, aliases: ['stuttgart'] },
  { iata: 'NUE', name: 'Nürnberg Airport', city: 'Nürnberg', lat: 49.4987, lng: 11.078, aliases: ['nürnberg', 'nuernberg', 'nuremberg'] },
  { iata: 'LEJ', name: 'Leipzig/Halle', city: 'Leipzig', lat: 51.4239, lng: 12.2364, aliases: ['leipzig', 'halle'] },
  { iata: 'DRS', name: 'Dresden Airport', city: 'Dresden', lat: 51.1328, lng: 13.7672, aliases: ['dresden'] },
  { iata: 'FMO', name: 'Münster/Osnabrück', city: 'Münster', lat: 52.1346, lng: 7.6848, aliases: ['münster', 'muenster', 'osnabrück', 'osnabrueck'] },
  { iata: 'PAD', name: 'Paderborn/Lippstadt', city: 'Paderborn', lat: 51.6141, lng: 8.6163, aliases: ['paderborn', 'lippstadt'] },
  { iata: 'DTM', name: 'Dortmund Airport', city: 'Dortmund', lat: 51.5183, lng: 7.6122, aliases: ['dortmund'] },
  { iata: 'NRN', name: 'Weeze Airport', city: 'Weeze', lat: 51.6024, lng: 6.1422, aliases: ['weeze', 'niederrhein'] },
  { iata: 'FKB', name: 'Karlsruhe/Baden-Baden', city: 'Baden-Baden', lat: 48.7794, lng: 8.0805, aliases: ['karlsruhe', 'baden-baden', 'baden baden'] },
  { iata: 'FDH', name: 'Friedrichshafen', city: 'Friedrichshafen', lat: 47.6713, lng: 9.5115, aliases: ['friedrichshafen'] },
  { iata: 'VIE', name: 'Wien Schwechat', city: 'Wien', lat: 48.1103, lng: 16.5697, aliases: ['wien', 'vienna', 'schwechat', 'österreich', 'oesterreich'] },
  { iata: 'SZG', name: 'Salzburg Airport', city: 'Salzburg', lat: 47.7933, lng: 13.0043, aliases: ['salzburg'] },
  { iata: 'INN', name: 'Innsbruck Airport', city: 'Innsbruck', lat: 47.2602, lng: 11.3439, aliases: ['innsbruck'] },
  { iata: 'GRZ', name: 'Graz Airport', city: 'Graz', lat: 46.9911, lng: 15.4396, aliases: ['graz'] },
  { iata: 'LNZ', name: 'Linz Airport', city: 'Linz', lat: 48.2332, lng: 14.1875, aliases: ['linz'] },
  { iata: 'ZRH', name: 'Zürich Airport', city: 'Zürich', lat: 47.4582, lng: 8.5555, aliases: ['zürich', 'zurich', 'zuerich'] },
  { iata: 'GVA', name: 'Genf Airport', city: 'Genf', lat: 46.2381, lng: 6.1089, aliases: ['genf', 'geneva'] },
  { iata: 'BSL', name: 'EuroAirport Basel', city: 'Basel', lat: 47.59, lng: 7.5292, aliases: ['basel', 'mulhouse'] },
  { iata: 'AMS', name: 'Schiphol', city: 'Amsterdam', lat: 52.3105, lng: 4.7683, aliases: ['amsterdam', 'schiphol'] },
  { iata: 'CDG', name: 'Paris CDG', city: 'Paris', lat: 49.0097, lng: 2.5479, aliases: ['paris', 'charles de gaulle'] },
  { iata: 'ORY', name: 'Paris Orly', city: 'Paris', lat: 48.7233, lng: 2.3794, aliases: ['orly'] },
  { iata: 'LHR', name: 'Heathrow', city: 'London', lat: 51.47, lng: -0.4543, aliases: ['london', 'heathrow'] },
  { iata: 'LGW', name: 'Gatwick', city: 'London', lat: 51.1537, lng: -0.1821, aliases: ['gatwick'] },
  { iata: 'STN', name: 'Stansted', city: 'Stansted', lat: 51.886, lng: 0.238, aliases: ['stansted', 'london stansted'] },
  { iata: 'LTN', name: 'Luton', city: 'Luton', lat: 51.8747, lng: -0.3683, aliases: ['luton', 'london luton'] },
  { iata: 'LCY', name: 'London City', city: 'London City', lat: 51.5053, lng: 0.0553, aliases: ['london city', 'city airport'] },
  { iata: 'LIS', name: 'Lissabon', city: 'Lissabon', lat: 38.7813, lng: -9.1359, aliases: ['lissabon', 'lisbon', 'lisboa'] },
  { iata: 'OPO', name: 'Porto Francisco Sá Carneiro', city: 'Porto', lat: 41.2481, lng: -8.6814, aliases: ['porto', 'oporto'] },
  { iata: 'FCO', name: 'Rom Fiumicino', city: 'Rom', lat: 41.8003, lng: 12.2389, aliases: ['rom', 'rome', 'fiumicino'] },
  { iata: 'MXP', name: 'Mailand Malpensa', city: 'Mailand', lat: 45.6306, lng: 8.7281, aliases: ['mailand', 'milan', 'malpensa'] },
  { iata: 'BCN', name: 'Barcelona El Prat', city: 'Barcelona', lat: 41.2971, lng: 2.0785, aliases: ['barcelona'] },
  { iata: 'MAD', name: 'Madrid Barajas', city: 'Madrid', lat: 40.4983, lng: -3.5676, aliases: ['madrid'] },
  { iata: 'PMI', name: 'Palma de Mallorca', city: 'Palma', lat: 39.5517, lng: 2.7388, aliases: ['palma', 'mallorca'] },
  { iata: 'AGP', name: 'Málaga', city: 'Málaga', lat: 36.6749, lng: -4.4991, aliases: ['málaga', 'malaga'] },
  { iata: 'ATH', name: 'Athen', city: 'Athen', lat: 37.9364, lng: 23.9445, aliases: ['athen', 'athens'] },
  { iata: 'CPH', name: 'Kopenhagen', city: 'Kopenhagen', lat: 55.618, lng: 12.6508, aliases: ['kopenhagen', 'copenhagen'] },
  { iata: 'ARN', name: 'Stockholm Arlanda', city: 'Stockholm', lat: 59.6519, lng: 17.9186, aliases: ['stockholm', 'arlanda'] },
  { iata: 'OSL', name: 'Oslo Gardermoen', city: 'Oslo', lat: 60.1939, lng: 11.1004, aliases: ['oslo'] },
  { iata: 'PRG', name: 'Prag', city: 'Prag', lat: 50.1008, lng: 14.26, aliases: ['prag', 'prague'] },
  { iata: 'BUD', name: 'Budapest', city: 'Budapest', lat: 47.4369, lng: 19.2556, aliases: ['budapest'] },
  { iata: 'WAW', name: 'Warschau', city: 'Warschau', lat: 52.1657, lng: 20.9671, aliases: ['warschau', 'warsaw'] },
  { iata: 'AYT', name: 'Antalya Airport', city: 'Antalya', lat: 36.8987, lng: 30.8005, aliases: ['antalya', 'antalja', 'anthalya', 'antallia', 'antalia', 'adalya', 'hataya', 'antalya havalimani'] },
  { iata: 'GZP', name: 'Gazipaşa-Alanya', city: 'Alanya', lat: 36.2992, lng: 32.301, aliases: ['alanya', 'gazipasa', 'gazipaşa'] },
  { iata: 'ADB', name: 'Izmir Adnan Menderes', city: 'Izmir', lat: 38.2924, lng: 27.157, aliases: ['izmir', 'adnan menderes'] },
  { iata: 'BJV', name: 'Bodrum Milas', city: 'Bodrum', lat: 37.2506, lng: 27.6643, aliases: ['bodrum', 'milas'] },
  { iata: 'DLM', name: 'Dalaman', city: 'Dalaman', lat: 36.7131, lng: 28.7925, aliases: ['dalaman'] },
  { iata: 'IST', name: 'Istanbul Airport', city: 'Istanbul', lat: 41.2753, lng: 28.7519, aliases: ['istanbul', 'istanbul airport', 'ist'] },
  { iata: 'SAW', name: 'Istanbul Sabiha Gökçen', city: 'Istanbul', lat: 40.8986, lng: 29.3092, aliases: ['sabiha', 'gökçen', 'goekcen', 'saw'] },
  { iata: 'RHO', name: 'Rhodos', city: 'Rhodos', lat: 36.4054, lng: 28.0862, aliases: ['rhodos', 'rhodes'] },
  { iata: 'HER', name: 'Heraklion', city: 'Heraklion', lat: 35.3397, lng: 25.1803, aliases: ['heraklion', 'iraklio', 'kreta'] },
  { iata: 'CFU', name: 'Korfu', city: 'Korfu', lat: 39.6019, lng: 19.9117, aliases: ['korfu', 'corfu'] },
  { iata: 'KGS', name: 'Kos', city: 'Kos', lat: 36.7933, lng: 27.0917, aliases: ['kos'] },
  { iata: 'FAO', name: 'Faro', city: 'Faro', lat: 37.0144, lng: -7.9659, aliases: ['faro', 'algarve'] },
  { iata: 'TFS', name: 'Teneriffa Süd', city: 'Teneriffa', lat: 28.0445, lng: -16.5725, aliases: ['teneriffa', 'tenerife'] },
  { iata: 'LPA', name: 'Gran Canaria', city: 'Las Palmas', lat: 27.9319, lng: -15.3866, aliases: ['gran canaria', 'las palmas'] },
  { iata: 'ACE', name: 'Lanzarote', city: 'Lanzarote', lat: 28.9455, lng: -13.6052, aliases: ['lanzarote'] },
  { iata: 'IBZ', name: 'Ibiza', city: 'Ibiza', lat: 38.8729, lng: 1.3731, aliases: ['ibiza'] },
  { iata: 'DBV', name: 'Dubrovnik', city: 'Dubrovnik', lat: 42.5614, lng: 18.2682, aliases: ['dubrovnik'] },
  { iata: 'SPU', name: 'Split', city: 'Split', lat: 43.5389, lng: 16.298, aliases: ['split'] },
  { iata: 'NAP', name: 'Neapel', city: 'Neapel', lat: 40.886, lng: 14.2908, aliases: ['neapel', 'naples'] },
  { iata: 'VCE', name: 'Venedig Marco Polo', city: 'Venedig', lat: 45.5053, lng: 12.3519, aliases: ['venedig', 'venice'] },
  { iata: 'NCE', name: 'Nizza', city: 'Nizza', lat: 43.6584, lng: 7.2159, aliases: ['nizza', 'nice'] },
  { iata: 'DXB', name: 'Dubai', city: 'Dubai', lat: 25.2532, lng: 55.3657, aliases: ['dubai'] },
];

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function airportByIata(iata: string | null | undefined): CommercialAirport | null {
  const code = (iata || '').trim().toUpperCase();
  if (!code) return null;
  return COMMERCIAL_AIRPORTS.find((a) => a.iata === code) ?? null;
}

/** IATA → ICAO für Dest-Match (FlightAware liefert oft LTAI statt AYT). */
const IATA_TO_ICAO: Record<string, string> = {
  HAM: 'EDDH',
  LBC: 'EDHL',
  BRE: 'EDDW',
  HAJ: 'EDDV',
  BER: 'EDDB',
  FRA: 'EDDF',
  MUC: 'EDDM',
  DUS: 'EDDL',
  CGN: 'EDDK',
  STR: 'EDDS',
  NUE: 'EDDN',
  LEJ: 'EDDP',
  DRS: 'EDDC',
  VIE: 'LOWW',
  AMS: 'EHAM',
  AYT: 'LTAI',
  IST: 'LTFM',
  SAW: 'LTFJ',
  GZP: 'LTFG',
  ADB: 'LTBJ',
  BJV: 'LTFE',
  DLM: 'LTBS',
  PMI: 'LEPA',
  AGP: 'LEMG',
  ATH: 'LGAV',
  LHR: 'EGLL',
  LGW: 'EGKK',
  STN: 'EGSS',
  LTN: 'EGGW',
  LCY: 'EGLC',
  CDG: 'LFPG',
  FCO: 'LIRF',
  MXP: 'LIMC',
  BCN: 'LEBL',
  MAD: 'LEMD',
  DXB: 'OMDB',
  CPH: 'EKCH',
  ZRH: 'LSZH',
  GVA: 'LSGG',
  BSL: 'LFSB',
  LIS: 'LPPT',
  OPO: 'LPPR',
  FAO: 'LPFR',
};

export function icaoForIata(iata: string): string | null {
  return IATA_TO_ICAO[iata.trim().toUpperCase()] ?? null;
}

const ICAO_TO_IATA: Record<string, string> = Object.fromEntries(
  Object.entries(IATA_TO_ICAO).map(([iata, icao]) => [icao, iata]),
);

/** EDDH → HAM — AeroAPI liefert oft ICAO am Origin. */
export function iataForIcao(icao: string | null | undefined): string | null {
  const code = (icao || '').trim().toUpperCase();
  if (!code) return null;
  return ICAO_TO_IATA[code] ?? null;
}

/** Board-/FIDS-Lookup: IATA bevorzugen, ICAO auf IATA mappen. */
export function normalizeAirportIata(
  code: string | null | undefined,
): string | null {
  const raw = (code || '').trim().toUpperCase();
  if (!raw) return null;
  if (/^[A-Z]{3}$/.test(raw)) return raw;
  if (/^[A-Z]{4}$/.test(raw)) return iataForIcao(raw) ?? raw;
  return raw;
}

/** Mehrere Flughäfen einer Stadt — eine AeroAPI-Abfrage, alle Dest-Codes. */
const CITY_AIRPORT_GROUPS: readonly (readonly string[])[] = [
  ['IST', 'SAW'],
  ['LHR', 'LGW', 'STN', 'LTN', 'LCY'],
  ['CDG', 'ORY', 'BVA'],
  ['FCO', 'CIA'],
  ['MXP', 'LIN', 'BGY'],
  ['BER', 'SXF', 'TXL'],
];

export function relatedAirportIatas(iata: string): string[] {
  const code = iata.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return [];
  const group = CITY_AIRPORT_GROUPS.find((g) => g.includes(code));
  return group ? [...group] : [code];
}

/** Civil clock at the airport — spoken „11 Uhr“ meint Tafelzeit, nicht Device-UTC. */
export function airportTimeZone(iata: string | null | undefined): string {
  const id = (iata || '').trim().toUpperCase();
  if (['LHR', 'LGW', 'STN', 'LTN', 'LCY'].includes(id)) return 'Europe/London';
  if (['LIS', 'OPO', 'FAO'].includes(id)) return 'Europe/Lisbon';
  if (['ATH', 'HER', 'RHO', 'CFU', 'KGS'].includes(id)) return 'Europe/Athens';
  return 'Europe/Berlin';
}

export function airportByCode(code: string | null | undefined): CommercialAirport | null {
  const c = (code || '').trim().toUpperCase();
  if (!c) return null;
  const byIata = airportByIata(c);
  if (byIata) return byIata;
  const iata = Object.entries(IATA_TO_ICAO).find(([, icao]) => icao === c)?.[0];
  return iata ? airportByIata(iata) : null;
}

export function airportCodeMatches(
  raw: string | null | undefined,
  iata: string,
): boolean {
  const c = (raw || '').trim().toUpperCase();
  const i = iata.trim().toUpperCase();
  if (!c || !i) return false;
  if (c === i) return true;
  if (IATA_TO_ICAO[i] === c) return true;
  return false;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Array<number>(b.length + 1);
  const v1 = new Array<number>(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v0[b.length] ?? 99;
}

function fuzzyCityMatch(n: string, k: string): boolean {
  if (k.length < 6 || n.length < 5) return false;
  if (n[0] !== k[0]) return false;
  const max = n.length >= 7 && k.length >= 7 ? 2 : 1;
  return levenshtein(n, k) <= max;
}

/**
 * Stadt-Hint vs. Airport-Key. Kein IATA-Substring in Städtenamen
 * (sonst matcht „Antalya“ nicht Amsterdam/Athen über Zufalls-Buchstaben).
 */
export function cityHintMatchesAirportKey(hintNorm: string, keyNorm: string): boolean {
  const n = hintNorm.trim();
  const k = keyNorm.trim();
  if (!n || !k) return false;
  if (n === k) return true;
  const keyIsIata = k.length === 3 && /^[a-z]{3}$/.test(k);
  if (keyIsIata) return n === k;
  if (n.includes(k) && k.length >= 5) return true;
  if (k.includes(n) && n.length >= 4) return true;
  if (fuzzyCityMatch(n, k)) return true;
  return false;
}

export function findAirportByCityHint(hint: string): CommercialAirport | null {
  const n = norm(hint);
  if (!n || n.length < 3) return null;
  let best: CommercialAirport | null = null;
  let bestScore = 0;
  for (const a of COMMERCIAL_AIRPORTS) {
    const keys = [a.city, a.name, a.iata, ...a.aliases].map(norm);
    for (const k of keys) {
      if (!cityHintMatchesAirportKey(n, k)) continue;
      const score = n === k ? 1000 + k.length : k.length;
      if (score > bestScore) {
        best = a;
        bestScore = score;
      }
    }
  }
  return best;
}

/** Stadtname irgendwo in der Äußerung — auch kleingeschrieben / STT-Tippfehler. */
export function findAirportMentionedInText(text: string): CommercialAirport | null {
  const raw = text.replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const afterTo = raw.match(/\b(?:nach|richtung)\s+(.+)$/iu);
  if (afterTo?.[1]) {
    const chunk = afterTo[1]
      .replace(/[.,!?]+/g, ' ')
      .replace(/\b(heute|morgen|abend|fliegen|flieg|flieger|uhr|mit|ohne)\b.*$/iu, '')
      .trim();
    const first = chunk.split(/\s+/)[0] ?? '';
    const hit =
      (first.length >= 3 ? findAirportByCityHint(first) : null) ??
      (chunk.length >= 3 ? findAirportByCityHint(chunk) : null);
    if (hit) return hit;
  }
  const n = norm(raw);
  if (n.length <= 24) {
    return findAirportByCityHint(n);
  }
  return null;
}

/** Alle Linienflughäfen im Umkreis (London: LCY/LHR/LGW/LTN/STN). */
export function commercialAirportsWithinKm(
  lat: number,
  lng: number,
  maxKm = 100,
): CommercialAirport[] {
  return COMMERCIAL_AIRPORTS.map((a) => ({
    a,
    d: haversineKm({ lat, lng }, a),
  }))
    .filter((x) => x.d <= maxKm)
    .sort((x, y) => x.d - y.d)
    .map((x) => x.a);
}

/** Nearest commercial airport within maxKm (default 250). */
export function nearestCommercialAirport(
  lat: number,
  lng: number,
  maxKm = 250,
): CommercialAirport | null {
  let best: CommercialAirport | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const a of COMMERCIAL_AIRPORTS) {
    const d = haversineKm({ lat, lng }, a);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  if (!best || bestD > maxKm) return null;
  return best;
}
