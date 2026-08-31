/**
 * Gleicher Ortsname, mehrere Städte — fragen vor dem Losfahren.
 *
 * Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals
 * den genauen Wortlaut. Passe deine Antwort immer dynamisch und organisch an
 * den aktuellen Kontext und die aktuelle Stadt an.
 */

import {
  citiesShareCore,
  loadNearbyCitiesFromIndex,
  nearestCityName,
  spokenCityFromQuery,
} from './fuzzyCityResolve';

export type PlaceCityOption = {
  city: string;
  lat: number;
  lng: number;
  label: string;
};

export type PlaceCityAnalysis =
  | { kind: 'one'; pick: PlaceCityOption }
  | { kind: 'choice'; place: string; options: PlaceCityOption[] }
  | { kind: 'none' };

function placeCore(query: string): string {
  const t = String(query || '').replace(/\s+/g, ' ').trim();
  const first = t.split(',')[0]?.trim() || t;
  return first.replace(/\s+in\s+[A-ZÄÖÜ].*$/u, '').trim() || t;
}

export function groupHitsByCity(
  hits: Array<{ lat: number; lng: number; label: string }>,
): PlaceCityOption[] {
  const cities = loadNearbyCitiesFromIndex();
  const out: PlaceCityOption[] = [];
  for (const h of hits) {
    const city =
      nearestCityName(h.lat, h.lng, cities) ||
      spokenCityFromQuery(h.label) ||
      '';
    if (!city) continue;
    const dup = out.find((o) => citiesShareCore(o.city, city));
    if (dup) continue;
    out.push({
      city,
      lat: h.lat,
      lng: h.lng,
      label: h.label,
    });
    if (out.length >= 4) break;
  }
  return out;
}

export function analyzePlaceCityHits(
  query: string,
  hits: Array<{ lat: number; lng: number; label: string }>,
): PlaceCityAnalysis {
  if (!hits.length) return { kind: 'none' };
  const spoken = spokenCityFromQuery(query);
  const grouped = groupHitsByCity(hits);
  if (spoken && grouped.length) {
    const match = grouped.find((o) => citiesShareCore(o.city, spoken));
    if (match) return { kind: 'one', pick: match };
  }
  if (!spoken && grouped.length >= 2) {
    return { kind: 'choice', place: placeCore(query), options: grouped };
  }
  const first = grouped[0] ?? {
    city: spoken || '',
    lat: hits[0]!.lat,
    lng: hits[0]!.lng,
    label: hits[0]!.label,
  };
  return { kind: 'one', pick: first };
}

export function buildPlaceCityChoiceSpeech(
  place: string,
  options: PlaceCityOption[],
): string {
  const names = options.map((o) => o.city);
  if (names.length === 2) {
    return `${place} gibt’s in ${names[0]} und in ${names[1]} — welches meinst du?`;
  }
  const list = names.slice(0, 3).join(', ');
  return `${place} gibt’s an mehreren Orten (${list}). Welches meinst du?`;
}
