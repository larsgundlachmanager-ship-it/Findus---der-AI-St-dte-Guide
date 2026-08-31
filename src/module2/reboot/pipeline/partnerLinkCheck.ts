/**
 * Partner-Deeplink SSOT + Schema-Check.
 * Speech und Button dieselbe URL. Kaputte Pflicht-Parameter → nicht sprechen.
 * Live-HTTP ist optional (kein Turn-Timeout).
 */

import { buildUberGoUrl } from '../../../services/affiliate/partnerBookingDeepLink';

const STAY22_HOST = 'https://www.stay22.com';
const STAY22_AID = 'findus';

function stay22SearchUrl(opts: {
  destination: string;
  checkin?: string;
  checkout?: string;
  adults?: number;
}): string {
  const q = new URLSearchParams({ address: opts.destination.trim() });
  if (opts.checkin) q.set('checkin', opts.checkin);
  if (opts.checkout) q.set('checkout', opts.checkout);
  if (opts.adults != null) q.set('adults', String(opts.adults));
  return `${STAY22_HOST}/allez/${encodeURIComponent(STAY22_AID)}?${q.toString()}`;
}

export type LinkCheck = {
  ok: boolean;
  url: string;
  reason?: string;
};

function mustParams(url: string, keys: string[]): LinkCheck {
  try {
    const u = new URL(url);
    for (const k of keys) {
      const v = u.searchParams.get(k);
      if (!v || !v.trim()) {
        return { ok: false, url, reason: `missing:${k}` };
      }
    }
    return { ok: true, url };
  } catch {
    return { ok: false, url, reason: 'invalid_url' };
  }
}

export function buildStayDeeplink(opts: {
  destination: string;
  checkin?: string;
  checkout?: string;
  adults?: number;
}): LinkCheck {
  const dest = (opts.destination || '').trim();
  if (!dest) return { ok: false, url: '', reason: 'missing:destination' };
  const url = stay22SearchUrl({
    destination: dest,
    checkin: opts.checkin,
    checkout: opts.checkout,
    adults: opts.adults,
  });
  return mustParams(url, ['address']);
}

export function buildUberDeeplink(opts: {
  clientId: string;
  dropLat: number;
  dropLng: number;
  dropAddress: string;
  pickupTimeHm?: string | null;
}): LinkCheck {
  if (!opts.clientId.trim()) {
    return { ok: false, url: '', reason: 'missing:clientId' };
  }
  if (!Number.isFinite(opts.dropLat) || !Number.isFinite(opts.dropLng)) {
    return { ok: false, url: '', reason: 'missing:dropoff' };
  }
  const url = buildUberGoUrl({
    clientId: opts.clientId,
    dropoff: {
      addressLine1: opts.dropAddress || 'Dropoff',
      addressLine2: null,
      latitude: opts.dropLat,
      longitude: opts.dropLng,
    },
    pickupMyLocation: true,
    pickupTimeHm: opts.pickupTimeHm,
  });
  if (!/^https:\/\/m\.uber\.com\//i.test(url)) {
    return { ok: false, url, reason: 'host' };
  }
  if (!url.includes('drop')) {
    return { ok: false, url, reason: 'missing:drop' };
  }
  return { ok: true, url };
}

/** Nur sprechen/zeigen wenn Check ok. */
export function speakablePartnerUrl(check: LinkCheck): string | null {
  return check.ok ? check.url : null;
}
