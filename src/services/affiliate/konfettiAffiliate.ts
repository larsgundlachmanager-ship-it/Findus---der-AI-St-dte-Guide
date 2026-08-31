/**
 * Konfetti / gokonfetti — AWIN Affiliate (Workshops, Weinproben).
 * Event-Pfad `/de-de/e/{slug}/` durchreichen; `qid` ist Session — nicht erfinden.
 */

import { env } from '../../config/env';
import {
  isKonfettiEventUrl,
  sanitizeKonfettiUrl,
} from './partnerBookingDeepLink';

export const KONFETTI_AWIN_MID = '31804';
export { isKonfettiEventUrl, sanitizeKonfettiUrl };

export function getKonfettiLandingUrl(cityOrQuery?: string | null): string {
  const q = (cityOrQuery ?? '').trim();
  if (!q) return 'https://www.gokonfetti.com/de-de/';
  return `https://www.gokonfetti.com/de-de/search/?q=${encodeURIComponent(q)}`;
}

export function isKonfettiUrl(url: string): boolean {
  return /gokonfetti\.com|\bkonfetti\.|confetti\./i.test(url);
}

export function getKonfettiUrl(
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
      dest = sanitizeKonfettiUrl(unwrapPartnerLandingUrl(destRaw) || destRaw);
    } catch {
      dest = destRaw;
    }
  } else if (destRaw) {
    dest = sanitizeKonfettiUrl(destRaw);
  }
  const query = (cityOrQuery ?? '').trim();
  const landing = dest || getKonfettiLandingUrl(query || null);
  if (/awin1\.com\/cread\.php/i.test(landing)) return landing;

  const mid = (env.konfettiAwinMid() || KONFETTI_AWIN_MID).trim();
  if (!dest && !query) {
    const fromEnv = env.konfettiAffiliateUrl().trim();
    if (fromEnv) return fromEnv;
  }
  if (!mid) return landing;

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

export function preferKonfettiAffiliateUrl(url: string): string {
  if (!url || !isKonfettiUrl(url)) return url;
  return getKonfettiUrl(url);
}

export function buildKonfettiAction(opts?: {
  destinationUrl?: string | null;
  cityOrQuery?: string | null;
  label?: string;
}): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  const dest = (opts?.destinationUrl ?? '').trim();
  const event = dest ? isKonfettiEventUrl(dest) : false;
  return {
    type: 'OPEN_URL',
    label:
      opts?.label?.trim() ||
      (event ? '🎨 Workshop buchen' : '🎨 Workshops suchen'),
    payload: { url: getKonfettiUrl(opts?.destinationUrl, opts?.cityOrQuery) },
  };
}
