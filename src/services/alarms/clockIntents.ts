/**
 * Wecker + Timer Intents — gemeinsamer Einstieg für Voice & Concierge.
 */

import type { QuickAction } from '../../types/concierge';
import {
  isWakeAlarmIntent,
  prepareWakeAlarmFollowUp,
} from './wakeAlarmAdvisor';
import {
  isTimerIntent,
  prepareTimerFollowUp,
} from './timerService';

export type ClockIntentResult = {
  kind: 'wake' | 'timer';
  speech: string;
  bullets: string[];
  quickActions: QuickAction[];
  cardTitle: string;
};

export function isClockIntent(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  return isTimerIntent(t) || isWakeAlarmIntent(t);
}

/**
 * Just-Do-It: Timer/Wecker mit klarer Zeit → sofort stellen.
 */
export async function prepareClockIntentFollowUp(
  text: string,
): Promise<ClockIntentResult | null> {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;

  // Timer vor Wecker (sonst fängt „erinner mich in 10 min“ den Wecker-Pfad)
  if (isTimerIntent(t)) {
    const timer = await prepareTimerFollowUp(t);
    if (!timer) return null;
    return {
      kind: 'timer',
      speech: timer.speech,
      bullets: timer.bullets,
      quickActions: timer.quickActions,
      cardTitle: 'Timer',
    };
  }

  if (isWakeAlarmIntent(t)) {
    const wake = await prepareWakeAlarmFollowUp(t);
    if (!wake) return null;
    return {
      kind: 'wake',
      speech: wake.speech,
      bullets: wake.bullets ?? [],
      quickActions: wake.quickActions ?? [],
      cardTitle: 'Wecker',
    };
  }

  return null;
}
