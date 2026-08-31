/**
 * Modul 5 — Konflikte aus Modul-2-Wünschen gegen bestehende Timeline.
 */

import { useFuturePlanStore } from '../timeline/futurePlanState';
import { usePlanCalendarUiStore } from '../timeline/planCalendarUiStore';

function parseHm(text: string): { h: number; m: number } | null {
  const m = text.match(/\b(?:um\s+)?(\d{1,2})(?::(\d{2}))?\s*uhr\b/i);
  if (!m) {
    const m2 = text.match(/\b(\d{1,2}):(\d{2})\b/);
    if (!m2) return null;
    return { h: Number(m2[1]), m: Number(m2[2]) };
  }
  return { h: Number(m[1]), m: Number(m[2] ?? 0) };
}

/**
 * Wenn User eine neue Zeit will, die mit hartem Anker kollidiert → true + Speech-Hinweis.
 */
export function detectPlanTimeConflict(userText: string): {
  conflict: boolean;
  speech: string;
  conflictingTitle?: string;
} {
  const plan = useFuturePlanStore.getState().plan;
  if (!plan.stops.length) return { conflict: false, speech: '' };

  const wanted = parseHm(userText);
  if (!wanted) return { conflict: false, speech: '' };

  const day = plan.dayKey;
  const [y, mo, d] = day.split('-').map(Number);
  const wantMs = new Date(
    y!,
    mo! - 1,
    d!,
    wanted.h,
    wanted.m,
    0,
    0,
  ).getTime();

  const hard = plan.stops.filter(
    (s) =>
      s.kind !== 'nav_leg' &&
      s.plannedStartMs != null &&
      (s.hardAnchor ||
        s.userFixedTime ||
        (s.planPriority != null && s.planPriority <= 2)),
  );

  for (const s of hard) {
    const start = s.plannedStartMs!;
    const end = s.plannedEndMs ?? start + 90 * 60_000;
    // Kollision: Wunschzeit innerhalb ±60 Min um Anker oder überlappt
    if (Math.abs(wantMs - start) < 60 * 60_000 || (wantMs >= start && wantMs < end)) {
      const hm = new Date(start).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
      });
      return {
        conflict: true,
        conflictingTitle: s.title,
        speech: `Halt — um ${hm} steht „${s.title.replace(/^[^\wÄÖÜäöüß]+/u, '')}“ fest. Das knallt mit deinem neuen Wunsch. Optionen: früher legen, den Termin verschieben, oder anderen Slot.`,
      };
    }
  }
  return { conflict: false, speech: '' };
}

export function offerConflictShortAnswers(): void {
  usePlanCalendarUiStore.getState().setShortAnswers([
    {
      id: 'cf_earlier',
      label: 'Früher legen',
      action: 'prompt',
      prompt: 'Leg den neuen Wunsch früher, damit der Fix-Termin bleibt',
    },
    {
      id: 'cf_move_fix',
      label: 'Fix verschieben',
      action: 'prompt',
      prompt: 'Verschieb den festen Termin, neuer Wunsch hat Vorrang',
    },
    {
      id: 'cf_other',
      label: 'Anderer Slot',
      action: 'prompt',
      prompt: 'Such einen anderen Zeitslot ohne Konflikt',
    },
  ]);
}

/** Mic/Manager: Konflikt-Handoff sinnvoll wenn Plan existiert. */
export function shouldHandoffConflictToPlanning(userText: string): boolean {
  if (!useFuturePlanStore.getState().plan.stops.length) return false;
  // Explizite Nav / Just-Do-It nie als „Konflikt“ stehlen — auch bei offenem Kalender
  try {
    const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
      isExplicitNavIntent: (s: string) => boolean;
    };
    if (isExplicitNavIntent(userText)) return false;
  } catch {
    /* soft */
  }
  try {
    const { looksLikeSingleJustDoItRequest } = require('./planUtteranceGate') as {
      looksLikeSingleJustDoItRequest: (s: string) => boolean;
    };
    if (looksLikeSingleJustDoItRequest(userText)) return false;
  } catch {
    /* soft */
  }
  // Kalender offen allein ≠ Konflikt. Nur echte Zeitkollision (oder aktive M5-Session + Konflikt).
  return detectPlanTimeConflict(userText).conflict;
}
