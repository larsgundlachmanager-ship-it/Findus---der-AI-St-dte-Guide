/**
 * Gigsberg — Direct Affiliate API (Live-Events / Tickets).
 * Prod: https://integration2.gigsberg.com/v2
 * Auth: x-api-key · Tracking: ?aff=Yorro auf Event-URLs
 * ~9 % CPA (Direkt) · Sekundärmarkt (AGB-Hinweis in der App).
 */

import { env } from '../../config/env';

export const GIGSBERG_AFF_NAME_DEFAULT = 'Yorro';
export const GIGSBERG_PROD_BASE = 'https://integration2.gigsberg.com/v2';
export const GIGSBERG_TERMS_URL =
  'https://www.gigsberg.com/terms-and-conditions';

/** Kurz für Speech/Stichpunkte — Sekundärmarkt transparent. */
export const GIGSBERG_SECONDARY_DISCLOSURE_DE =
  'Tickets über Gigsberg (Marktplatz, Preise können über dem Originalpreis liegen).';

export function gigsbergAffName(): string {
  try {
    return env.gigsbergAffiliateName().trim() || GIGSBERG_AFF_NAME_DEFAULT;
  } catch {
    return GIGSBERG_AFF_NAME_DEFAULT;
  }
}

/** @deprecated use gigsbergAffName() */
export const GIGSBERG_AFF_NAME = GIGSBERG_AFF_NAME_DEFAULT;

export type GigsbergEvent = {
  id: number;
  name: string;
  date: string | null;
  time: string | null;
  fullDate: string | null;
  city: string | null;
  country: string | null;
  venue: string | null;
  venue_id: number | null;
  type_name: string | null;
  subType: string | null;
  performer1: string | null;
  performer2: string | null;
  url: string;
  min_price: number | null;
  min_price_listing: {
    price: number;
    fees: number;
    currency: string;
    currency_code: string;
  } | null;
  image: string | null;
};

export function isGigsbergUrl(url: string): boolean {
  return /gigsberg\.(com|co\.uk|de)/i.test(String(url || ''));
}

export function gigsbergApiKey(): string {
  return env.gigsbergApiKey().trim();
}

export function hasGigsbergApiKey(): boolean {
  return gigsbergApiKey().length >= 8;
}

/** Affiliate-Param erzwingen (API liefert oft schon aff=Yorro). */
export function withGigsbergAff(url: string): string {
  const raw = String(url || '').trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return raw;
  try {
    const u = new URL(raw);
    if (!/gigsberg\./i.test(u.hostname)) return raw;
    u.searchParams.set('aff', gigsbergAffName());
    return u.toString();
  } catch {
    return raw;
  }
}

export function getGigsbergLandingUrl(query?: string | null): string {
  const q = (query ?? '').trim();
  if (!q) {
    return withGigsbergAff('https://www.gigsberg.com/');
  }
  return withGigsbergAff(
    `https://www.gigsberg.com/en/search?q=${encodeURIComponent(q)}`,
  );
}

export type GigsbergSearchOpts = {
  name?: string | null;
  city?: string | null;
  country?: string | null;
  venue?: string | null;
  date?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  performer?: string | null;
  perPage?: number;
  signal?: AbortSignal;
};

function buildSearchQuery(opts: GigsbergSearchOpts): string {
  const u = new URL(`${GIGSBERG_PROD_BASE}/event/search`);
  const set = (k: string, v: string | number | null | undefined) => {
    if (v == null || v === '') return;
    u.searchParams.set(k, String(v));
  };
  set('name', opts.name?.trim());
  set('city', opts.city?.trim());
  set('country', opts.country?.trim() || 'Germany');
  set('venue', opts.venue?.trim());
  set('date', opts.date?.trim());
  set('date_from', opts.dateFrom?.trim());
  set('date_to', opts.dateTo?.trim());
  set('performer1', opts.performer?.trim());
  set('per_page', Math.max(1, Math.min(opts.perPage ?? 12, 50)));
  set('sort_by', 'date');
  set('sort_order', 'asc');
  return u.toString();
}

function mapEvent(raw: Record<string, unknown>): GigsbergEvent | null {
  const id = typeof raw.id === 'number' ? raw.id : Number(raw.id);
  if (!Number.isFinite(id)) return null;
  const urlRaw = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!urlRaw) return null;
  const listing =
    raw.min_price_listing && typeof raw.min_price_listing === 'object'
      ? (raw.min_price_listing as Record<string, unknown>)
      : null;
  const minPrice =
    typeof raw.min_price === 'number'
      ? raw.min_price
      : typeof listing?.price === 'number'
        ? listing.price
        : null;
  return {
    id,
    name: String(raw.name ?? '').trim() || `Event ${id}`,
    date: typeof raw.date === 'string' ? raw.date : null,
    time: typeof raw.time === 'string' ? raw.time : null,
    fullDate: typeof raw.fullDate === 'string' ? raw.fullDate : null,
    city: typeof raw.city === 'string' ? raw.city : null,
    country: typeof raw.country === 'string' ? raw.country : null,
    venue: typeof raw.venue === 'string' ? raw.venue : null,
    venue_id: typeof raw.venue_id === 'number' ? raw.venue_id : null,
    type_name: typeof raw.type_name === 'string' ? raw.type_name : null,
    subType: typeof raw.subType === 'string' ? raw.subType : null,
    performer1: typeof raw.performer1 === 'string' ? raw.performer1 : null,
    performer2: typeof raw.performer2 === 'string' ? raw.performer2 : null,
    url: withGigsbergAff(urlRaw),
    min_price: minPrice,
    min_price_listing:
      listing && typeof listing.price === 'number'
        ? {
            price: listing.price,
            fees: typeof listing.fees === 'number' ? listing.fees : 0,
            currency: String(listing.currency ?? 'EURO'),
            currency_code: String(listing.currency_code ?? 'EUR'),
          }
        : null,
    image: typeof raw.image === 'string' ? raw.image : null,
  };
}

export async function searchGigsbergEvents(
  opts: GigsbergSearchOpts,
): Promise<GigsbergEvent[]> {
  const key = gigsbergApiKey();
  if (!key) return [];
  const hasFilter = Boolean(
    opts.name?.trim() ||
      opts.city?.trim() ||
      opts.venue?.trim() ||
      opts.performer?.trim() ||
      opts.date?.trim(),
  );
  if (!hasFilter) return [];

  try {
    const res = await fetch(buildSearchQuery(opts), {
      method: 'POST',
      signal: opts.signal,
      headers: {
        Accept: 'application/json',
        'x-api-key': key,
      },
    });
    if (!res.ok) {
      if (__DEV__) {
        console.warn('[gigsberg] search http', res.status);
      }
      return [];
    }
    const data = (await res.json()) as { items?: unknown[] };
    if (!Array.isArray(data.items)) return [];
    const out: GigsbergEvent[] = [];
    for (const row of data.items) {
      if (!row || typeof row !== 'object') continue;
      const ev = mapEvent(row as Record<string, unknown>);
      if (ev) out.push(ev);
    }
    return out;
  } catch (err) {
    if (__DEV__) console.warn('[gigsberg] search fail', err);
    return [];
  }
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9äöüß\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreMatch(
  ev: GigsbergEvent,
  q: { name?: string | null; venue?: string | null; city?: string | null },
): number {
  let score = 0;
  const nameQ = norm(q.name || '');
  const venueQ = norm(q.venue || '');
  const cityQ = norm(q.city || '');
  const blob = norm(
    `${ev.name} ${ev.venue || ''} ${ev.performer1 || ''} ${ev.city || ''}`,
  );
  if (nameQ && blob.includes(nameQ)) score += 40;
  else if (nameQ) {
    const parts = nameQ.split(' ').filter((w) => w.length > 2);
    const hits = parts.filter((w) => blob.includes(w)).length;
    score += Math.min(30, hits * 8);
  }
  if (venueQ && norm(ev.venue || '').includes(venueQ)) score += 35;
  else if (venueQ && blob.includes(venueQ)) score += 20;
  if (cityQ && norm(ev.city || '') === cityQ) score += 15;
  else if (cityQ && norm(ev.city || '').includes(cityQ)) score += 8;
  if (ev.min_price != null && ev.min_price > 0) score += 5;
  return score;
}

/**
 * Bestes Event für Venue/Stadt/Titel — Deep-Link + optionaler Min-Preis.
 */
export async function findBestGigsbergTicket(opts: {
  subject?: string | null;
  venue?: string | null;
  city?: string | null;
  performer?: string | null;
  dateIso?: string | null;
  signal?: AbortSignal;
}): Promise<{
  url: string;
  title: string;
  whenLabel: string | null;
  priceEur: number | null;
  venue: string | null;
  city: string | null;
  eventId: number;
} | null> {
  if (!hasGigsbergApiKey()) return null;
  const venue = opts.venue?.trim() || opts.subject?.trim() || null;
  const city = opts.city?.trim() || null;
  const name = opts.performer?.trim() || opts.subject?.trim() || null;

  const attempts: GigsbergSearchOpts[] = [];
  if (venue && city) {
    attempts.push({
      venue,
      city,
      country: 'Germany',
      dateFrom: opts.dateIso || undefined,
      signal: opts.signal,
      perPage: 20,
    });
  }
  if (name && city) {
    attempts.push({
      name,
      city,
      country: 'Germany',
      dateFrom: opts.dateIso || undefined,
      signal: opts.signal,
      perPage: 20,
    });
  }
  if (venue) {
    attempts.push({
      venue,
      country: 'Germany',
      signal: opts.signal,
      perPage: 15,
    });
  }
  if (city && !venue) {
    attempts.push({
      city,
      country: 'Germany',
      name: name || undefined,
      signal: opts.signal,
      perPage: 15,
    });
  }

  let best: GigsbergEvent | null = null;
  let bestScore = 0;
  for (const a of attempts) {
    const hits = await searchGigsbergEvents(a);
    for (const ev of hits) {
      const s = scoreMatch(ev, {
        name: opts.subject || opts.performer,
        venue: opts.venue || opts.subject,
        city,
      });
      if (s > bestScore) {
        bestScore = s;
        best = ev;
      }
    }
    if (bestScore >= 50) break;
  }
  if (!best || bestScore < 20) return null;

  const when =
    best.date && best.time
      ? `${best.date} ${String(best.time).slice(0, 5)}`
      : best.date;

  return {
    url: best.url,
    title: best.name,
    whenLabel: when,
    priceEur: best.min_price,
    venue: best.venue,
    city: best.city,
    eventId: best.id,
  };
}

export function buildGigsbergAction(opts?: {
  destinationUrl?: string | null;
  cityOrQuery?: string | null;
  label?: string;
}): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  const dest = (opts?.destinationUrl ?? '').trim();
  const url =
    dest && isGigsbergUrl(dest)
      ? withGigsbergAff(dest)
      : getGigsbergLandingUrl(opts?.cityOrQuery);
  return {
    type: 'OPEN_URL',
    label: opts?.label?.trim() || '🎫 Tickets bei Gigsberg',
    payload: { url },
  };
}

export function preferGigsbergAffiliateUrl(url: string): string {
  if (!url || !isGigsbergUrl(url)) return url;
  return withGigsbergAff(url);
}
