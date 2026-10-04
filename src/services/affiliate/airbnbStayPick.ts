/**
 * Airbnb stay pick — brand-first + same-house cheaper-elsewhere.
 * Rein (kein RN). Keine Fake-Airbnb-Preise: Search-Link ohne partnerPriceEur.
 *
 * Same-house Preisvergleich nur bei:
 * - Airbnb rooms-URL Identity + zweitem bepreistem Partner gleicher Identity, oder
 * - identischem stay:name:city:dates mit ≥2 bepreisten Partnern.
 */

import {
  pickAffiliateOffer,
  type AffiliateOfferCandidate,
} from './affiliatePickOffer';
import { userWantsCheapest } from './quoteIdentity';
import {
  extractAirbnbRoomId,
  getAirbnbSearchUrl,
  isAirbnbUrl,
  wantsExplicitAirbnb,
} from './airbnbDeepLink';

function commissionFor(id: 'expedia' | 'stay22'): number {
  try {
    const { commissionScoreForId } = require('./affiliateRegistry') as {
      commissionScoreForId: (id: string) => number;
    };
    return commissionScoreForId(id);
  } catch {
    return id === 'expedia' ? 82 : 68;
  }
}
export type AirbnbLiveStay = {
  name: string;
  priceEur?: number | null;
  bookUrl?: string | null;
};

export type AirbnbStayPickOpts = {
  city: string;
  checkin?: string | null;
  checkout?: string | null;
  adults?: number | null;
  children?: number | null;
  userText?: string | null;
  liveStays?: AirbnbLiveStay[];
};

export function normalizeStayName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/gi, 'ae')
    .replace(/ö/gi, 'oe')
    .replace(/ü/gi, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function airbnbRoomsIdFromUrl(url: string): string | null {
  return extractAirbnbRoomId(url);
}

function datesKey(checkin?: string | null, checkout?: string | null): string {
  return `${String(checkin || '').slice(0, 10)}_${String(checkout || '').slice(0, 10)}`;
}

function partnerFromBookUrl(bookUrl: string): {
  id: string;
  label: string;
  commissionScore: number;
} {
  const u = bookUrl.toLowerCase();
  if (/expedia\./i.test(u)) {
    return {
      id: 'expedia',
      label: 'Expedia',
      commissionScore: commissionFor('expedia'),
    };
  }
  if (/stay22\./i.test(u) || /allez\//i.test(u)) {
    return {
      id: 'stay22',
      label: 'Stay22',
      commissionScore: commissionFor('stay22'),
    };
  }
  if (isAirbnbUrl(bookUrl)) {
    return { id: 'airbnb', label: 'Airbnb', commissionScore: 0 };
  }
  // Unbekannt → Stay22-Bandbreite (Live-Partner-Fallback)
  return {
    id: 'stay22',
    label: 'Stay22',
    commissionScore: commissionFor('stay22'),
  };
}

function livePrice(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Wenn Airbnb-rooms und Partner denselben Namen+Stadt+Daten teilen,
 * Identity angleichen — sonst kein Same-House-Vergleich möglich.
 */
function unifySameHouseIdentities(
  cands: AffiliateOfferCandidate[],
  city: string,
  dates: string,
): AffiliateOfferCandidate[] {
  const byName = new Map<string, AffiliateOfferCandidate[]>();
  for (const c of cands) {
    if (c.id === 'airbnb' && c.deepLinkLevel === 'search') continue;
    const fromStay = String(c.identity || '').startsWith('stay:')
      ? String(c.identity).split(':')[1] || ''
      : '';
    const fromLabel = String(c.label || '')
      .replace(/^(Airbnb|Expedia|Stay22)\s*[·|:—-]\s*/i, '')
      .trim();
    const norm = normalizeStayName(fromStay || fromLabel);
    if (!norm) continue;
    const list = byName.get(norm) ?? [];
    list.push(c);
    byName.set(norm, list);
  }
  const rewrite = new Map<string, string>();
  for (const [norm, group] of byName) {
    const priced = group.filter((c) => livePrice(c.partnerPriceEur) != null);
    if (priced.length < 2) continue;
    const hasAirbnbRooms = group.some((c) =>
      String(c.identity || '').startsWith('airbnb:rooms:'),
    );
    const hasPartner = group.some(
      (c) =>
        c.id === 'expedia' ||
        c.id === 'stay22' ||
        String(c.id).startsWith('expedia:') ||
        String(c.id).startsWith('stay22:'),
    );
    // Nur angleichen wenn Rooms + Partner denselben Namen teilen
    if (!hasAirbnbRooms || !hasPartner) continue;
    const shared = `stay:${norm}:${city.toLowerCase()}:${dates}`;
    for (const c of group) {
      rewrite.set(`${c.id}|${c.url || ''}`, shared);
    }
  }
  if (!rewrite.size) return cands;
  return cands.map((c) => {
    const next = rewrite.get(`${c.id}|${c.url || ''}`);
    return next ? { ...c, identity: next } : c;
  });
}

export function buildAirbnbStayCandidates(
  opts: AirbnbStayPickOpts,
): AffiliateOfferCandidate[] {
  const city = String(opts.city || '').trim() || 'Germany';
  const dates = datesKey(opts.checkin, opts.checkout);
  const cityKey = city.toLowerCase();
  const out: AffiliateOfferCandidate[] = [];
  const explicit = wantsExplicitAirbnb(opts.userText);

  if (explicit) {
    out.push({
      id: 'airbnb',
      label: 'Airbnb',
      url: getAirbnbSearchUrl({
        city,
        checkin: opts.checkin,
        checkout: opts.checkout,
        adults: opts.adults,
        children: opts.children,
      }),
      commissionScore: 0,
      deepLinkLevel: 'search',
      partnerPriceEur: null,
      identity: `airbnb-search:${cityKey}:${dates}`,
    });
  }

  const stays = opts.liveStays ?? [];
  for (let i = 0; i < stays.length; i++) {
    const stay = stays[i]!;
    const bookUrl = String(stay.bookUrl || '').trim();
    if (!bookUrl || !/^https?:\/\//i.test(bookUrl)) continue;
    const roomsId = airbnbRoomsIdFromUrl(bookUrl);
    const norm = normalizeStayName(stay.name);
    const partner = partnerFromBookUrl(bookUrl);
    const price = livePrice(stay.priceEur ?? null);
    let identity: string;
    if (roomsId) {
      identity = `airbnb:rooms:${roomsId}`;
    } else if (norm) {
      identity = `stay:${norm}:${cityKey}:${dates}`;
    } else {
      identity = `stay:unknown-${i}:${cityKey}:${dates}`;
    }
    out.push({
      id: roomsId
        ? `airbnb:rooms:${roomsId}`
        : `${partner.id}:${norm || i}`,
      label: stay.name?.trim()
        ? `${partner.label} · ${stay.name.trim().slice(0, 40)}`
        : partner.label,
      url: bookUrl,
      commissionScore: roomsId ? 0 : partner.commissionScore,
      deepLinkLevel: roomsId ? 'deep' : 'deep',
      partnerPriceEur: price,
      identity,
    });
  }

  return unifySameHouseIdentities(out, cityKey, dates);
}

function hasComparablePricedPair(cands: AffiliateOfferCandidate[]): boolean {
  const groups = new Map<string, AffiliateOfferCandidate[]>();
  for (const c of cands) {
    const id = String(c.identity || '').trim();
    if (!id || id.startsWith('airbnb-search:')) continue;
    const list = groups.get(id) ?? [];
    list.push(c);
    groups.set(id, list);
  }
  for (const g of groups.values()) {
    if (g.filter((c) => livePrice(c.partnerPriceEur) != null).length >= 2) {
      return true;
    }
  }
  return false;
}

export type AirbnbStayAction = {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
};

/**
 * 1 primary + optional secondary via pickAffiliateOffer.
 * Explizites Airbnb ohne vergleichbares Same-House-Paar → Airbnb-Suche primär,
 * günstigster Live-Stay sekundär (ohne Fake-Same-House-Claim).
 */
export function pickAirbnbStayActions(
  opts: AirbnbStayPickOpts,
): AirbnbStayAction[] {
  const cands = buildAirbnbStayCandidates(opts);
  if (!cands.length) return [];

  const explicit = wantsExplicitAirbnb(opts.userText);
  const comparable = hasComparablePricedPair(cands);
  const airbnbSearch = cands.find(
    (c) => c.id === 'airbnb' && c.deepLinkLevel === 'search',
  );
  const liveOnly = cands.filter(
    (c) => !(c.id === 'airbnb' && c.deepLinkLevel === 'search'),
  );

  let primary: AffiliateOfferCandidate | null = null;
  let secondary: AffiliateOfferCandidate | null = null;

  if (explicit && !comparable && airbnbSearch) {
    primary = airbnbSearch;
    const pricedLive = [...liveOnly]
      .filter((c) => livePrice(c.partnerPriceEur) != null)
      .sort(
        (a, b) =>
          (livePrice(a.partnerPriceEur) ?? 1e9) -
          (livePrice(b.partnerPriceEur) ?? 1e9),
      );
    secondary =
      pricedLive[0] ??
      liveOnly.find((c) => c.url && c.url !== airbnbSearch.url) ??
      null;
  } else {
    primary =
      pickAffiliateOffer(cands, {
        userWantsCheapest: userWantsCheapest(opts.userText),
      }) || cands[0]!;
    // Prefer Airbnb as secondary when partner won same-house
    const isAirbnbCand = (c: AffiliateOfferCandidate) =>
      c.id === 'airbnb' || String(c.id).startsWith('airbnb:');
    if (primary && !isAirbnbCand(primary)) {
      secondary =
        cands.find(
          (c) =>
            c !== primary &&
            String(c.id).startsWith('airbnb:rooms:') &&
            c.url !== primary.url,
        ) ??
        (airbnbSearch && airbnbSearch.url !== primary.url
          ? airbnbSearch
          : null) ??
        cands.find(
          (c) => c !== primary && isAirbnbCand(c) && c.url !== primary.url,
        ) ??
        cands.find((c) => c !== primary && c.url !== primary.url) ??
        null;
    } else {
      secondary =
        cands.find((c) => c !== primary && c.url !== primary?.url) ?? null;
    }
  }

  if (!primary?.url) return [];

  const out: AirbnbStayAction[] = [
    {
      type: 'OPEN_URL',
      label: primaryLabel(primary).slice(0, 48),
      payload: { url: primary.url },
    },
  ];
  if (secondary?.url && secondary.url !== primary.url) {
    out.push({
      type: 'OPEN_URL',
      label: secondaryLabel(secondary).slice(0, 48),
      payload: { url: secondary.url },
    });
  }
  return out.slice(0, 2);
}

function primaryLabel(c: AffiliateOfferCandidate): string {
  if (c.id === 'airbnb' && c.deepLinkLevel === 'search') {
    return '🔑 Bei Airbnb öffnen';
  }
  if (c.id === 'airbnb' || String(c.id).startsWith('airbnb:')) {
    return '🔑 Bei Airbnb öffnen';
  }
  if (c.id === 'expedia') return '🏨 Bei Expedia öffnen';
  if (c.id === 'stay22') return '🏨 Bei Stay22 öffnen';
  return c.label?.slice(0, 40) || '🏨 Unterkunft öffnen';
}

function secondaryLabel(c: AffiliateOfferCandidate): string {
  if (c.id === 'airbnb' || String(c.id).startsWith('airbnb:')) {
    return '🔑 Auch bei Airbnb';
  }
  if (c.id === 'expedia') return '🏨 Auch bei Expedia';
  if (c.id === 'stay22') return '🏨 Auch bei Stay22';
  return `🔑 Auch: ${(c.label || 'Partner').slice(0, 28)}`;
}

/** Convenience: nur Primary-URL (z. B. stayBookUrl). */
export function pickAirbnbStayBookUrl(
  opts: AirbnbStayPickOpts,
): string | null {
  return pickAirbnbStayActions(opts)[0]?.payload.url ?? null;
}
