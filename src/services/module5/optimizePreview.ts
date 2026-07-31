/**
 * Optimieren-Vorschau: gelbe Markierung, Snapshot, Ja/Neu/Mic-Flow.
 */

import { useDayPlanStore } from '../../store/useDayPlanStore';
import {
  todayDateKey,
  type DayPlanItem,
} from '../../types/dayPlan';
import { snapMsTo5Min } from './bufferMath';
import { fillLogisticsGaps } from './smartLogistics';

const HARD_KINDS = new Set(['flight', 'transit', 'wake']);

export type OptimizePreviewResult = {
  dateKey: string;
  changedIds: string[];
  count: number;
};

let optimizeSnapshot: { dateKey: string; items: DayPlanItem[] } | null = null;
let optimizeFailCount = 0;

export function getOptimizeFailCount(): number {
  return optimizeFailCount;
}

export function resetOptimizeFailCount(): void {
  optimizeFailCount = 0;
}

export function bumpOptimizeFailCount(): number {
  optimizeFailCount += 1;
  return optimizeFailCount;
}

function isHardItem(it: DayPlanItem): boolean {
  if (it.hardDeadline) return true;
  if (HARD_KINDS.has(it.kind)) return true;
  return false;
}

function cloneItems(items: DayPlanItem[]): DayPlanItem[] {
  return items.map((it) => ({
    ...it,
    meta: it.meta ? { ...it.meta } : undefined,
  }));
}

/** Sichert Plan vor Optimieren (für Nein / Zurück). */
export function saveOptimizeSnapshot(dateKey = todayDateKey()): void {
  const day = useDayPlanStore.getState().getDay(dateKey);
  optimizeSnapshot = {
    dateKey,
    items: cloneItems(day.items),
  };
}

export function restoreOptimizeSnapshot(dateKey = todayDateKey()): boolean {
  if (!optimizeSnapshot || optimizeSnapshot.dateKey !== dateKey) return false;
  useDayPlanStore.getState().replaceItems(
    dateKey,
    cloneItems(optimizeSnapshot.items),
  );
  useDayPlanStore.getState().addChange(dateKey, {
    summary: 'Plan wieder auf den Ursprung gesetzt',
    reason: 'optimize_discard',
    significant: false,
  });
  clearOptimizePreviewFlags(dateKey);
  return true;
}

export function clearOptimizePreviewFlags(dateKey = todayDateKey()): void {
  const store = useDayPlanStore.getState();
  const day = store.getDay(dateKey);
  let changed = false;
  const next = day.items.map((it) => {
    if (!it.meta?.optimizePreview) return it;
    changed = true;
    const meta = { ...(it.meta ?? {}) };
    delete meta.optimizePreview;
    return { ...it, meta };
  });
  if (changed) store.replaceItems(dateKey, next);
}

/**
 * Soft-Zeiten auf 5-Min-Raster; harte Deadlines (Zug/Flug 13:07) bleiben.
 * Markiert geänderte Items gelb (optimizePreview).
 */
export function buildOptimizePreview(
  dateKey = todayDateKey(),
): OptimizePreviewResult {
  saveOptimizeSnapshot(dateKey);
  const store = useDayPlanStore.getState();
  const day = store.getDay(dateKey);
  const changedIds: string[] = [];

  const next = day.items.map((it) => {
    if (it.status === 'done' || it.status === 'in_progress') return it;
    if (!it.timed || it.startMs == null) return it;
    if (isHardItem(it)) return it;

    const startMs = snapMsTo5Min(it.startMs, 'nearest');
    const endMs =
      it.endMs != null ? snapMsTo5Min(it.endMs, 'nearest') : it.endMs;
    const moved =
      startMs !== it.startMs ||
      (endMs != null && it.endMs != null && endMs !== it.endMs);
    if (!moved) return it;

    changedIds.push(it.id);
    return {
      ...it,
      startMs,
      endMs,
      status: it.status === 'planned' ? ('moved' as const) : it.status,
      meta: {
        ...(it.meta ?? {}),
        optimizePreview: true,
        createdAtMs:
          typeof it.meta?.createdAtMs === 'number'
            ? it.meta.createdAtMs
            : Date.now(),
      },
    };
  });

  store.replaceItems(dateKey, next);
  try {
    fillLogisticsGaps(dateKey);
  } catch {
    /* soft */
  }

  // Nach Logistics erneut Preview-Flags setzen für neu hinzugekommene Soft-Items
  const after = store.getDay(dateKey);
  const flagged = after.items.map((it) => {
    if (changedIds.includes(it.id)) {
      return {
        ...it,
        meta: { ...(it.meta ?? {}), optimizePreview: true },
      };
    }
    // Neu hinzugefügt vs Snapshot?
    const was = optimizeSnapshot?.items.some((o) => o.id === it.id);
    if (!was && it.status !== 'done') {
      changedIds.push(it.id);
      return {
        ...it,
        meta: { ...(it.meta ?? {}), optimizePreview: true },
      };
    }
    return it;
  });
  store.replaceItems(dateKey, flagged);

  const unique = [...new Set(changedIds)];
  store.addChange(dateKey, {
    summary:
      unique.length > 0
        ? `Optimieren-Vorschlag: ${unique.length} Anpassung${unique.length === 1 ? '' : 'en'} (gelb)`
        : 'Optimieren: nichts zu ändern',
    reason: 'optimize_preview',
    significant: unique.length > 0,
  });

  return { dateKey, changedIds: unique, count: unique.length };
}

/** Gelbe Vorschau übernehmen (Flags weg, Snapshot behalten bis klar). */
export function acceptOptimizePreview(dateKey = todayDateKey()): void {
  clearOptimizePreviewFlags(dateKey);
  optimizeSnapshot = null;
  resetOptimizeFailCount();
  useDayPlanStore.getState().addChange(dateKey, {
    summary: 'Optimierung übernommen',
    reason: 'optimize_accept',
    significant: false,
  });
}

/** Neu rechnen — bei 2. Fehlschlag Caller zeigt Stadt neu / Nein. */
export function regenerateOptimizePreview(
  dateKey = todayDateKey(),
): OptimizePreviewResult & { failCount: number } {
  // Zurück zum Snapshot, dann neu
  if (optimizeSnapshot?.dateKey === dateKey) {
    useDayPlanStore.getState().replaceItems(
      dateKey,
      cloneItems(optimizeSnapshot.items),
    );
  }
  const failCount = bumpOptimizeFailCount();
  const result = buildOptimizePreview(dateKey);
  return { ...result, failCount };
}
