/**
 * Pack-Tags = schneller Vorfilter.
 * Spezialisierte Gastro-Wünsche (Gericht/Küche/Vibe) brauchen zusätzlich Live-Places
 * + Review-Beleg, sonst verdrängen generische Pack-Orte Maps-Treffer.
 */
import { isParkingOrForestLotVenue } from './nonFoodVenueGate';
import { scoreSpecializedFoodWish } from './specializedFoodMatch';
import type { PitchCandidate, PitchRequest } from './types';

export function hasSpecializedFoodFilter(req: PitchRequest): boolean {
  if (req.kind !== 'food' && req.kind !== 'bar') return false;
  return req.wishes.some(
    (w) =>
      w.hardness === 'must' &&
      (w.kind === 'dish' || w.kind === 'cuisine' || w.kind === 'vibe'),
  );
}

function gastroOk(c: PitchCandidate): boolean {
  return !isParkingOrForestLotVenue(c.name, (c.softTags ?? []).join(' '));
}

function keyOf(c: PitchCandidate): string {
  return (c.placeId || c.name).toLowerCase();
}

/**
 * Verify-Seed: Facet-Pack zuerst, dann immer Live-Places, dann Vorfilter.
 * Reviews kommen in hardMatchVerify — der Seed muss die Live-Hits enthalten.
 */
export function mixLiveResearchSeed(
  req: PitchRequest,
  pool: PitchCandidate[],
  preTop: PitchCandidate[],
  limit = 12,
): PitchCandidate[] {
  const fallback = (
    preTop.length ? preTop : pool.filter(gastroOk)
  ).slice(0, 10);
  if (!hasSpecializedFoodFilter(req)) return fallback;

  const seen = new Set<string>();
  const out: PitchCandidate[] = [];
  const push = (c: PitchCandidate | undefined) => {
    if (!c || !gastroOk(c)) return;
    const key = keyOf(c);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };

  const musts = req.wishes.filter(
    (w) =>
      w.hardness === 'must' &&
      (w.kind === 'dish' || w.kind === 'cuisine' || w.kind === 'vibe'),
  );
  for (const c of pool) {
    if (c.source !== 'pack') continue;
    const blob = `${c.name} ${(c.softTags ?? []).join(' ')}`;
    if (musts.some((w) => scoreSpecializedFoodWish(blob, w) >= 3)) push(c);
  }
  for (const c of pool) {
    if (c.source === 'places') push(c);
  }
  for (const c of preTop) push(c);
  for (const c of pool) push(c);
  return (out.length ? out : fallback).slice(0, limit);
}
