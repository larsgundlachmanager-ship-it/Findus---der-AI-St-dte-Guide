/**
 * Lidl Reisen DE — AWIN Pauschal (mid=11773).
 * ~4 % CPO (2 % mit Gutschein). Freigabe Publisher 3021215.
 * Parallel zu CHECK24 / AIDU / Magic Life — nie als Fake-Stay.
 * FR/DE: lidl-reisen.de (DE-Landing).
 */

export const LIDL_REISEN_AWIN_MID = '11773';
export const LIDL_REISEN_LANDING = 'https://www.lidl-reisen.de/';
/** Kreuzfahrt-Rubrik — provisionsfähig über denselben AWIN mid=11773. */
export const LIDL_REISEN_CRUISE_LANDING = 'https://www.lidl-reisen.de/kreuzfahrten';

export function isLidlReisenUrl(url: string): boolean {
  return /lidl-reisen\.de|awin1\.com\/cread\.php.*11773/i.test(String(url || ''));
}

/** Soft-Suche: Ziel als `q` — Lidl hat keine stabile öffentliche Deep-API. */
export function getLidlReisenLandingUrl(cityOrQuery?: string | null): string {
  const q = (cityOrQuery ?? '').trim();
  if (!q) return LIDL_REISEN_LANDING;
  try {
    const u = new URL(LIDL_REISEN_LANDING);
    u.searchParams.set('q', q);
    return u.toString();
  } catch {
    return LIDL_REISEN_LANDING;
  }
}

/** Kreuzfahrt-Deep-Link (Pfad /kreuzfahrten, optional `q`). */
export function getLidlReisenCruiseLandingUrl(cityOrQuery?: string | null): string {
  const q = (cityOrQuery ?? '').trim();
  if (!q) return LIDL_REISEN_CRUISE_LANDING;
  try {
    const u = new URL(LIDL_REISEN_CRUISE_LANDING);
    u.searchParams.set('q', q);
    return u.toString();
  } catch {
    return LIDL_REISEN_CRUISE_LANDING;
  }
}

export function getLidlReisenCruiseUrl(cityOrQuery?: string | null): string {
  return getLidlReisenUrl(getLidlReisenCruiseLandingUrl(cityOrQuery));
}

export function buildLidlReisenCruiseAction(opts?: {
  cityOrQuery?: string | null;
  label?: string;
}): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  return {
    type: 'OPEN_URL',
    label: opts?.label?.trim() || '🛳️ Lidl Kreuzfahrt',
    payload: {
      url: getLidlReisenCruiseUrl(opts?.cityOrQuery),
    },
  };
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
      merchantId: LIDL_REISEN_AWIN_MID,
      destinationUrl: landing,
    });
  } catch {
    return landing;
  }
}

function envOverride(): string {
  try {
    return String(process.env.EXPO_PUBLIC_LIDL_REISEN_AFFILIATE_URL || '').trim();
  } catch {
    return '';
  }
}

export function getLidlReisenUrl(
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
  const landing = dest || getLidlReisenLandingUrl(query || null);
  if (/awin1\.com\/cread\.php/i.test(landing)) return landing;
  return awinWrap(landing);
}

export function buildLidlReisenAction(opts?: {
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
    label: opts?.label?.trim() || '🧳 Lidl Reisen',
    payload: {
      url: getLidlReisenUrl(opts?.destinationUrl, opts?.cityOrQuery),
    },
  };
}

export function preferLidlReisenAffiliateUrl(url: string): string {
  if (!url || !isLidlReisenUrl(url)) return url;
  return getLidlReisenUrl(url);
}
