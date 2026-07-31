/**
 * Eine Achse: Vergangenheit (Zeitachse) über „Jetzt“, Zukunft (Planung) darunter.
 * Modul-1-Orte + Visit-Log fließen in die Vergangenheit.
 */

import { useDayPlanStore } from '../../store/useDayPlanStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import {
  clockLabel,
  dateKeyFromMs,
  todayDateKey,
  uid,
  type DayPlanItem,
} from '../../types/dayPlan';
import { effectiveTimes } from './planVsActual';
import {
  getVisitsForDate,
  upsertVisitFromStamp,
} from '../timeline/visitLog';
import { markAsFindusSuggestion } from './userBossPlan';
import { isWishItem } from './timelineVisual';

export type AxisBucket = 'past' | 'now' | 'future';

export type AxisEntry = {
  id: string;
  bucket: AxisBucket;
  sortMs: number;
  item: DayPlanItem;
  /** Herkunftshinweis für UI */
  origin?: 'plan' | 'visit' | 'module1';
};

function syntheticFromVisit(v: {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  poiId: number | null;
  arrivedAtMs: number;
  leftAtMs: number | null;
  dwellMin: number | null;
  source: string;
}): DayPlanItem {
  return {
    id: `vis-${v.id}`,
    kind: 'activity',
    title: v.name,
    startMs: v.arrivedAtMs,
    endMs: v.leftAtMs,
    timed: true,
    status: 'done',
    lat: v.lat,
    lng: v.lng,
    placeName: v.name,
    source: 'nav',
    actualStartMs: v.arrivedAtMs,
    actualEndMs: v.leftAtMs,
    sortOrder: 10,
    notes:
      v.dwellMin != null
        ? `Verweilt ${v.dwellMin} Min · ${v.source}`
        : `Besucht · ${v.source}`,
    meta: {
      visitLogId: v.id,
      poiId: v.poiId,
      module1: v.source === 'stamp' || v.source === 'dwell',
      origin: 'visit',
    },
  };
}

function axisSortMs(item: DayPlanItem, now: number): number {
  const eff = effectiveTimes(item);
  if (eff.startMs != null) return eff.startMs;
  if (item.status === 'done' && item.actualEndMs != null) return item.actualEndMs;
  // Untimed Planung → Zukunft (knapp nach jetzt, nach SortOrder)
  return now + 60_000 + (item.sortOrder ?? 500) * 1_000;
}

function isPastItem(item: DayPlanItem, now: number): boolean {
  if (item.status === 'done' || item.status === 'skipped') return true;
  if (item.meta?.module1 === true || item.meta?.origin === 'module1') return true;
  if (item.meta?.origin === 'visit') return true;
  const eff = effectiveTimes(item);
  if (eff.endMs != null && eff.endMs < now) return true;
  if (item.status === 'in_progress') return false;
  if (eff.startMs != null && eff.startMs < now) return true;
  return false;
}

function isFutureItem(item: DayPlanItem, now: number): boolean {
  return !isPastItem(item, now);
}

/**
 * Baut eine sortierte Achse für dateKey (Past ↑ → Jetzt → Future ↓).
 */
export function buildUnifiedDayAxis(opts?: {
  dateKey?: string;
  nowMs?: number;
}): { past: AxisEntry[]; future: AxisEntry[]; nowMs: number; dateKey: string } {
  const dateKey = opts?.dateKey ?? todayDateKey();
  const now = opts?.nowMs ?? Date.now();
  const day = useDayPlanStore.getState().getDay(dateKey);
  const planItems = [...day.items];

  // Visit-Log → synthetische Past-Items (wenn nicht schon im Plan)
  const visits = getVisitsForDate(dateKey);
  for (const v of visits) {
    const exists = planItems.some(
      (i) =>
        i.meta?.visitLogId === v.id ||
        (i.placeName?.toLowerCase() === v.name.toLowerCase() &&
          i.actualStartMs != null &&
          Math.abs((i.actualStartMs ?? 0) - v.arrivedAtMs) < 20 * 60_000),
    );
    if (!exists) planItems.push(syntheticFromVisit(v));
  }

  // Stempel (besuchte Orte / Passport) des Tages
  const stamps = useFinnusStore
    .getState()
    .visitedHistory.filter((s) => dateKeyFromMs(s.visitedAt) === dateKey);
  for (const s of stamps) {
    // Keine Koordinaten-Fake-Orte in der Planung
    if (/^ort\s*(bei\s*)?\d/i.test(s.name.trim())) continue;
    const exists = planItems.some(
      (i) =>
        (i.meta?.poiId === s.poiId &&
          i.actualStartMs != null &&
          Math.abs((i.actualStartMs ?? 0) - s.visitedAt) < 30 * 60_000) ||
        (i.placeName?.toLowerCase() === s.name.toLowerCase() &&
          i.actualStartMs != null &&
          Math.abs((i.actualStartMs ?? 0) - s.visitedAt) < 30 * 60_000),
    );
    if (exists) continue;
    const dwell =
      s.keyFacts?.find((f) => /verweilt\s+(\d+)/i.test(f))?.match(/(\d+)/)?.[1];
    planItems.push({
      id: `m1-${s.poiId}-${s.visitedAt}`,
      kind: 'activity',
      title: s.name,
      startMs: s.visitedAt,
      endMs: dwell
        ? s.visitedAt + Number(dwell) * 60_000
        : s.visitedAt + 15 * 60_000,
      timed: true,
      status: 'done',
      source: 'nav',
      actualStartMs: s.visitedAt,
      actualEndMs: dwell
        ? s.visitedAt + Number(dwell) * 60_000
        : s.visitedAt + 15 * 60_000,
      placeName: s.name,
      sortOrder: 5,
      notes: 'Besucht',
      meta: {
        poiId: s.poiId,
        module1: true,
        origin: 'module1',
      },
    });
  }

  const past: AxisEntry[] = [];
  const future: AxisEntry[] = [];

  for (const item of planItems) {
    const sortMs = axisSortMs(item, now);
    if (isPastItem(item, now)) {
      past.push({
        id: item.id,
        bucket: 'past',
        sortMs,
        item,
        origin:
          item.meta?.origin === 'module1'
            ? 'module1'
            : item.meta?.origin === 'visit'
              ? 'visit'
              : 'plan',
      });
    } else if (isFutureItem(item, now)) {
      future.push({
        id: item.id,
        bucket: 'future',
        sortMs,
        item,
        origin: 'plan',
      });
    } else {
      // in_progress overlapping now → future side near now
      future.push({
        id: item.id,
        bucket: 'future',
        sortMs: Math.min(sortMs, now + 1),
        item,
        origin: 'plan',
      });
    }
  }

  past.sort((a, b) => a.sortMs - b.sortMs);
  future.sort((a, b) => a.sortMs - b.sortMs);

  return { past, future, nowMs: now, dateKey };
}

/**
 * Modul-1 / Stempel → Visit-Log + DayPlan-Ist (Vergangenheit der Achse).
 */
export function noteModule1PlaceOnAxis(opts: {
  name: string;
  lat?: number | null;
  lng?: number | null;
  poiId?: number | null;
  atMs?: number;
  dwellMin?: number | null;
  source?: 'stamp' | 'dwell' | 'nav';
}): void {
  const at = opts.atMs ?? Date.now();
  const dateKey = dateKeyFromMs(at);
  upsertVisitFromStamp({
    name: opts.name,
    lat: opts.lat,
    lng: opts.lng,
    poiId: opts.poiId,
    arrivedAtMs: at,
    dwellMin: opts.dwellMin ?? null,
    source: opts.source ?? 'stamp',
  });

  const store = useDayPlanStore.getState();
  store.ensureDay(dateKey);
  const day = store.getDay(dateKey);
  const exists = day.items.some(
    (i) =>
      (opts.poiId != null && i.meta?.poiId === opts.poiId) ||
      (i.placeName?.toLowerCase() === opts.name.toLowerCase() &&
        i.actualStartMs != null &&
        Math.abs(i.actualStartMs - at) < 20 * 60_000),
  );
  if (exists) return;

  const dwell = opts.dwellMin ?? 15;
  store.upsertItem(dateKey, {
    id: uid('m1'),
    kind: 'activity',
    title: opts.name,
    startMs: at,
    endMs: at + dwell * 60_000,
    timed: true,
    status: 'done',
    lat: opts.lat,
    lng: opts.lng,
    placeName: opts.name,
    source: 'nav',
    actualStartMs: at,
    actualEndMs: at + dwell * 60_000,
    sortOrder: 5,
    notes: 'Besucht',
    meta: {
      poiId: opts.poiId,
      module1: true,
      origin: 'module1',
    },
  });
}

export function formatNowLabel(nowMs = Date.now()): string {
  return `Jetzt · ${clockLabel(nowMs)}`;
}

/** Soft-Tour-Stops als blaue Wünsche markieren. */
export function markTourStopsAsWishes(dateKey = todayDateKey()): void {
  const store = useDayPlanStore.getState();
  const day = store.getDay(dateKey);
  for (const it of day.items) {
    if (it.meta?.tour && it.meta?.findusSuggestion) {
      store.upsertItem(
        dateKey,
        markAsFindusSuggestion({
          ...it,
          meta: { ...it.meta, wish: true },
        }),
      );
    }
  }
}

export { isWishItem };
