/**
 * Live-Fail → genau eine Stelle. Call-1 bleibt eingefroren.
 */

import { CALL1_FROZEN_CONTRACT, CALL1_FROZEN_SHA256 } from './call1Frozen';

export type TriageSink = 'gold' | 'slot' | 'job' | 'card' | 'kernel';

export function sinkForFail(
  kind:
    | 'structure'
    | 'missing_slot'
    | 'wrong_job'
    | 'button'
    | 'crash'
    | 'call1_growth',
): TriageSink {
  switch (kind) {
    case 'structure':
      return 'gold';
    case 'missing_slot':
      return 'slot';
    case 'wrong_job':
      return 'job';
    case 'button':
      return 'card';
    case 'crash':
      return 'kernel';
    case 'call1_growth':
      return 'gold';
    default:
      return 'gold';
  }
}

export function frozenCall1Sha256(): string {
  return CALL1_FROZEN_SHA256;
}

export function frozenCall1Contract(): string {
  return CALL1_FROZEN_CONTRACT;
}
