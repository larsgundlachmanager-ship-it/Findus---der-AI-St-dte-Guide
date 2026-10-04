/**
 * ±1 Tag um Hin (und Rück) — Travelpayouts Calendar wenn Token, sonst synthetische Fenster.
 */

import { offsetDateKey } from '../../../utils/dateKeys';
import type { FlightWishCandidate } from './flightWishTypes';

function shiftIso(iso: string, deltaDays: number): string {
  const ms = Date.parse(`${iso.slice(0, 10)}T12:00:00`);
  if (!Number.isFinite(ms)) return iso.slice(0, 10);
  return offsetDateKey(deltaDays, ms);
}

function dayVariants(center: string | null | undefined): string[] {
  if (!center || !/^\d{4}-\d{2}-\d{2}$/.test(center)) return [];
  const out = [center, shiftIso(center, -1), shiftIso(center, 1)];
  const seen = new Set<string>();
  return out.filter((d) => {
    if (seen.has(d)) return false;
    seen.add(d);
    return true;
  });
}

function nightsBetween(outbound: string, ret: string | null | undefined): number {
  if (!ret) return 2;
  const a = Date.parse(`${outbound}T12:00:00`);
  const b = Date.parse(`${ret.slice(0, 10)}T12:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 2;
  const n = Math.round((b - a) / (24 * 3600 * 1000));
  return Math.max(1, Math.min(30, n));
}

export async function scanCheapWindow(opts: {
  originIata: string;
  destIata: string;
  outboundDateKey: string | null;
  returnDateKey?: string | null;
}): Promise<FlightWishCandidate[]> {
  const from = opts.originIata.toUpperCase();
  const to = opts.destIata.toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return [];

  const outboundDays = dayVariants(opts.outboundDateKey);
  const returnDays = opts.returnDateKey ? dayVariants(opts.returnDateKey) : [null];

  const candidates: FlightWishCandidate[] = [];
  const seen = new Set<string>();

  for (const out of outboundDays) {
    for (const ret of returnDays) {
      const key = `${out}:${ret ?? 'ow'}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let filled: FlightWishCandidate | null = null;
      try {
        const { lookupCalendarFlightDay } = await import(
          '../../../reisebuero/research/flightLookup'
        );
        const q = await lookupCalendarFlightDay({
          origin: from,
          destination: to,
          date: out,
          nights: nightsBetween(out, ret),
        });
        if (q?.priceEur) {
          filled = {
            id: `cal-${from}-${to}-${out}-${ret ?? 'ow'}`,
            outboundDateKey: q.departDate || out,
            returnDateKey: ret,
            originIata: from,
            destIata: to,
            priceEur: q.priceEur,
            departAt: q.departAt,
            returnAt: q.returnAt,
            transfers: q.transfers,
            carrier: q.carrier,
            source: 'calendar',
          };
        }
      } catch {
        /* soft */
      }

      if (!filled) {
        filled = {
          id: `syn-${from}-${to}-${out}-${ret ?? 'ow'}`,
          outboundDateKey: out,
          returnDateKey: ret,
          originIata: from,
          destIata: to,
          priceEur: null,
          source: 'synthetic',
        };
      }
      candidates.push(filled);
    }
  }

  return candidates;
}
