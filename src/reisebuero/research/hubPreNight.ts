/**
 * Vornacht am Hub — 1 Nacht vor frühem Flug/Schiff (Start < 07:00).
 * Nicht verwechseln mit earlyArrival (günstigerer Kalendertag am Ziel).
 */

import { offsetDateKey } from '../../utils/dateKeys';
import type { ReiseLedger, StayChoice, TransportChoice } from '../types';
import { clockHourFromStamp, flightComfortFromLedger } from './flightFilter';
import { lookupCityNightStay, cityNightStayChoice } from './cityNightStay';

export const EARLY_DEPART_BEFORE_HOUR = 7;

/** IATA → Hub-Stadt (Zubringer / Vornacht). */
export const HUB_IATA_CITY: Record<string, string> = {
  HAM: 'Hamburg',
  BRE: 'Bremen',
  BER: 'Berlin',
  HAJ: 'Hannover',
  CGN: 'Köln',
  DUS: 'Düsseldorf',
  FRA: 'Frankfurt',
  MUC: 'München',
  STR: 'Stuttgart',
  DTM: 'Dortmund',
  NUE: 'Nürnberg',
  LEJ: 'Leipzig',
  HHN: 'Frankfurt-Hahn',
  FMM: 'Memmingen',
  FKB: 'Karlsruhe',
  NRN: 'Weeze',
  PAD: 'Paderborn',
  SCN: 'Saarbrücken',
  LBC: 'Lübeck',
  GWT: 'Westerland',
  KEL: 'Kiel',
};

export function hubCityFromIata(iata: string | null | undefined): string | null {
  const k = (iata || '').trim().toUpperCase();
  if (!k) return null;
  return HUB_IATA_CITY[k] || null;
}

export function isEarlyDepartClock(departAt: string | null | undefined): boolean {
  const h = clockHourFromStamp(departAt);
  return h != null && h < EARLY_DEPART_BEFORE_HOUR;
}

export function hubPreNightDateKey(departDateKey: string | null | undefined): string | null {
  const key = (departDateKey || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  return offsetDateKey(-1, Date.parse(`${key}T12:00:00`));
}

/**
 * Origin-Hub-Nacht vor Flug/Fähre < 07:00.
 * Kreuzfahrt-Einschiffen bleibt cruisePlan (Terminal-Vornacht am Zielhafen).
 * User „kein Frühflug“ → Legs werden gefiltert, keine Vornacht.
 */
export function needsHubPreNight(
  tr: Pick<TransportChoice, 'kind' | 'departAt'> | null | undefined,
  ledger: ReiseLedger,
): boolean {
  if (!tr) return false;
  if (flightComfortFromLedger(ledger).noEarlyDepart) return false;
  if (tr.kind === 'cruise') return false;
  if (tr.kind !== 'flight' && tr.kind !== 'ferry') return false;
  return isEarlyDepartClock(tr.departAt);
}

export function tagHubPreNightOnTransports(
  transports: TransportChoice[],
  ledger: ReiseLedger,
): TransportChoice[] {
  return transports.map((t) => ({
    ...t,
    hubPreNight: needsHubPreNight(t, ledger),
  }));
}

export function hubPreNightStayChoice(opts: {
  id: string;
  name: string;
  city: string;
  priceEur: number | null;
  bookUrl: string | null;
  photoUrl?: string | null;
  lat?: number;
  lng?: number;
  checkin: string;
  checkout: string;
}): StayChoice {
  return cityNightStayChoice({
    ...opts,
    why: `Vornacht am Hub · 1 Nacht ${opts.checkin} → ${opts.checkout} · ${opts.city}`,
  });
}

export async function lookupHubPreNightStay(opts: {
  fromIata?: string | null;
  originCity?: string | null;
  departDateKey?: string | null;
  departAt?: string | null;
  adults: number;
}): Promise<StayChoice | null> {
  const flyDay =
    (opts.departDateKey || '').slice(0, 10) ||
    (opts.departAt || '').slice(0, 10) ||
    null;
  const checkin = hubPreNightDateKey(flyDay);
  const checkout = flyDay && /^\d{4}-\d{2}-\d{2}$/.test(flyDay) ? flyDay : null;
  const city =
    hubCityFromIata(opts.fromIata) ||
    (opts.originCity || '').trim() ||
    null;
  if (!checkin || !checkout || !city) return null;
  const stay = await lookupCityNightStay({
    city,
    checkin,
    checkout,
    adults: opts.adults,
    prefer: 'airport',
    idPrefix: 'hub',
    why: `Vornacht am Hub · 1 Nacht ${checkin} → ${checkout} · ${city}`,
    fallbackName: `${city} Flughafen Hotel`,
  });
  return stay;
}
