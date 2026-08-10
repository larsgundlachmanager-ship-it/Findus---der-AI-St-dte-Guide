/**
 * Fuzzy-Stadt-Suche: Tippfehler, andere Sprache, Land/Bundesland.
 */

import type { CityCatalogItem } from '../services/cityCatalogService';
import { citySearchMeta } from '../constants/cityCovers';

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Einfache Edit-Distanz (Levenshtein), gekappt. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const prev = new Array<number>(cols);
  const cur = new Array<number>(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    cur[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j < cols; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

function tokenFuzzyHit(query: string, candidate: string): boolean {
  const q = normalize(query);
  const c = normalize(candidate);
  if (!q || !c) return false;
  if (c.includes(q) || q.includes(c)) return true;
  const maxDist = q.length <= 4 ? 1 : q.length <= 8 ? 2 : 3;
  if (Math.abs(q.length - c.length) > maxDist + 1) {
    // Wort-Token-Vergleich
    const cTokens = c.split(' ');
    return cTokens.some((t) => {
      if (t.includes(q) || q.includes(t)) return true;
      if (Math.abs(t.length - q.length) > maxDist) return false;
      return editDistance(q, t) <= maxDist;
    });
  }
  return editDistance(q, c) <= maxDist;
}

function cityHaystack(city: CityCatalogItem): string[] {
  const meta = citySearchMeta(city.id);
  return [
    city.id,
    city.name,
    city.district,
    meta.region,
    meta.country,
    ...(meta.aliases ?? []),
  ].filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

export function scoreCitySearch(
  city: CityCatalogItem,
  query: string,
): number {
  const q = normalize(query);
  if (!q) return 0;
  let best = 0;
  for (const field of cityHaystack(city)) {
    const n = normalize(field);
    if (!n) continue;
    if (n === q) best = Math.max(best, 100);
    else if (n.startsWith(q)) best = Math.max(best, 90);
    else if (n.includes(q)) best = Math.max(best, 75);
    else if (tokenFuzzyHit(q, field)) {
      const dist = editDistance(q, n.length > q.length + 4 ? q : n);
      best = Math.max(best, Math.max(40, 70 - dist * 10));
    }
  }
  // Mehrwort-Query: jedes Token muss irgendwo treffen
  const tokens = q.split(' ').filter((t) => t.length >= 2);
  if (tokens.length > 1) {
    const hay = normalize(cityHaystack(city).join(' '));
    const hits = tokens.filter(
      (t) => hay.includes(t) || tokenFuzzyHit(t, hay),
    ).length;
    if (hits === tokens.length) best = Math.max(best, 80);
    else if (hits > 0) best = Math.max(best, 35 + hits * 15);
  }
  return best;
}

export function filterCitiesBySearch(
  cities: CityCatalogItem[],
  query: string,
): CityCatalogItem[] {
  const q = query.trim();
  if (!q) return cities;
  return cities
    .map((c) => ({ c, score: scoreCitySearch(c, q) }))
    .filter((x) => x.score >= 40)
    .sort((a, b) => b.score - a.score || (a.c.distanceKm ?? 9e9) - (b.c.distanceKm ?? 9e9))
    .map((x) => x.c);
}

/** Ohne Suche: nächste Städte (Distanz-Sortierung vorausgesetzt). Mit Suche: alle Treffer. */
export const CITY_PICKER_NEARBY_LIMIT = 8;

export function citiesForPickerGrid(
  cities: CityCatalogItem[],
  opts: {
    excludeId?: string | null;
    query?: string;
    limit?: number;
  } = {},
): CityCatalogItem[] {
  const excludeId = opts.excludeId ?? null;
  const limit = opts.limit ?? CITY_PICKER_NEARBY_LIMIT;
  const q = (opts.query ?? '').trim();
  const pool = excludeId
    ? cities.filter((c) => c.id !== excludeId)
    : cities;
  if (q) return filterCitiesBySearch(pool, q);
  return pool.slice(0, limit);
}
