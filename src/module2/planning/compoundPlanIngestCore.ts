/**
 * Compound-Tagesplan — reine Slot→Plan-Logik (Node-smoke-sicher, kein RN).
 */

import { orchestrateUtterance } from '../reboot/pipeline/orchestrateSlots';
import { call1OwnsCompoundTurn } from '../reboot/pipeline/dispatchJobs';
import { buildSkeletonPlanFromUtterance } from './planUtteranceSlots';
import { applyTurnFrameToPlan } from './applyTurnFrame';
import { derivePlanTasks } from './derivePlanTasks';
import { tryResolveDateKeyFromUserText, todayDateKey } from '../../utils/dateKeys';
import type { TurnFrame } from '../router/turnFrame';
import type { IngestedPlan } from './planningTypes';

export function shouldIngestCompoundPlan(userText: string): boolean {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const orch = orchestrateUtterance(t);
  if (!orch.weaveDayPlan) return false;
  return call1OwnsCompoundTurn(t);
}

export function buildCompoundPlanFromUtterance(opts: {
  userText: string;
  frame?: TurnFrame | null;
  dayKeyHint?: string | null;
  gpsCity?: string | null;
  lat?: number;
  lng?: number;
}): IngestedPlan | null {
  if (!shouldIngestCompoundPlan(opts.userText)) return null;

  const dayKey =
    opts.dayKeyHint ||
    tryResolveDateKeyFromUserText(opts.userText) ||
    todayDateKey();

  const gpsCity = opts.gpsCity ?? null;
  const lat = opts.lat ?? 0;
  const lng = opts.lng ?? 0;

  const skeleton = buildSkeletonPlanFromUtterance({
    utterance: opts.userText,
    dayKey,
    gpsCity,
    destCity: opts.frame?.destCity ?? null,
    geoAnchor: {
      name: gpsCity ? `Start (${gpsCity})` : 'Start',
      type: 'CURRENT_GPS',
      needsClarification: false,
      lat,
      lng,
    },
  });

  if (skeleton.openWishesQueue.length === 0) return null;

  let plan = applyTurnFrameToPlan(
    skeleton,
    opts.frame ?? null,
    opts.userText,
    gpsCity,
  );
  plan = { ...plan, tasks: derivePlanTasks(plan) };
  return plan;
}
