/**
 * TUI Magic Life DE — AWIN Club-/All-inclusive (mid=15933).
 * ~4 % auf Pauschal (Ø Warenkorb hoch). Freigabe Publisher 3021215.
 */

import { env } from '../../config/env';

export const MAGIC_LIFE_AWIN_MID = '15933';
export const MAGIC_LIFE_LANDING = 'https://www.magiclife.com/';

export function isMagicLifeUrl(url: string): boolean {
  return /magiclife\.com|awin1\.com\/cread\.php.*15933/i.test(String(url || ''));
}

export function getMagicLifeLandingUrl(query?: string | null): string {
  const q = (query ?? '').trim();
  if (!q) return MAGIC_LIFE_LANDING;
  try {
    const u = new URL(MAGIC_LIFE_LANDING);
    u.searchParams.set('q', q);
    return u.toString();
  } catch {
    return MAGIC_LIFE_LANDING;
  }
}

function awinWrap(landing: string): string {
  try {
    const { buildAwinClickUrl } = require('./affiliateService') as {
      buildAwinClickUrl: (o: {
        merchantId: string;
        destinationUrl: string;
      }) => string;
    };
    return buildAwinClickUrl({
      merchantId: MAGIC_LIFE_AWIN_MID,
      destinationUrl: landing,
    });
  } catch {
    return landing;
  }
}

export function getMagicLifeUrl(
  destinationUrl?: string | null,
  cityOrQuery?: string | null,
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
  const query = (cityOrQuery ?? '').trim();
  if (!dest && !query) {
    const fromEnv = env.magicLifeAffiliateUrl().trim();
    if (fromEnv) return fromEnv;
  }
  const landing = dest || getMagicLifeLandingUrl(query || null);
  if (/awin1\.com\/cread\.php/i.test(landing)) return landing;
  return awinWrap(landing);
}

export function buildMagicLifeAction(opts?: {
  destinationUrl?: string | null;
  cityOrQuery?: string | null;
  label?: string;
}): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  return {
    type: 'OPEN_URL',
    label: opts?.label?.trim() || '🏝️ Magic Life Club',
    payload: {
      url: getMagicLifeUrl(opts?.destinationUrl, opts?.cityOrQuery),
    },
  };
}

export function preferMagicLifeAffiliateUrl(url: string): string {
  if (!url || !isMagicLifeUrl(url)) return url;
  return getMagicLifeUrl(url);
}
