/**
 * Call-2 shortAnswers → UI-Chips (Tap ohne Mic).
 */

import type { Module2ActionButton } from '../../types';

export function shortAnswersToModuleButtons(opts: {
  turnId: string;
  labels: string[];
  slotKey?: string;
}): Module2ActionButton[] {
  const slotKey = opts.slotKey || 'generic_fork';
  return opts.labels
    .map((raw) => raw.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((label, i) => ({
      id: `chip_${opts.turnId}_${i}`,
      label: label.slice(0, 28),
      payload: {
        kind: 'ui' as const,
        action: 'choice_tap',
        data: {
          parentTurnId: opts.turnId,
          choiceId: `chip_${i}`,
          slotKey,
          label,
        },
      },
    }));
}

const SLOT_KEYS = new Set([
  'baggage_type',
  'pitch_option',
  'plan_fork',
  'sup_own_vs_rent',
  'generic_fork',
]);

/** Call-2-Tail followUp.reason → stabiler Slot-Key für Chips. */
export function resolveShortAnswerSlotKey(
  tail: Record<string, unknown> | undefined,
  jobId?: string | null,
): string {
  const followUp =
    tail?.followUp && typeof tail.followUp === 'object'
      ? (tail.followUp as { reason?: string })
      : null;
  const reason = String(followUp?.reason || '').toLowerCase();
  if (SLOT_KEYS.has(reason)) return reason;
  if (/gepäck|luggage|baggage/.test(reason)) return 'baggage_type';
  if (/pitch|option/.test(reason)) return 'pitch_option';
  if (/plan.*fork|fork/.test(reason)) return 'plan_fork';
  if (/sup|verleih|activity/.test(reason)) return 'sup_own_vs_rent';
  if (jobId === 'flight_trip') return 'baggage_type';
  return 'generic_fork';
}
