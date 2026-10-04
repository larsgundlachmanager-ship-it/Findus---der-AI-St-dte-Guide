/**
 * Timeline-Upsert-Fassade — plannedJourneyGroup + upsertFutureStopSafe.
 * SSOT: docs/rfc/agent-harden-contract.md
 */

import type { JourneyItinerary } from '../../services/transit/journeyPlanner';
import type { FuturePlanStop } from './futurePlanState';
import { upsertFutureStopSafe } from './planNowGuard';

export {
  upsertSpokenJourneyToTimeline,
  buildPlannedJourneyStops,
  plannedJourneyGroupExists,
  cleanPlanDestTitle,
} from './plannedJourneyGroup';

export { upsertFutureStopSafe } from './planNowGuard';

export type TimelineUpsertHint = 'plan_module' | 'timeline_upsert' | 'none';

export function scheduleWriteExecutionHint(userText: string): TimelineUpsertHint {
  try {
    const { looksLikeTravelScheduleWriteJob } = require('./travelScheduleHarden') as {
      looksLikeTravelScheduleWriteJob: (s: string) => boolean;
    };
    if (looksLikeTravelScheduleWriteJob(userText)) return 'plan_module';
  } catch {
    /* soft */
  }
  try {
    const { inferCall1JobShape } = require('../router/call1JobShape') as typeof import('../router/call1JobShape');
    if (inferCall1JobShape(userText) === 'schedule_write') {
      return 'plan_module';
    }
  } catch {
    /* soft */
  }
  return 'none';
}

export {
  detectTravelScheduleKind,
  looksLikeTravelScheduleWriteJob,
  runTravelScheduleHarden,
  upsertHotelStammToTimeline,
  upsertCruiseGlanceToTimeline,
  parseHotelStammFromText,
  parseCruisePortsFromText,
} from './travelScheduleHarden';

export function upsertPlanStopFacade(
  stop: FuturePlanStop,
  nowMs = Date.now(),
): boolean {
  return upsertFutureStopSafe(stop, nowMs);
}

export function upsertJourneyGroupFacade(opts: {
  destName: string;
  destLat?: number;
  destLng?: number;
  itinerary: JourneyItinerary;
}): boolean {
  try {
    const { upsertSpokenJourneyToTimeline } = require('./plannedJourneyGroup') as typeof import('./plannedJourneyGroup');
    return upsertSpokenJourneyToTimeline(opts);
  } catch {
    return false;
  }
}
