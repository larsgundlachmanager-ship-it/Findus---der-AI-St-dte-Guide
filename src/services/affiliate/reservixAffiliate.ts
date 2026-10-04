/**
 * Reservix-Familie — AWIN Live-Events (Konzert, Theater, Sport, Festival).
 * - reservix.de mid=31293
 * - adticket.de mid=18490 (Reservix-Marke, gleiche Inventory-Familie)
 * ~2,5 % Warenkorb + VVK-Anteil · Cookie 30 Tage.
 */

import { env } from '../../config/env';

export const RESERVIX_AWIN_MID = '31293';
export const ADTICKET_AWIN_MID = '18490';

/** Konkrete Event-/Gruppen-Seite (nicht Portal-Start). */
export function isReservixEventUrl(url: string): boolean {
  const u = String(url || '');
  if (!/(?:reservix|adticket)\.(de|at|ch)/i.test(u)) return false;
  if (/\/group\/\d+/i.test(u)) return true;
  if (/(?:reservix|adticket)\.de\/tickets\//i.test(u)) return true;
  if (/\/events?\//i.test(u) && !/\/events?\/?(\?|#|$)/i.test(u)) return true;
  return false;
}

export function isReservixUrl(url: string): boolean {
  return /reservix\.(de|at|ch)/i.test(url);
}

export function isAdticketUrl(url: string): boolean {
  return /adticket\.de/i.test(url);
}

/** Reservix oder ADticket. */
export function isReservixFamilyUrl(url: string): boolean {
  return isReservixUrl(url) || isAdticketUrl(url);
}

export function getReservixLandingUrl(cityOrQuery?: string | null): string {
  const q = (cityOrQuery ?? '').trim();
  if (!q) return 'https://www.reservix.de/';
  return `https://www.reservix.de/search?q=${encodeURIComponent(q)}`;
}

export function getAdticketLandingUrl(cityOrQuery?: string | null): string {
  const q = (cityOrQuery ?? '').trim();
  if (!q) return 'https://www.adticket.de/';
  return `https://www.adticket.de/search?q=${encodeURIComponent(q)}`;
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
  // ADticket-Deep-Link → eigenes Programm tracken
  if (dest && isAdticketUrl(dest)) {
    return getAdticketUrl(dest, cityOrQuery);
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
  return awinWrap(mid, landing);
}

export function getAdticketUrl(
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
  const landing = dest || getAdticketLandingUrl(query || null);
  if (/awin1\.com\/cread\.php/i.test(landing)) return landing;

  const mid = (env.adticketAwinMid() || ADTICKET_AWIN_MID).trim();
  if (!dest && !query) {
    const fromEnv = env.adticketAffiliateUrl().trim();
    if (fromEnv) return fromEnv;
  }
  if (!mid) return landing;
  return awinWrap(mid, landing);
}

export function buildReservixAction(opts?: {
  destinationUrl?: string | null;
  cityOrQuery?: string | null;
  label?: string;
  /** Default Reservix; ADticket wenn Brand genannt oder URL. */
  brand?: 'reservix' | 'adticket';
}): {
  type: 'OPEN_URL';
  label: string;
  payload: { url: string };
} {
  const dest = (opts?.destinationUrl ?? '').trim();
  const event = dest ? isReservixEventUrl(dest) : false;
  const useAdticket =
    opts?.brand === 'adticket' ||
    (dest ? isAdticketUrl(dest) : false);
  const city = opts?.cityOrQuery;
  let url: string;
  if (useAdticket) {
    url = getAdticketUrl(
      dest && isAdticketUrl(dest) && isReservixEventUrl(dest) ? dest : null,
      city,
    );
  } else if (dest && isAdticketUrl(dest)) {
    url = getAdticketUrl(isReservixEventUrl(dest) ? dest : null, city);
  } else {
    url = getReservixUrl(dest || null, city);
  }
  return {
    type: 'OPEN_URL',
    label:
      opts?.label?.trim() ||
      (event
        ? useAdticket || isAdticketUrl(dest)
          ? '🎫 Tickets bei ADticket'
          : '🎫 Tickets bei Reservix'
        : '🎫 Events & Tickets'),
    payload: { url },
  };
}

export function preferReservixFamilyAffiliateUrl(url: string): string {
  if (!url || !isReservixFamilyUrl(url)) return url;
  if (isAdticketUrl(url)) return getAdticketUrl(url);
  return getReservixUrl(url);
}

/** Live-Event-Intent (DE) — Konzert, Theater, Festival, Sport. */
export const RESERVIX_LIVE_EVENT_RE =
  /\b(reservix|adticket|ad[\s-]?ticket|konzert|festival|musical|theater|oper|kabarett|comedy|vorstellung|einlass|karten\s+für|live[\s-]?show|stadion|biathlon|daviscup|tickets?\s+für)\b/iu;
