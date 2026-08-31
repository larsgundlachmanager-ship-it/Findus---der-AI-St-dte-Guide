/**
 * Tap ohne Mic — Ack + Fanout + Call 2 (RFC continue-turn-from-choice).
 * Kein Call 1 — Parent-Kontext aus choiceTurnContext.
 */

import type { PipelineTurnResult } from '../types';
import { runConciergeTurn } from './runConciergeTurn';
import { enqueueSpeech } from '../speech/speechQueue';
import {
  armChoiceFastPath,
  applyChoiceInventoryPatch,
} from './choiceTurnContext';

export type ContinueTurnFromChoiceInput = {
  parentTurnId: string;
  choiceId: string;
  label: string;
  slotKey: string;
  threadId?: string;
  inventoryPatch?: Record<string, string | number | boolean | null>;
  signal?: AbortSignal;
};

function ackForSlot(slotKey: string, label: string): string {
  switch (slotKey) {
    case 'baggage_type':
      return `Alles klar — ${label}.`;
    case 'pitch_option':
      return `Gute Wahl — ${label}.`;
    case 'plan_fork':
      return `Okay — dann ${label}.`;
    case 'sup_own_vs_rent':
      return `Verstanden — ${label}.`;
    default:
      return `Okay — ${label}.`;
  }
}

function authorIntentForSlot(slotKey: string, label: string): string {
  switch (slotKey) {
    case 'baggage_type':
      return `Gepäckwahl: ${label}`;
    case 'pitch_option':
      return `Pitch-Option gewählt: ${label}`;
    case 'plan_fork':
      return `Plan-Fork gewählt: ${label}`;
    case 'sup_own_vs_rent':
      return `SUP-Entscheidung: ${label}`;
    default:
      return `User wählte per Tap: ${label} (${slotKey})`;
  }
}

export async function continueTurnFromChoice(
  input: ContinueTurnFromChoiceInput,
): Promise<PipelineTurnResult> {
  const turnId = `${input.parentTurnId}_tap_${input.choiceId}`.slice(0, 64);
  const ack = ackForSlot(input.slotKey, input.label);

  try {
    const { markTapChoiceAck } = await import(
      '../reboot/pipeline/turnLatencyMetrics'
    );
    markTapChoiceAck();
  } catch {
    /* soft */
  }

  try {
    const { noteFindusSpokenForEcho } = require('../../services/handsFree/echoGuard') as {
      noteFindusSpokenForEcho: (t: string) => void;
    };
    noteFindusSpokenForEcho(ack);
  } catch {
    /* soft */
  }
  enqueueSpeech({ kind: 'main', text: ack, turnId });

  applyChoiceInventoryPatch(input.inventoryPatch);

  armChoiceFastPath({
    parentTurnId: input.parentTurnId,
    choiceId: input.choiceId,
    label: input.label,
    slotKey: input.slotKey,
    inventoryPatch: input.inventoryPatch,
  });

  const authorIntent = authorIntentForSlot(input.slotKey, input.label);
  return runConciergeTurn({
    userText: authorIntent,
    turnId,
    signal: input.signal,
  });
}
