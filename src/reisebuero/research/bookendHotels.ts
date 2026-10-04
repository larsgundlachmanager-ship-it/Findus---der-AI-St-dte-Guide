/**
 * Night-Train / Mehrtagestour — Hotel vorn UND hinten (zweites Live-Hotel).
 * stay-start ≠ Ziel-Stay-Klon; Preise aus Hotellook wenn da.
 */

import { offsetDateKey } from '../../utils/dateKeys';
import type { ReiseLedger, ReiseOption, StayChoice } from '../types';
import { lookupCityNightStay, cityNightSearchUrl } from './cityNightStay';
import { resolvePackageBlueprint } from './packageBlueprint';

export function needsBookendHotels(ledger: ReiseLedger): boolean {
  const bp = resolvePackageBlueprint(ledger);
  if (bp === 'rail_night' || bp === 'route_tour') return true;
  const shape = ledger.tripShape?.value;
  if (shape === 'tour' || shape === 'hop') return true;
  const isNight = ledger.railFlex?.value === 'overnight_ok';
  if (isNight && (ledger.stayNights?.value ?? 0) >= 1) return true;
  return false;
}

export function bookendStartDates(dateStart: string | null | undefined): {
  checkin: string;
  checkout: string;
} | null {
  const day = (dateStart || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const checkin = offsetDateKey(-1, Date.parse(`${day}T12:00:00`));
  if (!checkin) return null;
  return { checkin, checkout: day };
}

export function bookendStartCity(opts: {
  ledger: ReiseLedger;
  originCity?: string | null;
}): string | null {
  const home = (opts.originCity || opts.ledger.originCity?.value || '').trim();
  if (home) return home;
  const cities = opts.ledger.originCities?.value ?? [];
  const first = (cities[0] || '').trim();
  return first || null;
}

function destStayChoice(opt: ReiseOption): StayChoice | null {
  const selected =
    opt.stays?.find((s) => s.id === opt.selectedStayId) || opt.stays?.[0] || null;
  if (selected?.bookUrl || (selected?.priceEur != null && selected.priceEur > 0)) {
    return selected;
  }
  if (opt.stayBookUrl || (opt.stayPriceEur != null && opt.stayPriceEur > 0)) {
    return {
      id: 'bookend-end-dest',
      name: opt.stayName || opt.placeName || 'Unterkunft am Ziel',
      priceEur: opt.stayPriceEur ?? null,
      bookUrl: opt.stayBookUrl ?? null,
      photoUrl: opt.photoUrl ?? null,
      why: 'Hotel nach Ankunft',
    };
  }
  return null;
}

/** Hub-Vornacht am gleichen Ort/Nacht = Start-Hotel, kein zweites Zimmer. */
export function reuseHubAsBookendStart(hub: StayChoice | null | undefined): StayChoice | null {
  if (!hub?.bookUrl && !(hub?.priceEur != null && hub.priceEur > 0)) return null;
  return hub ?? null;
}

export async function lookupBookendStartStay(opts: {
  ledger: ReiseLedger;
  originCity?: string | null;
  destCity?: string | null;
  dateStart?: string | null;
  adults: number;
  existing?: StayChoice | null;
}): Promise<StayChoice | null> {
  if (opts.existing?.bookUrl || (opts.existing?.priceEur != null && opts.existing.priceEur > 0)) {
    return opts.existing;
  }
  const dates = bookendStartDates(opts.dateStart || opts.ledger.dateStart?.value);
  const city = bookendStartCity({ ledger: opts.ledger, originCity: opts.originCity });
  if (!dates || !city) return null;
  const dest = (opts.destCity || '').trim().toLowerCase();
  const prefer =
    dest && dest === city.toLowerCase() ? 'any' : ('station' as const);
  return lookupCityNightStay({
    city,
    checkin: dates.checkin,
    checkout: dates.checkout,
    adults: opts.adults,
    prefer,
    idPrefix: 'bookend-start',
    why: `Hotel vor der Tour / vor dem Zug · 1 Nacht ${dates.checkin} → ${dates.checkout} · ${city}`,
    fallbackName: `${city} Bahnhof Hotel`,
  });
}

export async function lookupBookendEndStay(opts: {
  opt: ReiseOption;
  ledger: ReiseLedger;
  destCity?: string | null;
  dateStart?: string | null;
  checkout?: string | null;
  adults: number;
}): Promise<StayChoice | null> {
  const have = destStayChoice(opts.opt);
  if (have) return have;
  const city = (opts.destCity || opts.opt.placeName || '').trim();
  const start = (opts.dateStart || opts.ledger.dateStart?.value || '').slice(0, 10);
  if (!city || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const nightTrain = opts.ledger.railFlex?.value === 'overnight_ok';
  const checkin = nightTrain
    ? offsetDateKey(1, Date.parse(`${start}T12:00:00`))
    : start;
  const checkout =
    (opts.checkout || '').slice(0, 10) ||
    offsetDateKey(1, Date.parse(`${checkin}T12:00:00`));
  return lookupCityNightStay({
    city,
    checkin,
    checkout: checkout > checkin ? checkout : offsetDateKey(1, Date.parse(`${checkin}T12:00:00`)),
    adults: opts.adults,
    prefer: 'any',
    idPrefix: 'bookend-end',
    why: `Hotel nach Ankunft · ${city}`,
    fallbackName: `${city} Hotel`,
  });
}

export function bookendStartFallbackUrl(opts: {
  city: string;
  checkin: string;
  checkout: string;
  adults: number;
}): string {
  return cityNightSearchUrl({
    city: opts.city,
    checkin: opts.checkin,
    checkout: opts.checkout,
    adults: opts.adults,
    hint: 'Bahnhof Hotel',
  });
}

export function sameStayRef(a: StayChoice | null | undefined, b: StayChoice | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  const ua = (a.bookUrl || '').split('?')[0];
  const ub = (b.bookUrl || '').split('?')[0];
  return Boolean(ua && ub && ua === ub && a.name === b.name);
}
