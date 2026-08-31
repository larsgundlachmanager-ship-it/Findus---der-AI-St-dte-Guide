/**
 * Modul 5 — Live-Chat-Idle für Planung.
 * Mic startet erst bei Rückfrage (`onPlanDirectAsk`), nicht während Recherche.
 */

import {
  stopLiveChatSession,
  setLiveChatIdleOverrideMs,
  clearLiveChatIdleOverride,
} from '../../services/handsFree/liveChatSession';

const PLANNING_IDLE_MS = 60_000;
let planningLiveOwned = false;

/** Idle 60s merken — kein sofortiges Zuhören. */
export async function ensurePlanningLiveChat(): Promise<void> {
  setLiveChatIdleOverrideMs(PLANNING_IDLE_MS);
  planningLiveOwned = true;
}

/** Override lösen; Session nur stoppen wenn wir sie für Planung gestartet haben. */
export async function releasePlanningLiveChat(
  stopSession = false,
): Promise<void> {
  clearLiveChatIdleOverride();
  if (stopSession && planningLiveOwned) {
    try {
      await stopLiveChatSession('module5_end');
    } catch {
      /* soft */
    }
  }
  planningLiveOwned = false;
}

export function isPlanningLiveChatOwned(): boolean {
  return planningLiveOwned;
}
