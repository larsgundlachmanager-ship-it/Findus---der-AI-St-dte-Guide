/**
 * Expanding Place Search — SSOT.
 * Lokal/OSM (€0) wächst schrittweise; Google nur als Fallback wenn nötig.
 * Nie „nichts gefunden“ ohne weiteren Versuch; bei großer Distanz klar sagen.
 */

import {
  searchOpenPlacesAhead,
  type DiscoveredPlace,
} from './googleMapsNav';

/** Ringe um Live-GPS (m). Google Nearby hard-cap ~50 km. */
export const PLACE_EXPAND_RINGS_M = [
  1_500, 3_500, 8_000, 15_000, 30_000, 50_000,
] as const;

/** Ab dieser Distanz Speech: „~X km — passt das?“ */
export const PLACE_FAR_SPEECH_M = 8_000;

export type ExpandingPlaceSearchResult = {
  places: DiscoveredPlace[];
  /** Radius des Rings, in dem genug Treffer kamen */
  ringUsedM: number;
  /** true wenn Treffer deutlich außerhalb Fuß-Nähe */
  far: boolean;
  /** Kurzer Label-Text für Speech („bis ~30 km“) */
  expandLabel: string | null;
  notes: string[];
};

function kmLabel(m: number): string {
  const km = m >= 1000 ? Math.round(m / 1000) : Math.max(1, Math.round(m / 100) / 10);
  return `~${km} km`;
}

/** Parallel-Agents: gleiche Expanding-Query nicht 5× bezahlen. */
const EXPAND_MEMO_TTL_MS = 6 * 60_000;
const expandMemo = new Map<
  string,
  { at: number; result: ExpandingPlaceSearchResult; inflight?: Promise<ExpandingPlaceSearchResult> }
>();

function expandMemoKey(opts: {
  lat: number;
  lng: number;
  placeType: string;
  keyword?: string | null;
  openNow?: boolean;
  minResults?: number;
  fallbackTypes?: string[];
  strictOpenNow?: boolean;
}): string {
  return [
    opts.placeType,
    (opts.keyword ?? '').toLowerCase().trim(),
    opts.openNow === false ? 'any' : 'open',
    opts.strictOpenNow ? 'strict' : 'flex',
    opts.minResults ?? 2,
    (opts.fallbackTypes ?? []).join(','),
    opts.lat.toFixed(3),
    opts.lng.toFixed(3),
  ].join('|');
}

/**
 * Sucht placeType/keyword in wachsenden Ringen bis minResults oder max Ring.
 * openNow: erst streng, bei leerem äußerem Ring nochmal ohne Open-Filter.
 */
export async function searchPlacesExpanding(opts: {
  lat: number;
  lng: number;
  placeType: string;
  keyword?: string | null;
  openNow?: boolean;
  /** Mindest-Treffer bevor wir stoppen (Default 2) */
  minResults?: number;
  rings?: readonly number[];
  /** Fallback placeTypes wenn Primärtyp leer bleibt (z. B. restaurant → meal_takeaway) */
  fallbackTypes?: string[];
  /** Kein Closed-Fallback („besser als nichts“) — Survival/Handy-laden. */
  strictOpenNow?: boolean;
}): Promise<ExpandingPlaceSearchResult> {
  const key = expandMemoKey(opts);
  const cached = expandMemo.get(key);
  if (cached) {
    if (cached.inflight) return cached.inflight;
    if (Date.now() - cached.at <= EXPAND_MEMO_TTL_MS) {
      return {
        ...cached.result,
        places: cached.result.places.map((p) => ({ ...p })),
        notes: [...cached.result.notes, 'memo-hit'],
      };
    }
    expandMemo.delete(key);
  }

  const inflight = runExpandingSearch(opts);
  expandMemo.set(key, {
    at: Date.now(),
    result: {
      places: [],
      ringUsedM: opts.rings?.[0] ?? PLACE_EXPAND_RINGS_M[0],
      far: false,
      expandLabel: null,
      notes: [],
    },
    inflight,
  });
  try {
    const result = await inflight;
    expandMemo.set(key, { at: Date.now(), result });
    if (expandMemo.size > 40) {
      const oldest = [...expandMemo.entries()].sort(
        (a, b) => a[1].at - b[1].at,
      )[0];
      if (oldest) expandMemo.delete(oldest[0]);
    }
    return result;
  } catch (err) {
    expandMemo.delete(key);
    throw err;
  }
}

async function runExpandingSearch(opts: {
  lat: number;
  lng: number;
  placeType: string;
  keyword?: string | null;
  openNow?: boolean;
  minResults?: number;
  rings?: readonly number[];
  fallbackTypes?: string[];
  strictOpenNow?: boolean;
}): Promise<ExpandingPlaceSearchResult> {
  const rings = opts.rings?.length ? opts.rings : PLACE_EXPAND_RINGS_M;
  const minResults = Math.max(1, opts.minResults ?? 2);
  const notes: string[] = [];
  const collected: DiscoveredPlace[] = [];
  const seen = new Set<string>();

  const pushAll = (batch: DiscoveredPlace[]) => {
    for (const p of batch) {
      const key = (p.placeId || `${p.name}:${p.lat}:${p.lng}`).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(p);
    }
  };

  const typesToTry = [
    opts.placeType,
    ...(opts.fallbackTypes ?? []).filter((t) => t && t !== opts.placeType),
  ];

  let ringUsedM = rings[0] ?? 1500;

  for (const ring of rings) {
    ringUsedM = ring;
    for (const placeType of typesToTry) {
      try {
        const batch = await searchOpenPlacesAhead({
          lat: opts.lat,
          lng: opts.lng,
          placeType,
          keyword: opts.keyword,
          radiusM: ring,
          openNow: opts.openNow !== false,
        });
        pushAll(batch);
        notes.push(`ring:${ring}:type:${placeType}:n=${batch.length}`);
      } catch {
        notes.push(`ring:${ring}:type:${placeType}:fail`);
      }
      if (collected.length >= minResults) break;
    }
    if (collected.length >= minResults) break;
  }

  // Letzter Versuch: größter Ring ohne openNow (geschlossene zählen besser als nichts).
  // Survival / Handy-laden: nie — geschlossenes Café ist kein Lade-Spot.
  if (collected.length < 1 && opts.openNow !== false && !opts.strictOpenNow) {
    const lastRing = rings[rings.length - 1] ?? 50_000;
    ringUsedM = lastRing;
    for (const placeType of typesToTry) {
      try {
        const batch = await searchOpenPlacesAhead({
          lat: opts.lat,
          lng: opts.lng,
          placeType,
          keyword: opts.keyword,
          radiusM: lastRing,
          openNow: false,
        });
        pushAll(batch);
        notes.push(`ring:${lastRing}:any-hours:type:${placeType}:n=${batch.length}`);
      } catch {
        /* soft */
      }
      if (collected.length >= 1) break;
    }
  }

  collected.sort((a, b) => a.distanceM - b.distanceM);

  const farthest = collected.length
    ? Math.max(...collected.map((p) => p.distanceM))
    : 0;
  const far = farthest >= PLACE_FAR_SPEECH_M;
  const expandLabel =
    collected.length === 0
      ? null
      : far
        ? `bis ${kmLabel(Math.max(farthest, ringUsedM))}`
        : ringUsedM > 3_500
          ? 'der Umgebung'
          : null;

  return {
    places: collected.slice(0, 12),
    ringUsedM,
    far,
    expandLabel,
    notes,
  };
}

/** Speech-Zusatz wenn Treffer weit weg. */
export function farPlaceSpeechHint(
  placeName: string,
  distanceM: number,
): string {
  if (distanceM < PLACE_FAR_SPEECH_M) return '';
  return ` Gefunden: ${placeName}, liegt ~${kmLabel(distanceM)} — passt das?`;
}
