/**
 * Camping-and-Co — AWIN Camping (FR/EU stark, DE mid=16438).
 * Thematische Sites ~7 % · Cashback 3 % (Yorro = thematisch).
 * Tracking erst nach Awin-Freigabe zuverlässig — Links trotzdem nutzbar.
 */

import { env } from '../../config/env';

export const CAMPING_AND_CO_DE_AWIN_MID = '16438';
export const CAMPING_AND_CO_FR_AWIN_MID = '13348';

export type CampingAndCoMarket = 'de' | 'fr';

function midFor(market: CampingAndCoMarket): string {
  const fromEnv = env.campingAndCoAwinMid().trim();
  if (fromEnv) return fromEnv;
  return market === 'fr' ? CAMPING_AND_CO_FR_AWIN_MID : CAMPING_AND_CO_DE_AWIN_MID;
}

function hostFor(market: CampingAndCoMarket): string {
  return market === 'fr'
    ? 'https://fr.camping-and-co.com/'
    : 'https://de.camping-and-co.com/';
}

/** Heuristik: FR-Ziel → FR-Shop, sonst DE. */
export function campingAndCoMarketForQuery(
  cityOrQuery?: string | null,
): CampingAndCoMarket {
  const q = (cityOrQuery ?? '').toLowerCase();
  if (
    /\b(france|frankreich|bretagne|normandie|provence|côte\s*d['']?azur|cote\s*d['']?azur|atlantique|vendee|vendée|landes|camargue|dordogne|loire|alsace|elsass|corsica|korsika|paris|bordeaux|marseille|lyon|nantes|biarritz|arcachon)\b/iu.test(
      q,
    )
  ) {
    return 'fr';
  }
  return 'de';
}

export function isCampingAndCoUrl(url: string): boolean {
  return /camping-and-co\.com/i.test(String(url || ''));
}

export function getCampingAndCoLandingUrl(
  cityOrQuery?: string | null,
  market?: CampingAndCoMarket,
): string {
  const m = market ?? campingAndCoMarketForQuery(cityOrQuery);
  const base = hostFor(m);
  const q = (cityOrQuery ?? '').trim();
  if (!q) return base;
  try {
    const u = new URL(base);
    // Öffentliche Suche — Query als Suchbegriff (Portal-Suche)
    u.pathname = u.pathname.replace(/\/?$/, '/');
    u.searchParams.set('q', q);
    return u.toString();
  } catch {
    return base;
  }
}

function awinWrap(mid: string, landing: string): string {
  try {
    const { buildAwinClickUrl } = require('./affiliateService') as {
      buildAwinClickUrl: (o: {
        merchantId: string;
        destinationUrl: string;
      }) => string;
    };
    return buildAwinClickUrl({ merchantId: mid, destinationUrl: landing });
  } catch {
    return landing;
  }
}

export function getCampingAndCoUrl(
  destinationUrl?: string | null,
  cityOrQuery?: string | null,
  market?: CampingAndCoMarket,
): string {
  const destRaw = (destinationUrl ?? '').trim();
  let dest = destRaw;
  if (/awin1\.com\/cread\.php/i.test(destRaw)) {
    try {
      const { unwrapPartnerLandingUrl } = require('./hollowPartnerUrl') as {
        unwrapPartnerLandingUrl: (u: string) => string;
      };
      dest = unwrapPartnerLandingUrl(destRaw) || destRaw;
    } catch {
      dest = destRaw;
    }
  }
  const m = market ?? campingAndCoMarketForQuery(cityOrQuery || dest);
  const query = (cityOrQuery ?? '').trim();
  if (!dest && !query) {
    const fromEnv = env.campingAndCoAffiliateUrl().trim();
    if (fromEnv) return fromEnv;
  }
  const landing = dest || getCampingAndCoLandingUrl(query || null, m);
  if (/awin1\.com\/cread\.php/i.test(landing)) return landing;
  return awinWrap(midFor(m), landing);
}

export function buildCampingAndCoAction(opts?: {
  destinationUrl?: string | null;
  cityOrQuery?: string | null;
  market?: CampingAndCoMarket;
  label?: string;
}): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  const url = getCampingAndCoUrl(
    opts?.destinationUrl,
    opts?.cityOrQuery,
    opts?.market,
  );
  return {
    type: 'OPEN_URL',
    label: opts?.label?.trim() || '⛺ Camping-and-Co',
    payload: { url },
  };
}

export function preferCampingAndCoAffiliateUrl(url: string): string {
  if (!url || !isCampingAndCoUrl(url)) return url;
  return getCampingAndCoUrl(url);
}
