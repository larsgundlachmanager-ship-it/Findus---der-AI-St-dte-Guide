/**
 * Deterministic ranking for wish-pitch candidates (quality + price).
 */

import { isSaneFlightOption } from '../cheapFlightQuality';
import type { FlightWishCandidate } from './flightWishTypes';

function score(c: FlightWishCandidate): number {
  let s = 0.5;
  if (c.priceEur != null && c.priceEur > 0) {
    s += Math.max(0, 1.2 - c.priceEur / 900);
  } else {
    s -= 0.08;
  }
  if (c.source === 'calendar') s += 0.15;
  const stops = c.transfers ?? null;
  if (stops === 0) s += 0.22;
  else if (stops === 1) s += 0.08;
  else if (stops != null && stops > 1) s -= 0.25;
  if (
    isSaneFlightOption({
      durationMin: c.durationMin,
      stops: c.transfers,
    })
  ) {
    s += 0.12;
  } else {
    s -= 0.35;
  }
  const dep = c.departAt?.match(/^(\d{1,2}):(\d{2})$/);
  if (dep) {
    const h = Number(dep[1]);
    if (h >= 6 && h <= 21) s += 0.05;
    if (h >= 23 || h < 5) s -= 0.2;
  }
  return s;
}

export function rankFlightOptions(
  candidates: FlightWishCandidate[],
  limit = 3,
): FlightWishCandidate[] {
  if (!candidates.length) return [];
  const sane = candidates.filter((c) =>
    isSaneFlightOption({ durationMin: c.durationMin, stops: c.transfers }),
  );
  const pool = sane.length ? sane : candidates;
  return [...pool]
    .map((c) => ({ c, s: score(c) }))
    .sort((a, b) => b.s - a.s || (a.c.priceEur ?? 9e9) - (b.c.priceEur ?? 9e9))
    .slice(0, limit)
    .map((x) => x.c);
}
