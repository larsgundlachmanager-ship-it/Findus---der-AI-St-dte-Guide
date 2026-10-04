/**
 * Book-CTA-Gate: Button „buchen“ nur mit Brief-Params + belegter Angebots-ID.
 * Sonst ehrlich „noch nachziehen“ — kein hohles Portal-Home.
 */

import { extractAirbnbRoomId } from '../../services/affiliate/airbnbDeepLink';
import {
  extractExpediaPropertyId,
  isExpediaHotelPropertyUrl,
} from '../../services/affiliate/hotelPropertyDeepLink';
import { isHollowPartnerUrl } from '../../services/affiliate/hollowPartnerUrl';
import type { BookingCheckItem, StayChoice, TransportChoice } from '../types';

/** Expedia h… / Property-URL oder Airbnb /rooms/{id}. */
export function isVerifiedStayOffer(opts: {
  bookUrl?: string | null;
  expediaPropertyId?: string | null;
}): boolean {
  const pid = String(opts.expediaPropertyId || '').replace(/\D/g, '');
  if (pid.length >= 4) return true;
  const url = String(opts.bookUrl || '').trim();
  if (!url) return false;
  if (extractExpediaPropertyId(url) || isExpediaHotelPropertyUrl(url)) return true;
  if (extractAirbnbRoomId(url)) return true;
  // Camping.info konkrete Platz-URL (nicht nur Hub-Suche)
  if (/camping\.info\/[^?]*(?:campingplatz|campsite)\/[a-z0-9-]+/i.test(url)) return true;
  return false;
}

/** Flug nur mit konkreter Flugnummer (oft inkl. Carrier, z. B. FR2049). */
export function isVerifiedFlightOffer(opts: {
  flightNumber?: string | null;
  carrier?: string | null;
}): boolean {
  const raw = String(opts.flightNumber || '').trim();
  if (!raw) return false;
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  if (/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(compact)) return true;
  const carrier = String(opts.carrier || '').trim();
  if (carrier && /\d{2,4}/.test(raw)) return true;
  return false;
}

export function pendingBookLabel(kind: 'stay' | 'flight' | 'generic'): string {
  if (kind === 'stay') return 'Zimmer noch nachziehen';
  if (kind === 'flight') return 'Flug noch nachziehen';
  return 'Angebot noch nachziehen';
}

export function gateStayBookItem(opts: {
  id: string;
  name: string;
  bookUrl?: string | null;
  expediaPropertyId?: string | null;
}): BookingCheckItem {
  const url = (opts.bookUrl || '').trim() || null;
  const verified = isVerifiedStayOffer({
    bookUrl: url,
    expediaPropertyId: opts.expediaPropertyId,
  });
  if (verified && url && !isHollowPartnerUrl(url)) {
    return {
      id: opts.id,
      label: opts.name.slice(0, 42),
      url,
      kind: 'stay',
      clickedAtMs: null,
    };
  }
  return {
    id: opts.id,
    label: pendingBookLabel('stay'),
    url: null,
    kind: 'stay',
    clickedAtMs: null,
  };
}

export function gateFlightBookItem(opts: {
  id: string;
  label: string;
  bookUrl?: string | null;
  flightNumber?: string | null;
  carrier?: string | null;
}): BookingCheckItem {
  const url = (opts.bookUrl || '').trim() || null;
  const verified = isVerifiedFlightOffer({
    flightNumber: opts.flightNumber,
    carrier: opts.carrier,
  });
  if (verified && url && !isHollowPartnerUrl(url)) {
    const ident = [opts.carrier, opts.flightNumber].filter(Boolean).join(' ').trim();
    return {
      id: opts.id,
      label: ident ? `Flug ${ident}`.slice(0, 42) : opts.label.slice(0, 42),
      url,
      kind: 'flight',
      clickedAtMs: null,
    };
  }
  return {
    id: opts.id,
    label: pendingBookLabel('flight'),
    url: null,
    kind: 'flight',
    clickedAtMs: null,
  };
}

/** StayChoice → Checklist-Item (mit optionaler Property-ID). */
export function gateStayChoice(s: StayChoice & { expediaPropertyId?: string | null }): BookingCheckItem {
  return gateStayBookItem({
    id: `st-${s.id}`,
    name: s.name,
    bookUrl: s.bookUrl,
    expediaPropertyId: s.expediaPropertyId ?? null,
  });
}

export function gateTransportChoice(t: TransportChoice): BookingCheckItem | null {
  if (!t.bookUrl && t.kind !== 'flight') return null;
  if (t.kind === 'flight') {
    return gateFlightBookItem({
      id: `tr-${t.id}`,
      label: t.label,
      bookUrl: t.bookUrl,
      flightNumber: t.flightNumber,
      carrier: t.carrier,
    });
  }
  const url = (t.bookUrl || '').trim();
  if (!url || isHollowPartnerUrl(url)) return null;
  return {
    id: `tr-${t.id}`,
    label: t.label.slice(0, 42),
    url,
    kind: t.kind === 'train' ? 'train' : 'other',
    clickedAtMs: null,
  };
}

/**
 * Magazin-Tap: nur verifizierte Stay/Flight-CTAs öffnen.
 * „Noch nachziehen“ / hohl / ohne URL → false (UI zeigt Alert).
 */
export function mayOpenBookingCheckItem(item: BookingCheckItem): boolean {
  if (/noch nachziehen/i.test(item.label)) return false;
  const url = (item.url || '').trim();
  if (!url) return false;
  if (isHollowPartnerUrl(url)) return false;
  if (item.kind === 'stay') {
    return isVerifiedStayOffer({ bookUrl: url });
  }
  if (item.kind === 'flight') {
    return !/suchen/i.test(item.label);
  }
  return true;
}
