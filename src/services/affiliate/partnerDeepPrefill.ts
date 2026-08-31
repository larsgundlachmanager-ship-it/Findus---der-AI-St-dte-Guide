/**
 * Partner-Deep-Prefill — Expedia-Goldstandard für alle Partner:
 * so weit vorbefüllen, dass der User möglichst nur noch prüft und bezahlt.
 *
 * Ehrliche Grenzen (kein Fake-Checkout):
 * - Uber: Pickup/Dropoff + Produktwahl (Preis/ETA) oder Reserve mit Abholzeit; client_id bleibt
 * - eSIM: Land/Produktseite ja; konkreter GB-Tarif oft erst im Shop wählbar
 * - Camping: Platz-Detailseite ja; Stellplatz+Bezahlung je nach Platz
 */

/** ISO-Land / Airalo-Slug / travSIM product-slug. */
const COUNTRY_ESIM: Array<{
  re: RegExp;
  airalo: string;
  travsim: string;
  labelDe: string;
}> = [
  { re: /\b(deutschland|germany|deutsch)\b/iu, airalo: 'germany', travsim: 'germany', labelDe: 'Deutschland' },
  { re: /\b(österreich|oesterreich|austria)\b/iu, airalo: 'austria', travsim: 'austria', labelDe: 'Österreich' },
  { re: /\b(schweiz|switzerland|swiss)\b/iu, airalo: 'switzerland', travsim: 'switzerland', labelDe: 'Schweiz' },
  { re: /\b(spanien|spain|españa|espana)\b/iu, airalo: 'spain', travsim: 'spain', labelDe: 'Spanien' },
  { re: /\b(frankreich|france)\b/iu, airalo: 'france', travsim: 'france', labelDe: 'Frankreich' },
  { re: /\b(italien|italy|italia)\b/iu, airalo: 'italy', travsim: 'italy', labelDe: 'Italien' },
  { re: /\b(portugal)\b/iu, airalo: 'portugal', travsim: 'portugal', labelDe: 'Portugal' },
  { re: /\b(niederlande|holland|netherlands)\b/iu, airalo: 'netherlands', travsim: 'netherlands', labelDe: 'Niederlande' },
  { re: /\b(belgien|belgium)\b/iu, airalo: 'belgium', travsim: 'belgium', labelDe: 'Belgien' },
  { re: /\b(griechenland|greece)\b/iu, airalo: 'greece', travsim: 'greece', labelDe: 'Griechenland' },
  { re: /\b(kroatien|croatia)\b/iu, airalo: 'croatia', travsim: 'croatia', labelDe: 'Kroatien' },
  { re: /\b(türkei|tuerkei|turkey|türkiye|turkiye)\b/iu, airalo: 'turkey', travsim: 'turkey', labelDe: 'Türkei' },
  { re: /\b(usa|vereinigte\s+staaten|united\s+states|amerika)\b/iu, airalo: 'united-states', travsim: 'usa', labelDe: 'USA' },
  { re: /\b(großbritannien|grossbritannien|england|uk|united\s+kingdom)\b/iu, airalo: 'united-kingdom', travsim: 'united-kingdom', labelDe: 'UK' },
  { re: /\b(japan)\b/iu, airalo: 'japan', travsim: 'japan', labelDe: 'Japan' },
  { re: /\b(thailand)\b/iu, airalo: 'thailand', travsim: 'thailand', labelDe: 'Thailand' },
  { re: /\b(europa|europe)\b/iu, airalo: 'europe', travsim: 'europe', labelDe: 'Europa' },
];

export type EsimCountryHit = {
  airaloSlug: string;
  travsimSlug: string;
  labelDe: string;
};

export function resolveEsimCountry(opts: {
  text?: string | null;
  cityName?: string | null;
  countryHint?: string | null;
}): EsimCountryHit | null {
  const blob = [opts.text, opts.cityName, opts.countryHint]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (!blob) return null;
  for (const row of COUNTRY_ESIM) {
    if (row.re.test(blob)) {
      return {
        airaloSlug: row.airalo,
        travsimSlug: row.travsim,
        labelDe: row.labelDe,
      };
    }
  }
  return null;
}

/** Campingplatz-Name → camping.info Slug. */
export function slugifyCampingplatz(name: string): string {
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
    .slice(0, 80);
}

/**
 * Extrahiert Campingplatz-Namen aus Speech („Campingplatz X“…).
 */
export function extractCampingplatzName(text: string): string | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m =
    t.match(
      /(?:campingplatz|camping\s*park|stellplatz|zeltplatz|glamping)\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']{1,40})/i,
    ) ||
    t.match(
      /\b([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']{1,40})\s+(?:campingplatz|camping)\b/i,
    );
  let raw = m?.[1]?.trim() || null;
  if (!raw || raw.length < 3) return null;
  raw = raw
    .split(/\s+/)
    .filter(
      (w) =>
        !/^(in|bei|am|der|die|das|ein|eine|war|ist|und|mit|für|fuer|von|zum|zur)$/i.test(
          w,
        ),
    )
    .join(' ')
    .trim();
  if (!raw || raw.length < 3) return null;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Koffer/Taschen-Zahl aus Speech — sonst null (kein Raten). */
export function parseLuggageBagCount(text: string): number | null {
  const t = (text || '').replace(/\s+/g, ' ').toLowerCase();
  if (!t) return null;
  const m = t.match(
    /\b(\d{1,2})\s*(?:koffer|taschen|tasche|gepäckstücke|gepaeckstuecke|bags?)\b/iu,
  );
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 20) return n;
  }
  if (/\bzwei\s+(koffer|taschen|bags)/iu.test(t)) return 2;
  if (/\bein(?:en)?\s+(koffer|tasche|bag)/iu.test(t)) return 1;
  return null;
}

/** YYYY-MM-DD aus freiem DE-Text (heute/morgen/Datum). */
export function parseTravelDateYmd(
  text: string,
  opts?: { base?: Date },
): string | null {
  const t = (text || '').toLowerCase();
  const base = opts?.base ?? new Date();
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  if (/\bheute\b/u.test(t)) return ymd(base);
  if (/\bmorgen\b/u.test(t)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    return ymd(d);
  }
  const iso = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const de = t.match(/\b(\d{1,2})\.(\d{1,2})\.((?:20)?\d{2})\b/);
  if (de) {
    const day = de[1].padStart(2, '0');
    const month = de[2].padStart(2, '0');
    let year = de[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }
  return null;
}

/**
 * Android Linking.canOpenURL / openURL lehnt rohe `[` `]` in Query-URLs ab.
 * Uber-Deeplinks nutzen dropoff[latitude] — percent-encoden.
 */
export function encodeUriBrackets(url: string): string {
  return String(url || '').replace(/\[/g, '%5B').replace(/\]/g, '%5D');
}

/**
 * Taxi-/Uber-Slot: auf 5-Minuten-Raster abrunden (04:22 → 04:20),
 * damit man eher früher los ist. Glatte 5er bleiben.
 */
export function roundClockHmmDownTo5(hhmm: string): string {
  const m = String(hhmm || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return hhmm;
  if (h < 0 || h > 23 || min < 0 || min > 59) return hhmm;
  const rounded = Math.floor(min / 5) * 5;
  return `${String(h).padStart(2, '0')}:${String(rounded).padStart(2, '0')}`;
}

/** @deprecated Alias — immer Down, mehr Puffer. */
export function roundClockHmmUpTo5(hhmm: string): string {
  return roundClockHmmDownTo5(hhmm);
}

const RUSH_MORNING_FROM = 6 * 60;
const RUSH_MORNING_TO = 9 * 60 + 30;
const RUSH_EVENING_FROM = 15 * 60;
const RUSH_EVENING_TO = 19 * 60;

function minsOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function isWeekdayRushAt(d: Date): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const mins = minsOfDay(d);
  return (
    (mins >= RUSH_MORNING_FROM && mins < RUSH_MORNING_TO) ||
    (mins >= RUSH_EVENING_FROM && mins < RUSH_EVENING_TO)
  );
}

/**
 * Taxi-Dauer mit Berufsverkehr (Mo–Fr 06:00–09:30 / 15:00–19:00),
 * wenn Start oder Ankunft in der Stoßzeit liegt. Sonst unverändert.
 */
export function taxiDurationWithRushHour(
  baseMin: number,
  leaveMs: number,
): number {
  const base = Math.max(1, Math.round(baseMin));
  if (!Number.isFinite(leaveMs)) return base;
  const start = new Date(leaveMs);
  const end = new Date(leaveMs + base * 60_000);
  if (!isWeekdayRushAt(start) && !isWeekdayRushAt(end)) return base;
  return Math.max(base + 5, Math.round(base * 1.35));
}

/** „17 Uhr“ / „17:30“ / „um 17“ → HH:mm (5-Min-Raster, abgerundet). */
export function parseClockHmm(text: string): string | null {
  const t = (text || '').toLowerCase();
  const m =
    t.match(/\b(?:um\s+)?(\d{1,2})[:.](\d{2})(?:\s*uhr)?\b/u) ||
    t.match(/\b(?:um\s+)?(\d{1,2})\s*uhr\b/u) ||
    t.match(/\b(?:vor(?:her)?|auf)\s+(\d{1,2})(?:[:.](\d{2}))?\b/u);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] != null ? Number(m[2]) : 0;
  if (!Number.isFinite(h) || h < 0 || h > 23) return null;
  if (!Number.isFinite(min) || min < 0 || min > 59) return null;
  return roundClockHmmDownTo5(
    `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
  );
}

/** Nächstes lokales Datum+Zeit als ISO (für Labels / Versuch Uber). */
export function nextLocalIsoForClock(hhmm: string, base = new Date()): string {
  const [hs, ms] = hhmm.split(':').map((x) => Number(x));
  const d = new Date(base);
  d.setSeconds(0, 0);
  d.setHours(hs, ms, 0, 0);
  if (d.getTime() <= base.getTime() - 60_000) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString();
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map((x) => Number(x));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate(),
  ).padStart(2, '0')}`;
}
