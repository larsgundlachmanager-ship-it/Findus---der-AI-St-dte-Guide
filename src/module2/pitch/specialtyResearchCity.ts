/**
 * Specialty-Gastro: Datensatz/Stadt wählen, wenn GPS-Heimat sinnlos ist.
 * Stadt-agnostisch — Metro über nächsten Verkehrs-Hub, kein Orts-Hardcode.
 */

import type { PitchCall1Criterion, PitchWish } from './types';

/** Gericht/View/Outdoor die am Dorf-GPS meist leer sind → Metro-Recherche. */
export function wantsSpecialtyDiningResearch(opts: {
  text?: string | null;
  wishes?: PitchWish[] | null;
  mustHaves?: string[] | null;
  criteria?: PitchCall1Criterion[] | null;
}): boolean {
  const blob = [
    opts.text ?? '',
    ...(opts.wishes ?? []).map((w) => w.text),
    ...(opts.mustHaves ?? []),
    ...(opts.criteria ?? []).map((c) => c.key),
  ]
    .join(' ')
    .toLowerCase();
  if (!blob.trim()) return false;
  const dishOrLocal =
    /\b(pann(?:en)?fisch|labskaus|fischbrötchen|fischbroetchen|angus|wagyu|ayce|all[_-\s]*you[_-\s]*can[_-\s]*eat|all_you_can_eat|schlemmer[\s-]*buffet)\b/i.test(
      blob,
    ) ||
    (opts.wishes ?? []).some(
      (w) =>
        w.hardness === 'must' &&
        ((w.kind === 'dish' || w.kind === 'cuisine') &&
          String(w.text || '').trim().length >= 3 ||
          (w.kind === 'amenity' &&
            /all_you_can_eat|ayce|buffet|schlemmer/i.test(w.text))),
    );
  const viewOrWater =
    /\b(elbblick|meerblick|alsterblick|hafenblic|wasserblick|aussicht|sonnenuntergang|sunset|terrasse|outdoor|drau[sß]en)\b/i.test(
      blob,
    );
  const diningCue =
    /\b(essen|restaurant|abendessen|mittag|dinner|gastro|fisch)\b/i.test(blob);
  // Specialty-Gericht immer Metro-fähig; Blick/Outdoor nur mit Gastro-Absicht
  return dishOrLocal || (viewOrWater && diningCue);
}

/**
 * Wenn keine Stadt genannt und Specialty-Needs: nächste Metro-Stadt als researchCity.
 * null = kein Promote (explizite Stadt / keine Specialty).
 */
export function resolveSpecialtyResearchCity(opts: {
  text: string;
  lat: number;
  lng: number;
  explicitCity?: string | null;
  call1DestCity?: string | null;
  wishes?: PitchWish[] | null;
  mustHaves?: string[] | null;
  criteria?: PitchCall1Criterion[] | null;
}): { city: string; promoted: boolean } | null {
  const named = (opts.call1DestCity || opts.explicitCity || '').replace(/\s+/g, ' ').trim();
  if (named && !/\bhier\b/i.test(named)) {
    return { city: named, promoted: false };
  }
  if (
    !wantsSpecialtyDiningResearch({
      text: opts.text,
      wishes: opts.wishes,
      mustHaves: opts.mustHaves,
      criteria: opts.criteria,
    })
  ) {
    return null;
  }
  try {
    const { nearestCommercialAirport } = require('../../services/flights/airportIata') as {
      nearestCommercialAirport: (
        lat: number,
        lng: number,
      ) => { city?: string } | null;
    };
    const city = String(
      nearestCommercialAirport(opts.lat, opts.lng)?.city || '',
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (!city || city.length < 2) return null;
    return { city, promoted: true };
  } catch {
    return null;
  }
}
