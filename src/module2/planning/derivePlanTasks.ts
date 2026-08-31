/**
 * Plan-Tasks aus fixedNodes + openWishesQueue (Node-smoke-sicher, kein RN).
 */

import type {
  IngestFixedNode,
  IngestOpenWish,
  PlanTask,
  TaskCompleteness,
} from './planningTypes';

function clampCompleteness(
  n: unknown,
  fallback: TaskCompleteness,
): TaskCompleteness {
  const v = Number(n);
  if (v === 0 || v === 1 || v === 2) return v;
  return fallback;
}

function inferCompleteness(opts: {
  time: string | null;
  location: string | null;
  needsClarification?: boolean;
  lat?: number | null;
  lng?: number | null;
  completeness?: unknown;
}): TaskCompleteness {
  if (opts.completeness != null) {
    return clampCompleteness(opts.completeness, 2);
  }
  const hasTime = Boolean(opts.time);
  const hasPlace =
    Boolean(opts.location?.trim()) ||
    (typeof opts.lat === 'number' && typeof opts.lng === 'number') ||
    opts.needsClarification === false;
  if (hasTime && hasPlace && !opts.needsClarification) return 0;
  if (hasTime && (!hasPlace || opts.needsClarification)) return 1;
  return 2;
}

export function derivePlanTasks(plan: {
  fixedNodes: IngestFixedNode[];
  openWishesQueue: IngestOpenWish[];
  targetDate: string;
}): PlanTask[] {
  const tasks: PlanTask[] = [];
  for (const n of plan.fixedNodes) {
    const completeness = inferCompleteness({
      time: n.time,
      location: n.location,
      needsClarification: n.needsClarification,
      lat: n.lat,
      lng: n.lng,
    });
    tasks.push({
      id: `fix_${plan.targetDate}_${n.title.replace(/\W+/g, '_').slice(0, 24)}_${n.priority}`,
      title: n.title,
      priority: n.priority,
      completeness,
      timeHm: n.time,
      location: n.location,
      context: n.location || n.title,
      lat: n.lat,
      lng: n.lng,
      address: n.address,
      hard: true,
      status:
        completeness === 0
          ? 'inserted'
          : completeness === 1
            ? 'needs_place'
            : 'queued',
    });
  }
  plan.openWishesQueue.forEach((w, i) => {
    const completeness =
      w.completeness ??
      inferCompleteness({
        time: w.estimatedTime ?? null,
        location: w.context,
        lat: w.lat,
        lng: w.lng,
      });
    tasks.push({
      id: w.id ?? `wish_${plan.targetDate}_${i}`,
      title: w.title,
      priority: w.priority,
      completeness,
      timeHm: w.estimatedTime ?? null,
      location: w.address ?? null,
      context: w.context,
      lat: w.lat,
      lng: w.lng,
      address: w.address,
      hard: false,
      status: completeness === 0 ? 'inserted' : 'queued',
    });
  });
  return tasks.sort((a, b) => {
    if (a.priority === 6 && b.priority !== 6) return 1;
    if (b.priority === 6 && a.priority !== 6) return -1;
    const ta = a.timeHm || '99:99';
    const tb = b.timeHm || '99:99';
    if (ta !== tb) return ta.localeCompare(tb);
    return a.priority - b.priority;
  });
}
