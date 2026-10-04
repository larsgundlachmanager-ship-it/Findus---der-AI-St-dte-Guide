/**
 * Pack-Heimatstadt ≠ Tour-Zielstadt → kein Heimat-POI-Dump.
 * Node-smoke-fähig (kein RN).
 */

import type { TourRequest } from './types';

/**
 * true = geladenes Pack gehört nicht zur genannten Zielstadt.
 * Dann keine 80-km-Stadtweite Pack-Kandidaten (Pinneberg → Hamburg).
 */
export function packCityMismatchesDest(
  req: Pick<TourRequest, 'areaHint' | 'cityHint' | 'title' | 'context'>,
  packCityHint?: string | null,
): boolean {
  try {
    let pack = (packCityHint || '').trim();
    if (!pack) {
      const { readRucksackSync } = require('../rucksack/rucksackStore') as {
        readRucksackSync: () => { cityHint?: string | null };
      };
      pack = (readRucksackSync()?.cityHint || '').trim();
    }
    let dest =
      (req.cityHint || '').trim() ||
      (req.areaHint || '').trim();
    if (!dest) {
      try {
        const { usePlanSessionStore } = require('../planning/planSessionState') as {
          usePlanSessionStore: {
            getState: () => {
              plan: { destinationCity?: string | null } | null;
            };
          };
        };
        dest =
          (usePlanSessionStore.getState().plan?.destinationCity || '').trim();
      } catch {
        /* soft */
      }
    }
    if (!dest) {
      const { extractCityFromText } = require('../context/shortTermContext') as {
        extractCityFromText: (s: string) => string | null;
      };
      dest = extractCityFromText(`${req.title} ${req.context}`) || '';
    }
    if (!pack || !dest) return false;
    const { sameFoldedCity } = require('../planning/planDestinationCity') as {
      sameFoldedCity: (a: string, b: string) => boolean;
    };
    return !sameFoldedCity(pack, dest);
  } catch {
    return false;
  }
}

/** Pure helper for smokes — no store. */
export function packCityMismatchesDestPure(
  packCity: string | null | undefined,
  destCity: string | null | undefined,
): boolean {
  const pack = (packCity || '').trim();
  const dest = (destCity || '').trim();
  if (!pack || !dest) return false;
  try {
    const { sameFoldedCity } = require('../planning/planDestinationCity') as {
      sameFoldedCity: (a: string, b: string) => boolean;
    };
    return !sameFoldedCity(pack, dest);
  } catch {
    return pack.toLowerCase() !== dest.toLowerCase();
  }
}
