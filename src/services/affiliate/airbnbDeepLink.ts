/**
 * Airbnb deep-link — nur bei explizitem Airbnb-Intent (\bairbnb\b).
 * Keine Scraping-Preise: Search- oder Rooms-Deep-Link (Stadt/Daten/Gäste).
 * Live-Preise nur aus Grounding (Gemini + Google Search), nie erfunden.
 */

export type AirbnbSearchOpts = {
  city: string;
  checkin?: string | null;
  checkout?: string | null;
  adults?: number | null;
  children?: number | null;
};

const AIRBNB_TRACKING_PARAMS = new Set([
  'source_impression_id',
  'federated_search_id',
  'previous_page_section_name',
  'search_mode',
  'category_tag',
  'photo_id',
  'c',
  'unique_share_id',
  'virality_entry_point',
  's',
  'guests',
  'location',
]);

/** City → URL-Pfad-Slug (Berlin, Hamburg-Germany, …). */
export function slugifyAirbnbCity(city: string): string {
  const raw = String(city || '').trim();
  if (!raw) return 'homes';
  return (
    raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ä/gi, 'ae')
      .replace(/ö/gi, 'oe')
      .replace(/ü/gi, 'ue')
      .replace(/ß/g, 'ss')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'homes'
  );
}

export function getAirbnbSearchUrl(opts: AirbnbSearchOpts): string {
  const slug = slugifyAirbnbCity(opts.city);
  const params = new URLSearchParams();
  const checkin = String(opts.checkin || '').slice(0, 10);
  const checkout = String(opts.checkout || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(checkin)) params.set('checkin', checkin);
  if (/^\d{4}-\d{2}-\d{2}$/.test(checkout)) params.set('checkout', checkout);
  const adults =
    opts.adults != null && opts.adults > 0
      ? Math.min(16, Math.floor(opts.adults))
      : 0;
  if (adults > 0) params.set('adults', String(adults));
  const children =
    opts.children != null && opts.children > 0
      ? Math.min(16, Math.floor(opts.children))
      : 0;
  if (children > 0) params.set('children', String(children));
  const q = params.toString();
  return `https://www.airbnb.de/s/${slug}/homes${q ? `?${q}` : ''}`;
}

export function isAirbnbUrl(url: string): boolean {
  const u = String(url || '').trim();
  if (!u) return false;
  return /(?:^|\/\/)(?:www\.)?airbnb\.(?:com|de|at|ch)\b/i.test(u);
}

/** Numerische Room-ID aus Airbnb-/rooms/-URL (oder bare digits). */
export function extractAirbnbRoomId(urlOrId?: string | null): string | null {
  const raw = String(urlOrId || '').trim();
  if (!raw) return null;
  if (/^\d{6,20}$/.test(raw)) return raw;
  const m = raw.match(
    /airbnb\.(?:com|de|at|ch)\/(?:rooms|luxury\/listing)\/(\d+)/i,
  );
  if (m?.[1]) return m[1];
  const m2 = raw.match(/\/(?:rooms|luxury\/listing)\/(\d+)/i);
  return m2?.[1] || null;
}

function isAirbnbRoomsDeepUrl(url: string): boolean {
  return Boolean(extractAirbnbRoomId(url));
}

function clampPax(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n) || n < 0) return 0;
  return Math.min(16, Math.floor(n));
}

/** Konkrete Listing-URL: /rooms/{id}?check_in=&check_out=&adults=&children=&infants=0&pets=0 */
export function buildAirbnbRoomsUrl(
  roomId: string,
  opts: AirbnbSearchOpts,
): string {
  const id = extractAirbnbRoomId(roomId) || String(roomId || '').replace(/\D/g, '');
  if (!id) return getAirbnbSearchUrl(opts);
  const params = new URLSearchParams();
  const checkin = String(opts.checkin || '').slice(0, 10);
  const checkout = String(opts.checkout || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(checkin)) {
    params.set('check_in', checkin);
    params.set('checkin', checkin);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(checkout)) {
    params.set('check_out', checkout);
    params.set('checkout', checkout);
  }
  const adults = clampPax(opts.adults);
  params.set('adults', String(adults > 0 ? adults : 1));
  const children = clampPax(opts.children);
  params.set('children', String(children));
  params.set('infants', '0');
  params.set('pets', '0');
  return `https://www.airbnb.de/rooms/${id}?${params.toString()}`;
}

/**
 * Tracking strippen + Daten/Pax setzen.
 * Nur Rooms-URLs → buildAirbnbRoomsUrl; sonst Search-Prefill.
 */
export function normalizeAirbnbListingUrl(
  url: string,
  opts: AirbnbSearchOpts,
): string {
  const raw = String(url || '').trim();
  if (!raw) return getAirbnbSearchUrl(opts);
  const roomId = extractAirbnbRoomId(raw);
  if (roomId) return buildAirbnbRoomsUrl(roomId, opts);
  if (isAirbnbUrl(raw)) return withAirbnbStayPrefill(raw, opts);
  return raw;
}

function parseAirbnbPrefillFromUrl(url: string): Partial<AirbnbSearchOpts> {
  try {
    const u = new URL(url);
    const out: Partial<AirbnbSearchOpts> = {};
    const checkin =
      u.searchParams.get('check_in') || u.searchParams.get('checkin');
    const checkout =
      u.searchParams.get('check_out') || u.searchParams.get('checkout');
    const adults = u.searchParams.get('adults');
    const children = u.searchParams.get('children');
    if (checkin) out.checkin = checkin.slice(0, 10);
    if (checkout) out.checkout = checkout.slice(0, 10);
    const ad = adults != null ? Number(adults) : NaN;
    if (Number.isFinite(ad) && ad > 0) out.adults = Math.min(16, Math.floor(ad));
    const ch = children != null ? Number(children) : NaN;
    if (Number.isFinite(ch) && ch > 0) out.children = Math.min(16, Math.floor(ch));
    const m = u.pathname.match(/\/s\/([^/]+)/i);
    if (m?.[1]) {
      out.city = decodeURIComponent(m[1]).replace(/-/g, ' ');
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Härtet Airbnb-URLs mit Stadt/Daten/Pax.
 * - Nicht-Airbnb → unverändert
 * - /rooms/ Deep-Listing → IMMER opts Daten/Pax (overwrite), Tracking weg, check_in/check_out
 * - Search / bare Domain → immer `getAirbnbSearchUrl` (Stadt+Daten+Pax)
 */
export function withAirbnbStayPrefill(
  url: string,
  opts: AirbnbSearchOpts,
): string {
  const raw = String(url || '').trim();
  if (!raw || !isAirbnbUrl(raw)) return url;

  const roomId = extractAirbnbRoomId(raw);
  if (roomId) {
    return buildAirbnbRoomsUrl(roomId, opts);
  }

  const fromUrl = parseAirbnbPrefillFromUrl(raw);
  return getAirbnbSearchUrl({
    city: String(opts.city || fromUrl.city || '').trim() || 'homes',
    checkin: opts.checkin || fromUrl.checkin || null,
    checkout: opts.checkout || fromUrl.checkout || null,
    adults: opts.adults ?? fromUrl.adults ?? null,
    children: opts.children ?? fromUrl.children ?? null,
  });
}

/** Nur explizites Wort Airbnb — nicht jeder Apartment-Intent. */
export function wantsExplicitAirbnb(text?: string | null): boolean {
  return /\bairbnb\b/i.test(String(text || ''));
}

/** Apartment/Wohnung/Fewo-Intent — ohne Airbnb-Wort. */
const APARTMENT_LODGING_RE =
  /\b(ferienwohnung|wohnung|apartment|appartement|fewo|ferienhaus)\b/i;

export function wantsApartmentLodging(text?: string | null): boolean {
  return APARTMENT_LODGING_RE.test(String(text || ''));
}

/**
 * Soft Airbnb-Probe: explizit immer, sonst nur bei Apartment-Intent und dünnem Live-Inventar.
 * Soft-Probe ≠ Help-First-Moment / Search-CTA — nur Research/Inventory.
 */
export function shouldProbeAirbnb(opts: {
  text?: string | null;
  lodgingType?: 'hotel' | 'apartment' | 'any' | null;
  liveCount?: number;
  thinThreshold?: number;
}): boolean {
  if (wantsExplicitAirbnb(opts.text)) return true;
  const threshold =
    opts.thinThreshold != null && Number.isFinite(opts.thinThreshold)
      ? Math.max(0, Math.floor(opts.thinThreshold))
      : 2;
  const live = opts.liveCount != null && Number.isFinite(opts.liveCount) ? opts.liveCount : 0;
  if (live >= threshold) return false;
  return opts.lodgingType === 'apartment' || wantsApartmentLodging(opts.text);
}

export type AirbnbActionOpts = AirbnbSearchOpts & {
  roomId?: string | null;
  listingUrl?: string | null;
  name?: string | null;
  /** Live-Gesamtpreis aus Research/Grounding — nie erfinden. */
  priceTotalEur?: number | null;
};

export function buildAirbnbAction(opts: AirbnbActionOpts): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  const roomId =
    extractAirbnbRoomId(opts.roomId) ||
    extractAirbnbRoomId(opts.listingUrl) ||
    null;
  if (roomId) {
    const url = buildAirbnbRoomsUrl(roomId, opts);
    const name = String(opts.name || '').trim() || 'Airbnb';
    const price =
      opts.priceTotalEur != null &&
      Number.isFinite(opts.priceTotalEur) &&
      opts.priceTotalEur > 0
        ? Math.round(opts.priceTotalEur)
        : null;
    const label =
      price != null
        ? `🔑 ${name.slice(0, 28)} · ${price}€`
        : `🔑 ${name.slice(0, 36)}`;
    return {
      type: 'OPEN_URL',
      label: label.slice(0, 48),
      payload: { url },
    };
  }
  return {
    type: 'OPEN_URL',
    label: '🔑 Bei Airbnb öffnen',
    payload: { url: getAirbnbSearchUrl(opts) },
  };
}

/** @internal smoke / strip helpers */
export function stripAirbnbTrackingParams(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (AIRBNB_TRACKING_PARAMS.has(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return url;
  }
}
