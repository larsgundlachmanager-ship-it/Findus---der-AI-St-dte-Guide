import type { Poi } from '../../db/types';

export type PlanStopHint = {
  id?: string | null;
  title?: string | null;
  notes?: string | null;
  lat?: number | null;
  lng?: number | null;
  status?: string | null;
  kind?: string | null;
  poiId?: number | null;
};

const GENERIC_TOKENS = new Set([
  'park',
  'platz',
  'hof',
  'weg',
  'strasse',
  'str',
  'markt',
  'hotel',
  'cafe',
  'kita',
  'kindergarten',
  'schule',
  'kirche',
  'museum',
  'hafen',
  'strand',
  'garten',
  'zentrum',
  'stadt',
  'haus',
  'am',
  'im',
  'der',
  'die',
  'das',
  'von',
  'zum',
  'zur',
]);

function normName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s*[·•|]\s*wegweiser\s*$/i, '')
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function approxMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = (lat2 - lat1) * 111_320;
  const dLng =
    (lng2 - lng1) * 111_320 * Math.cos(((lat1 + lat2) * 0.5 * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function significantTokens(name: string): string[] {
  return name.split(' ').filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t));
}

function namesMatch(a: string, b: string): boolean {
  if (!a || !b || a.length < 3 || b.length < 3) return false;
  if (a === b) return true;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (short.length >= 8 && long.includes(short)) return true;
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (!ta.length || !tb.length) return false;
  const tbSet = new Set(tb);
  const shared = ta.filter((t) => tbSet.has(t));
  if (shared.some((t) => t.length >= 10)) return true;
  return shared.length >= 2;
}

function poiIdFromStop(stop: PlanStopHint): number | null {
  if (typeof stop.poiId === 'number' && Number.isFinite(stop.poiId) && stop.poiId > 0) {
    return stop.poiId;
  }
  const id = String(stop.id ?? '');
  const live = id.match(/^nav_live_tour_\d+_(\d+)$/);
  if (live) return Number(live[1]);
  const tour = id.match(/^tour_[^_]+_(\d+)$/);
  if (tour) return Number(tour[1]);
  if (/^\d{3,}$/.test(id)) return Number(id);
  return null;
}

/**
 * POI-IDs, die wirklich im Plan stehen — nicht die ganze Nachbarschaft.
 * Name strikt, sonst höchstens der nächste POI am Stopp (~25 m).
 */
export function plannedPoiIdSet(
  pois: Poi[],
  stops: PlanStopHint[],
): Set<number> {
  const out = new Set<number>();
  const open = stops.filter((s) => {
    if ((s.status ?? '') === 'done') return false;
    if ((s.kind ?? '') === 'nav_leg') return false;
    return true;
  });
  if (!open.length || !pois.length) return out;

  const byId = new Map(pois.map((p) => [p.id, p]));

  for (const stop of open) {
    const fromId = poiIdFromStop(stop);
    if (fromId != null && byId.has(fromId)) {
      out.add(fromId);
      continue;
    }

    const title = normName(stop.title ?? '');
    let named: Poi | null = null;
    for (const poi of pois) {
      if (namesMatch(normName(poi.name ?? ''), title)) {
        named = poi;
        break;
      }
    }
    if (named) {
      out.add(named.id);
      continue;
    }

    const slat = stop.lat;
    const slng = stop.lng;
    if (
      typeof slat !== 'number' ||
      typeof slng !== 'number' ||
      !Number.isFinite(slat) ||
      !Number.isFinite(slng)
    ) {
      continue;
    }

    let best: Poi | null = null;
    let bestM = Infinity;
    for (const poi of pois) {
      if (!Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) continue;
      const m = approxMeters(poi.lat, poi.lng, slat, slng);
      if (m < bestM) {
        bestM = m;
        best = poi;
      }
    }
    if (!best || bestM > 28) continue;
    const looseName = namesMatch(normName(best.name ?? ''), title);
    if (looseName || bestM <= 16) out.add(best.id);
  }

  return out;
}

/** Alle offenen Stops aus Future-Plan-Store (aktiv + andere Tage). */
export function collectOpenPlanStops(): PlanStopHint[] {
  try {
    const { useFuturePlanStore } = require('../../module2/timeline/futurePlanState') as {
      useFuturePlanStore: {
        getState: () => {
          plan: { stops?: PlanStopHint[] };
          plansByDay: Record<string, { stops?: PlanStopHint[] }>;
        };
      };
    };
    const st = useFuturePlanStore.getState();
    const bags = [st.plan, ...Object.values(st.plansByDay ?? {})];
    const out: PlanStopHint[] = [];
    for (const bag of bags) {
      for (const s of bag?.stops ?? []) out.push(s);
    }
    return out;
  } catch {
    return [];
  }
}
