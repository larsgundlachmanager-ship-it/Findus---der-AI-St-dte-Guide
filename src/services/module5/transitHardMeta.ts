/**
 * Harte Transit-Metadaten für Modul-5 Watches (kein Title-Regex).
 */

import type { DayPlanItem } from '../../types/dayPlan';

export const TRANSIT_META_TYPE = 'transit_train' as const;

export type TransitHardMeta = {
  type: typeof TRANSIT_META_TYPE;
  stationName?: string;
  stationId?: string | null;
  trainHint?: string | null;
  leaveByMs?: number;
  plannedDepartMs?: number;
  mode?: 'transit';
  source?: string;
  delaySec?: number | null;
  walkToStopMin?: number;
};

export function isTransitWatchItem(it: DayPlanItem): boolean {
  const t = it.meta?.type;
  if (t === TRANSIT_META_TYPE || t === 'transit' || t === 'öpnv') return true;
  if (it.kind === 'transit' && it.meta?.leaveByMs != null) return true;
  return false;
}

export function stampTransitHardMeta(
  item: DayPlanItem,
  meta: Partial<TransitHardMeta> & {
    stationName?: string | null;
    leaveByMs?: number;
  },
): DayPlanItem {
  return {
    ...item,
    kind: item.kind === 'nav' && meta.mode === 'transit' ? 'transit' : item.kind,
    placeName: meta.stationName ?? item.placeName,
    meta: {
      ...(item.meta ?? {}),
      type: TRANSIT_META_TYPE,
      mode: 'transit',
      stationName: meta.stationName ?? item.placeName ?? undefined,
      stationId: meta.stationId ?? null,
      trainHint: meta.trainHint ?? null,
      leaveByMs: meta.leaveByMs,
      plannedDepartMs: meta.plannedDepartMs ?? item.startMs ?? undefined,
      source: meta.source,
      delaySec: meta.delaySec,
      walkToStopMin: meta.walkToStopMin,
    },
  };
}

export function readTransitWatchFields(it: DayPlanItem): {
  stationName: string;
  stationId: string | null;
  trainHint: string | null;
  leaveByMs: number;
  plannedDepartMs: number;
} | null {
  if (!isTransitWatchItem(it) || it.startMs == null) return null;
  const leaveByMs =
    typeof it.meta?.leaveByMs === 'number'
      ? it.meta.leaveByMs
      : it.startMs - 15 * 60_000;
  const stationName =
    (typeof it.meta?.stationName === 'string' && it.meta.stationName) ||
    it.placeName?.trim() ||
    it.title;
  return {
    stationName,
    stationId:
      typeof it.meta?.stationId === 'string' ? it.meta.stationId : null,
    trainHint:
      typeof it.meta?.trainHint === 'string' ? it.meta.trainHint : null,
    leaveByMs,
    plannedDepartMs:
      typeof it.meta?.plannedDepartMs === 'number'
        ? it.meta.plannedDepartMs
        : it.startMs,
  };
}
