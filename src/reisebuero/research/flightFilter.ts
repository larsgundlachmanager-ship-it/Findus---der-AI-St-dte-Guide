/**
 * Flug-Junk-Filter — Layover, Nachtankunft.
 * Frühstart (<07:00) bleibt Default; nur bei explizitem noEarlyDepart weg.
 * Vornacht am Hub: hubPreNight.ts — nicht dieser Filter.
 */

import type { ReiseLedger } from '../types';

export type FlightLegLike = {
  departAt?: string | null;
  arriveAt?: string | null;
  layoverHours?: number | null;
  overnightStop?: boolean;
  priceEur?: number | null;
  transfers?: number | null;
  stops?: number | null;
};

export function flightComfortFromLedger(ledger: ReiseLedger): {
  maxLayoverHours: number;
  longLayoverExploreHours: number | null;
  noNightArrival: boolean;
  noEarlyDepart: boolean;
  overnightOk: boolean;
} {
  const c = ledger.flightComfort?.value;
  const overnightOk =
    c?.overnightOk ?? ledger.overnightFlightOk?.value ?? false;
  return {
    maxLayoverHours: c?.maxLayoverHours ?? ledger.maxLayoverHours?.value ?? 5,
    longLayoverExploreHours: ledger.longLayoverExploreHours?.value ?? null,
    noNightArrival: overnightOk ? false : (c?.noNightArrival ?? true),
    noEarlyDepart: c?.noEarlyDepart ?? false,
    overnightOk,
  };
}

/** Stunde aus ISO oder HH:MM. */
export function clockHourFromStamp(isoOrHm: string | null | undefined): number | null {
  if (!isoOrHm) return null;
  const m = isoOrHm.match(/T(\d{2})/) || isoOrHm.match(/^(\d{1,2}):/);
  if (!m) return null;
  const h = Number(m[1]);
  return Number.isFinite(h) ? h : null;
}

function hourOf(isoOrHm: string | null | undefined): number | null {
  return clockHourFromStamp(isoOrHm);
}

/** true = behalten */
export function passesFlightJunkFilter(
  leg: FlightLegLike,
  ledger: ReiseLedger,
): boolean {
  const c = flightComfortFromLedger(ledger);
  const stops = leg.transfers ?? leg.stops;
  if (ledger.directFlight?.value === true && stops != null && stops > 0) {
    // Soft wish: nicht hart droppen wenn hardness wish — trotzdem bevorzugen via rank
    if (ledger.directFlight.hardness === 'must') return false;
  }
  if (leg.layoverHours != null) {
    const h = leg.layoverHours;
    const shortOk = h <= c.maxLayoverHours;
    const exploreMin = c.longLayoverExploreHours;
    const exploreOk = exploreMin != null && exploreMin >= 16 && h >= exploreMin;
    if (!shortOk && !exploreOk) return false;
  }
  if (leg.overnightStop && !c.overnightOk) return false;
  const arrH = hourOf(leg.arriveAt);
  if (c.noNightArrival && arrH != null && (arrH >= 23 || arrH < 6)) return false;
  const depH = hourOf(leg.departAt);
  if (c.noEarlyDepart && depH != null && depH < 7) return false;
  return true;
}

export function rankFlightLegs<T extends FlightLegLike>(
  legs: T[],
  ledger: ReiseLedger,
): T[] {
  const wantDirect = ledger.directFlight?.value === true;
  return legs
    .filter((l) => passesFlightJunkFilter(l, ledger))
    .sort((a, b) => {
      if (wantDirect) {
        const as = a.transfers ?? a.stops ?? 99;
        const bs = b.transfers ?? b.stops ?? 99;
        if (as !== bs) return as - bs;
      }
      return (a.priceEur ?? 9e6) - (b.priceEur ?? 9e6);
    });
}
