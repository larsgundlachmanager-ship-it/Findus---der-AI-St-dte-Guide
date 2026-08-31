/**
 * Rubbelkarte: Pack-Stadtgrenzen.
 * Grün = gerade in der Stadt ODER ≥30 Min vor Ort (dann dauerhaft).
 * Blau = irgendwas in der Timeline in der Stadt (auch nur Kaffee).
 * Rot = Pack ohne Besuch/Plan.
 */

import type { PlanStopHint } from '../navigation/stampMapPlanMatch';

export type HomeMapCityTone = 'visited' | 'planned' | 'catalog';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Fester Timeline-Ort (committed Stop), kein Wish / Nav-Leg / Choice. */
export function isFirmTimelineStop(s: PlanStopHint): boolean {
  if ((s.status ?? '') === 'done') return false;
  const kind = (s.kind ?? 'stop').toLowerCase();
  if (kind === 'nav_leg' || kind === 'wish') return false;
  if (kind !== 'stop') return false;
  const id = (s.id ?? '').toLowerCase();
  if (id.startsWith('choice_') || id.startsWith('wish_')) return false;
  return (
    typeof s.lat === 'number' &&
    typeof s.lng === 'number' &&
    Number.isFinite(s.lat) &&
    Number.isFinite(s.lng)
  );
}

/** Alles Geplante, das eine Stadt blau färben darf — Kaffee reicht. */
export function isTimelineCityPlanStop(s: PlanStopHint): boolean {
  if ((s.status ?? '') === 'done') return false;
  const kind = (s.kind ?? 'stop').toLowerCase();
  if (kind === 'nav_leg') return false;
  const id = (s.id ?? '').toLowerCase();
  if (id.startsWith('choice_')) return false;
  return kind === 'stop' || kind === 'wish' || kind === '';
}

export function collectFirmTimelineStops(): PlanStopHint[] {
  const { collectOpenPlanStops } =
    require('../navigation/stampMapPlanMatch') as typeof import('../navigation/stampMapPlanMatch');
  return collectOpenPlanStops().filter(isFirmTimelineStop);
}

export function collectTimelineCityPlanStops(): PlanStopHint[] {
  const { collectOpenPlanStops } =
    require('../navigation/stampMapPlanMatch') as typeof import('../navigation/stampMapPlanMatch');
  return collectOpenPlanStops().filter(isTimelineCityPlanStop);
}

function titleMentionsCity(blob: string, cityName: string, cityId: string): boolean {
  const t = blob.toLowerCase();
  const names = [cityName, cityId.replace(/-/g, ' ')].map((n) => n.trim().toLowerCase());
  for (const n of names) {
    if (n.length < 4) continue;
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(n)}(?:$|[^\\p{L}\\p{N}])`, 'iu');
    if (re.test(t)) return true;
  }
  return false;
}

/**
 * Welche Pack-Stadt(en) ein Timeline-Stop berührt.
 * GPS im Gemeindegebiet, Stadtname im Titel, oder POI-Treffer.
 */
export function cityIdsForPlanStop(
  s: PlanStopHint,
  opts: {
    cities: Array<{ cityId: string; name: string }>;
    locate?: (lat: number, lng: number) => string | null;
    pois?: Array<{ lat: number; lng: number; name?: string | null }>;
  },
): string[] {
  const ids = new Set<string>();
  const locate = opts.locate;
  if (
    locate &&
    typeof s.lat === 'number' &&
    typeof s.lng === 'number' &&
    Number.isFinite(s.lat) &&
    Number.isFinite(s.lng)
  ) {
    const hit = locate(s.lat, s.lng);
    if (hit) ids.add(hit.toLowerCase());
  }
  const blob = `${s.title ?? ''} ${s.notes ?? ''}`;
  for (const c of opts.cities) {
    if (titleMentionsCity(blob, c.name, c.cityId)) ids.add(c.cityId.toLowerCase());
  }
  if (locate && opts.pois?.length && blob.trim().length >= 4) {
    const want = blob.toLowerCase();
    for (const p of opts.pois) {
      const n = (p.name ?? '').trim();
      if (n.length < 4) continue;
      if (!want.includes(n.toLowerCase()) && !n.toLowerCase().includes(want.trim())) {
        continue;
      }
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const hit = locate(p.lat, p.lng);
      if (hit) ids.add(hit.toLowerCase());
    }
  }
  return [...ids];
}

/**
 * Grün schlägt Blau.
 * hereNow = GPS gerade in der Stadt (sofort, nicht dauerhaft).
 * dwellGreen = ≥30 Min vor Ort (dauerhaft).
 */
export function resolveHomeMapCityTone(opts: {
  dwellGreen: boolean;
  firmPlan: boolean;
  hereNow?: boolean;
}): HomeMapCityTone {
  if (opts.hereNow || opts.dwellGreen) return 'visited';
  if (opts.firmPlan) return 'planned';
  return 'catalog';
}
