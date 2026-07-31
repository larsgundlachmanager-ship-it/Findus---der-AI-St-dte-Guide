/**
 * Modul 5 darf 15s nach Modul-2-Speech sprechen (Follow-up: Reservierung, Wecker…).
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import {
  getModule2SpeechEndedAtMs,
  isModule2Busy,
} from '../navigation/modulePriorityPolicy';
import type { QuickAction } from '../../types/concierge';
import { wrapPlainAsConcierge } from '../concierge/parseConciergeResponse';
import { toConciergeCardState } from '../concierge/presentConcierge';
import { getVoiceSettingsForTour, speakAssistantText } from '../ttsService';

export const MODULE5_AFTER_M2_MS = 15_000;

let followUpTimer: ReturnType<typeof setTimeout> | null = null;
let pendingFollowUp: {
  speech: string;
  actions?: QuickAction[];
} | null = null;

export function canModule5Speak(nowMs = Date.now()): {
  ok: boolean;
  reason?: string;
} {
  if (isModule2Busy()) return { ok: false, reason: 'module2_busy' };
  const store = useFinnusStore.getState();
  if (store.isPlayingAudio) return { ok: false, reason: 'speaking' };
  const ended = getModule2SpeechEndedAtMs();
  if (ended != null) {
    const elapsed = nowMs - ended;
    if (elapsed < MODULE5_AFTER_M2_MS) {
      return { ok: false, reason: 'cooldown_15s_after_m2' };
    }
  }
  return { ok: true };
}

/**
 * Plant Follow-up über ProactiveSpeechQueue (Budget + Bündelung).
 */
export function scheduleModule5FollowUp(opts: {
  speech: string;
  actions?: QuickAction[];
}): void {
  void import('./proactiveSpeechQueue').then(({ enqueueProactiveSpeech }) => {
    enqueueProactiveSpeech({
      kind: 'plan',
      speech: opts.speech,
      actions: opts.actions,
      id: `m5:${opts.speech.slice(0, 40)}`,
    });
  });
}

/** @deprecated legacy direct path — kept for speakPlanChangeExplanation gate */
export function scheduleModule5FollowUpLegacy(opts: {
  speech: string;
  actions?: QuickAction[];
}): void {
  pendingFollowUp = opts;
  if (followUpTimer) clearTimeout(followUpTimer);

  const tryFire = () => {
    const gate = canModule5Speak();
    if (!gate.ok) {
      followUpTimer = setTimeout(tryFire, 2_000);
      return;
    }
    const job = pendingFollowUp;
    pendingFollowUp = null;
    followUpTimer = null;
    if (!job) return;
    void (async () => {
      try {
        const voice = await getVoiceSettingsForTour();
        useFinnusStore.getState().addChatMessage({
          role: 'assistant',
          content: job.speech,
        });
        if (job.actions?.length) {
          useFinnusStore.getState().setActiveConciergeCard(
            toConciergeCardState(
              wrapPlainAsConcierge(job.speech, {
                cardTitle: 'Planung',
                visualBullets: ['Tagesplan aktualisiert'],
                quickActions: job.actions,
              }),
            ),
          );
        }
        await speakAssistantText(job.speech, {
          voiceId: voice.voiceId,
          speechRate: voice.speechRate,
        });
      } catch (err) {
        if (__DEV__) console.warn('[module5] follow-up failed', err);
      }
    })();
  };

  const ended = getModule2SpeechEndedAtMs();
  const wait =
    ended == null
      ? MODULE5_AFTER_M2_MS
      : Math.max(500, MODULE5_AFTER_M2_MS - (Date.now() - ended));
  followUpTimer = setTimeout(tryFire, wait);
}
