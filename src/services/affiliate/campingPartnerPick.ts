/**
 * Camping multi-partner pick — camping.info + Camping-and-Co.
 * Immer vergleichen wenn mehrere Partner für dasselbe Ziel existieren.
 * Rein (kein RN) — Preis vs. Provision via pickAffiliateOffer.
 */

import {
  pickAffiliateOffer,
  type AffiliateOfferCandidate,
} from './affiliatePickOffer';
import { commissionScoreForId } from './affiliateRegistry';
import { userWantsCheapest } from './quoteIdentity';
import {
  getCampingInfoCampsiteLandingUrl,
  getCampingInfoUrl,
} from './affiliateService';
import { getCampingAndCoUrl } from './campingAndCoAffiliate';

export type CampingPickOpts = {
  city?: string | null;
  campsiteName?: string | null;
  campsiteSlug?: string | null;
  arrival?: string | null;
  departure?: string | null;
  adults?: number | null;
  userText?: string | null;
  /** Live-Preise wenn belegt (gleiche Identity). */
  priced?: Array<{
    partnerId: 'camping_info' | 'camping_and_co';
    priceEur: number | null;
    url?: string | null;
  }>;
};

function campingIdentity(opts: CampingPickOpts): string {
  const city = (opts.city || '').trim().toLowerCase().replace(/\s+/g, '-');
  const site = (
    opts.campsiteSlug ||
    opts.campsiteName ||
    opts.city ||
    'camping'
  )
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/gi, '-')
    .replace(/-+/g, '-')
    .slice(0, 48);
  const dates = [opts.arrival || '', opts.departure || ''].join('_');
  return `camping:${city || 'x'}:${site}:${dates}`;
}

export function buildCampingPartnerCandidates(
  opts: CampingPickOpts,
): AffiliateOfferCandidate[] {
  const identity = campingIdentity(opts);
  const cityOrQuery =
    opts.campsiteName?.trim() || opts.city?.trim() || null;
  const adults = opts.adults ?? 2;

  const stayOpts = {
    arrival: opts.arrival,
    departure: opts.departure,
    adults,
  };

  let infoDest: string | null = null;
  if (opts.campsiteSlug?.trim() || opts.campsiteName?.trim()) {
    infoDest = getCampingInfoCampsiteLandingUrl(
      opts.campsiteSlug?.trim() || opts.campsiteName!.trim(),
      stayOpts,
    );
  }
  const infoUrl = getCampingInfoUrl(
    infoDest,
    opts.campsiteName ? null : opts.city,
    stayOpts,
  );
  const coUrl = getCampingAndCoUrl(null, cityOrQuery);

  const priceFor = (
    id: 'camping_info' | 'camping_and_co',
  ): number | null => {
    const hit = opts.priced?.find((p) => p.partnerId === id);
    return hit && typeof hit.priceEur === 'number' && hit.priceEur > 0
      ? hit.priceEur
      : null;
  };
  const urlOverride = (
    id: 'camping_info' | 'camping_and_co',
    fallback: string,
  ): string => {
    const hit = opts.priced?.find((p) => p.partnerId === id);
    return hit?.url?.trim() || fallback;
  };

  return [
    {
      id: 'camping_info',
      label: 'camping.info',
      url: urlOverride('camping_info', infoUrl),
      commissionScore: commissionScoreForId('camping_info'),
      deepLinkLevel: infoDest ? 'deep' : 'search',
      partnerPriceEur: priceFor('camping_info'),
      identity,
    },
    {
      id: 'camping_and_co',
      label: 'Camping-and-Co',
      url: urlOverride('camping_and_co', coUrl),
      commissionScore: commissionScoreForId('camping_and_co'),
      deepLinkLevel: 'search',
      partnerPriceEur: priceFor('camping_and_co'),
      identity,
    },
  ];
}

export function pickCampingBookingOffer(
  opts: CampingPickOpts,
): AffiliateOfferCandidate | null {
  const cands = buildCampingPartnerCandidates(opts);
  return pickAffiliateOffer(cands, {
    userWantsCheapest: userWantsCheapest(opts.userText),
  });
}

export type CampingBookingAction = {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
};

/**
 * Primär = Pick-Gewinner; Zweit = anderer Partner („Auch bei …“).
 */
export function buildCampingBookingActions(
  opts: CampingPickOpts,
): CampingBookingAction[] {
  const cands = buildCampingPartnerCandidates(opts);
  const pick =
    pickAffiliateOffer(cands, {
      userWantsCheapest: userWantsCheapest(opts.userText),
    }) || cands[0];
  if (!pick) return [];

  const other = cands.find((c) => c.id !== pick.id) ?? null;
  const primaryLabel =
    pick.id === 'camping_and_co'
      ? opts.campsiteName?.trim()
        ? `⛺ ${opts.campsiteName.trim()} (Camping-and-Co)`
        : '⛺ Camping bei Camping-and-Co'
      : opts.campsiteName?.trim()
        ? `⛺ ${opts.campsiteName.trim()} öffnen`
        : '⛺ Camping suchen';

  const out: CampingBookingAction[] = [
    {
      type: 'OPEN_URL',
      label: primaryLabel.slice(0, 48),
      payload: { url: pick.url },
    },
  ];
  if (other?.url && other.url !== pick.url) {
    out.push({
      type: 'OPEN_URL',
      label:
        other.id === 'camping_and_co'
          ? '⛺ Auch bei Camping-and-Co'
          : '⛺ Auch bei camping.info',
      payload: { url: other.url },
    });
  }
  return out.slice(0, 2);
}
