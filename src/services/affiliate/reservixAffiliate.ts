/**
 * Reservix DE — AWIN Affiliate (Live-Events: Konzert, Theater, Sport, Festival).
 * ~2,5 % Warenkorb + Anteil VVK-Gebühr · Cookie 30 Tage.
 */

import { env } from '../../config/env';

export const RESERVIX_AWIN_MID = '31293';

/** Konkrete Event-/Gruppen-Seite (nicht Portal-Start). */
export function isReservixEventUrl(url: string): boolean {
  const u = String(url || '');
  if (!/reservix\.(de|at|ch)/i.test(u)) return false;
  if (/\/group\/\d+/i.test(u)) return true;
  if (/reservix\.de\/tickets\//i.test(u)) return true;
  if (/\/events?\//i.test(u) && !/\/events?\/?(\?|#|$)/i.test(u)) return true;
  return false;
}

export function isReservixUrl(url: string): boolean {
  return /reservix\.(de|at|ch)/i.test(url);
}

export function getReservixLandingUrl(cityOrQuery?: string | null): string {
  const q = (cityOrQuery ?? '').trim();
  if (!q) return 'https://www.reservix.de/';
  return `https://www.reservix.de/search?q=${encodeURIComponent(q)}`;
}

export function getReservixUrl(
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
  const landing = dest || getReservixLandingUrl(query || null);
  if (/awin1\.com\/cread\.php/i.test(landing)) return landing;

  const mid = (env.reservixAwinMid() || RESERVIX_AWIN_MID).trim();
  if (!dest && !query) {
    const fromEnv = env.reservixAffiliateUrl().trim();
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

export function buildReservixAction(opts?: {
  destinationUrl?: string | null;
  cityOrQuery?: string | null;
  label?: string;
}): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  const dest = (opts?.destinationUrl ?? '').trim();
  const event = dest ? isReservixEventUrl(dest) : false;
  return {
    type: 'OPEN_URL',
    label:
      opts?.label?.trim() ||
      (event ? '🎫 Tickets bei Reservix' : '🎫 Events & Tickets'),
    payload: { url: getReservixUrl(opts?.destinationUrl, opts?.cityOrQuery) },
  };
}

/** Live-Event-Intent (DE) — Konzert, Theater, Festival, Sport. */
export const RESERVIX_LIVE_EVENT_RE =
  /\b(reservix|konzert|festival|musical|theater|oper|kabarett|comedy|vorstellung|einlass|karten\s+für|live[\s-]?show|stadion|biathlon|daviscup|tickets?\s+für)\b/iu;
