/**
 * Manuelles Löschen / Umsortieren der „Offenen Pläne“.
 */

import { emojiForPlace } from '../../services/navigation/stampBullets';
import { buildDayTimeline, type OpenPlanItem } from './buildDayTimeline';
import { useFuturePlanStore } from './futurePlanState';
import { kickGapFillInBackground } from './planTravelHelpers';
import { retireCommitmentsForStop } from './retireTimelineCommitments';

function taskIdFromOpenId(openId: string): string | null {
  if (openId.startsWith('wish_')) {
    const rest = openId.slice(5).trim();
    return rest || null;
  }
  return null;
}

function dayKeyForOpenEdits(): string {
  try {
    const { usePlanCalendarUiStore } = require('./planCalendarUiStore') as {
      usePlanCalendarUiStore: {
        getState: () => { requestedDayKey: string | null };
      };
    };
    const dk = usePlanCalendarUiStore.getState().requestedDayKey?.trim();
    if (dk && /^\d{4}-\d{2}-\d{2}$/.test(dk)) return dk;
  } catch {
    /* soft */
  }
  return useFuturePlanStore.getState().plan.dayKey;
}

function listOpenPlans(): OpenPlanItem[] {
  return buildDayTimeline(dayKeyForOpenEdits(), Date.now()).openPlans;
}

/** Alle sichtbaren Offenen Pläne als Wish-Stops mit openOrder materialisieren. */
function materializeOpenOrder(items: OpenPlanItem[]): void {
  const store = useFuturePlanStore.getState();
  const dayKey = dayKeyForOpenEdits();
  store.ensureDay(dayKey);
  const dayStops = store.getPlanForDay(dayKey).stops;
  const transport = store.plan.transportDefault;
  for (let i = 0; i < items.length; i++) {
    const p = items[i]!;
    const existing = dayStops.find((s) => s.id === p.id);
    const taskId = taskIdFromOpenId(p.id) ?? existing?.planTaskId ?? null;
    store.upsertStopOnDay(dayKey, {
      id: p.id,
      title: p.title,
      emoji: p.emoji || emojiForPlace({ name: p.title }),
      kind: 'wish',
      bufferMin: existing?.bufferMin ?? 0,
      transport: existing?.transport ?? transport,
      hardAnchor: p.hardAnchor ?? existing?.hardAnchor,
      planPriority: p.planPriority ?? existing?.planPriority ?? null,
      planTaskId: taskId,
      openOrder: i,
      status: p.status ?? existing?.status ?? 'planned',
      notes: existing?.notes,
      lat: existing?.lat,
      lng: existing?.lng,
    });
  }
}

function recalcTimelineAfterOpenEdit(): void {
  try {
    const { applyGapFillTravelLegs } = require('./gapFillTravel') as {
      applyGapFillTravelLegs: () => void;
    };
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }
  kickGapFillInBackground();
}

function clearProposalsLinkedToOpenPlan(opts: {
  openId: string;
  taskId: string | null;
  title: string | null;
}): boolean {
  let cleared = false;
  let pendingStepKey: string | null = null;

  try {
    const { usePlanCalendarUiStore } = require('./planCalendarUiStore') as {
      usePlanCalendarUiStore: {
        getState: () => {
          pendingChoice: {
            stepKey: string;
            options: Array<{ title: string }>;
          } | null;
          clearPendingChoice: () => void;
          clearMirroredActions: () => void;
          clearShortAnswers: () => void;
        };
      };
    };
    const ui = usePlanCalendarUiStore.getState();
    const pending = ui.pendingChoice;
    pendingStepKey = pending?.stepKey?.trim() || null;
    const titleNorm = (opts.title || '').trim().toLowerCase();
    const stepNorm = (pendingStepKey || '').toLowerCase();
    const matchesPending =
      !!pending &&
      ((!!opts.taskId &&
        (stepNorm === opts.taskId.toLowerCase() ||
          stepNorm.includes(opts.taskId.toLowerCase()))) ||
        (!!titleNorm &&
          (stepNorm === titleNorm ||
            stepNorm.includes(titleNorm.slice(0, 12)) ||
            titleNorm.includes(stepNorm.slice(0, 12)) ||
            pending.options.some((o) => {
              const ot = o.title
                .replace(/^[🥇🥈❓]\s*/u, '')
                .toLowerCase();
              return (
                ot.includes(titleNorm.slice(0, 10)) ||
                titleNorm.includes(ot.slice(0, 10))
              );
            }))));

    if (matchesPending) {
      ui.clearPendingChoice();
      ui.clearMirroredActions();
      ui.clearShortAnswers();
      cleared = true;
    }
  } catch {
    /* soft */
  }

  try {
    const stepKeys = new Set<string>();
    if (opts.title?.trim()) stepKeys.add(opts.title.trim());
    if (opts.taskId) stepKeys.add(opts.taskId);
    if (cleared && pendingStepKey) {
      stepKeys.add(pendingStepKey);
    }
    if (stepKeys.size === 0 && !cleared) return cleared;

    const stops = [...useFuturePlanStore.getState().plan.stops];
    for (const s of stops) {
      if (!s.id.startsWith('choice_')) continue;
      const group = (s.choiceGroupId || '').trim();
      const linked =
        cleared && stepKeys.size === 0
          ? true
          : [...stepKeys].some((k) => {
              const kl = k.toLowerCase();
              const gl = group.toLowerCase();
              return (
                group === k ||
                gl === kl ||
                s.id.toLowerCase().includes(kl.slice(0, 24)) ||
                (kl.length >= 6 && gl.includes(kl.slice(0, 12)))
              );
            });
      if (linked) {
        useFuturePlanStore.getState().removeStop(s.id);
        cleared = true;
      }
    }
  } catch {
    /* soft */
  }

  return cleared;
}

/** Offenen Plan löschen (Wish-Stop) + Timeline neu rechnen. */
export function removeOpenPlan(openId: string): void {
  const store = useFuturePlanStore.getState();
  store.ensureDay(dayKeyForOpenEdits());
  const removedStop = store.plan.stops.find((s) => s.id === openId);
  const removedTitle =
    removedStop?.title ??
    listOpenPlans().find((p) => p.id === openId)?.title ??
    null;

  const taskId =
    taskIdFromOpenId(openId) ?? removedStop?.planTaskId ?? null;

  clearProposalsLinkedToOpenPlan({
    openId,
    taskId,
    title: removedTitle,
  });

  store.removeStop(openId);
  if (removedStop) {
    try {
      retireCommitmentsForStop(removedStop);
    } catch {
      /* soft */
    }
  }
  if (taskId) {
    store.removeStop(`wish_${taskId}`);
  }

  const left = listOpenPlans().filter((p) => p.id !== openId);
  if (left.length > 0) {
    materializeOpenOrder(left);
  }

  recalcTimelineAfterOpenEdit();
}

/** Offenen Plan eine Position nach oben/unten. */
export function moveOpenPlan(
  openId: string,
  direction: 'up' | 'down',
): void {
  const items = listOpenPlans();
  const idx = items.findIndex((p) => p.id === openId);
  if (idx < 0) return;
  const j = direction === 'up' ? idx - 1 : idx + 1;
  if (j < 0 || j >= items.length) return;

  materializeOpenOrder(items);
  const next = [...items];
  const tmp = next[idx]!;
  next[idx] = next[j]!;
  next[j] = tmp;
  materializeOpenOrder(next);
}

/** Drag-Reorder auf Zielindex. */
export function reorderOpenPlan(fromId: string, toIndex: number): void {
  const items = listOpenPlans();
  const from = items.findIndex((p) => p.id === fromId);
  if (from < 0) return;
  const to = Math.max(0, Math.min(items.length - 1, toIndex));
  if (from === to) return;
  materializeOpenOrder(items);
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (!moved) return;
  next.splice(to, 0, moved);
  materializeOpenOrder(next);
}

/** Tippen auf offenen Plan → nach vorne in der Liste. */
export function focusOpenPlanNext(openId: string): void {
  const items = listOpenPlans();
  const idx = items.findIndex((p) => p.id === openId);
  if (idx < 0) return;
  if (idx > 0) {
    materializeOpenOrder(items);
    const next = [...items];
    const [moved] = next.splice(idx, 1);
    if (moved) {
      next.unshift(moved);
      materializeOpenOrder(next);
    }
  }
}
