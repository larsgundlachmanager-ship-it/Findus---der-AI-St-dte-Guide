/**
 * AIDA Cruises DE — AWIN Kreuzfahrt (mid=9144).
 * ~7 % vom Reisepreis (Kampagnen bis ~8 %). Freigabe Publisher 3021215.
 * Parallel zu Lidl Reisen Kreuzfahrt / CHECK24 — nie als Fake-Stay.
 */

export const AIDA_AWIN_MID = '9144';
export const AIDA_LANDING = 'https://www.aida.de/';

export function isAidaUrl(url: string): boolean {
  return /aida\.de|awin1\.com\/cread\.php.*9144/i.test(String(url || ''));
}

/** Soft: Query als `q` — AIDA hat keine stabile öffentliche Deep-API. */
export function getAidaLandingUrl(cityOrQuery?: string | null): string {
  const q = (cityOrQuery ?? '').trim();
  if (!q) return AIDA_LANDING;
  try {
    const u = new URL(AIDA_LANDING);
    u.searchParams.set('q', q);
    return u.toString();
  } catch {
    return AIDA_LANDING;
  }
}

function awinWrap(landing: string): string {
  try {
    const { buildAwinClickUrl } = require('./awinClick') as {
      buildAwinClickUrl: (o: {
        merchantId: string;
        destinationUrl: string;
      }) => string;
    };
    return buildAwinClickUrl({
      merchantId: AIDA_AWIN_MID,
      destinationUrl: landing,
    });
  } catch {
    return landing;
  }
}

function envOverride(): string {
  try {
    return String(process.env.EXPO_PUBLIC_AIDA_AFFILIATE_URL || '').trim();
  } catch {
    return '';
  }
}

export function getAidaUrl(
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
    const fromEnv = envOverride();
    if (fromEnv) return fromEnv;
  }
  const landing = dest || getAidaLandingUrl(query || null);
  if (/awin1\.com\/cread\.php/i.test(landing)) return landing;
  return awinWrap(landing);
}

export function buildAidaAction(opts?: {
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
    label: opts?.label?.trim() || '🛳️ AIDA Kreuzfahrt',
    payload: {
      url: getAidaUrl(opts?.destinationUrl, opts?.cityOrQuery),
    },
  };
}

export function preferAidaAffiliateUrl(url: string): string {
  if (!url || !isAidaUrl(url)) return url;
  return getAidaUrl(url);
}
