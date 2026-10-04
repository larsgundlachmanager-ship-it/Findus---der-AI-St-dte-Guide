/**
 * Phase 5 — Mission-Familie → Execution-Backend.
 * Call-1 Toolbox bleibt; hier nur Soft-Routing wenn execution fehlt.
 */

import type { MissionFamily } from './missionContract';
import type { Call1ExecutionBackend } from '../router/call1Dispatch';
import { isAmenityPlaceFindQuery } from './amenityPlaceFind';
import { buildMissionChecklist } from './buildMissionChecklist';

export function missionFamilyToExecution(
  family: MissionFamily,
): Call1ExecutionBackend | null {
  switch (family) {
    case 'place':
    case 'amenity':
    case 'hotel':
      return 'pitch_module';
    case 'activity':
    case 'rental':
      // SUP/Spikeball → Fanout/knowledge (nicht Pitch, nie inventing chat)
      return 'task_fanout';
    case 'schedule':
    case 'event':
      return 'events_research';
    case 'transit':
      return 'nav_execute';
    case 'flight':
      return 'flight_advisor';
    case 'fact':
      return 'chat_lane';
    default:
      return null;
  }
}

/**
 * Soft-Execution aus User-Text + Mission (kein Explicit überschreiben).
 */
export function resolveMissionExecutionSoft(userText: string): {
  execution: Call1ExecutionBackend | null;
  family: MissionFamily;
} {
  const t = String(userText || '').trim();
  if (isAmenityPlaceFindQuery(t)) {
    return { execution: 'pitch_module', family: 'amenity' };
  }
  const mission = buildMissionChecklist({ userText: t });
  if (mission.askBack) {
    // Blocker → Chat/Bridge fragt; keine falsche Execution erzwingen
    return { execution: null, family: mission.family };
  }
  return {
    execution: missionFamilyToExecution(mission.family),
    family: mission.family,
  };
}
