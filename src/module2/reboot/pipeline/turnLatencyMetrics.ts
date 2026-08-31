/**
 * RFC Latenz-Metriken — P50-Ziele aus regression-gate.md
 */

import {
  latencyMark,
  latencyStartTurn,
  latencyFlushSummary,
} from '../../../services/debug/latencyTiming';

let call3Turns = 0;
let totalTurns = 0;

export function trackTurnComplete(): void {
  totalTurns += 1;
}

export function trackCall3Rate(): void {
  call3Turns += 1;
}

export function getCall3Rate(): number {
  if (totalTurns <= 0) return 0;
  return call3Turns / totalTurns;
}

export function markBridgeFirst(): void {
  try {
    latencyMark('ack', 'bridge_stream');
  } catch {
    /* soft */
  }
}

export function markBridgeEnd(): void {
  try {
    latencyMark('context', 'bridge_end');
  } catch {
    /* soft */
  }
}

export function markCall2FirstSentence(): void {
  try {
    latencyMark('tts', 'call2_first');
  } catch {
    /* soft */
  }
}

export function markTapChoiceAck(): void {
  const t0 = Date.now();
  try {
    latencyStartTurn('tap_choice');
    latencyMark('ack', 'tap_ack');
  } catch {
    /* soft */
  }
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(`[latency] tap_choice_ack_ms ~${Date.now() - t0}`);
  }
}

export function flushTurnLatency(): void {
  trackTurnComplete();
  try {
    latencyFlushSummary();
  } catch {
    /* soft */
  }
  if (typeof __DEV__ !== 'undefined' && __DEV__ && totalTurns % 5 === 0) {
    console.log(
      `[latency] call3_rate=${(getCall3Rate() * 100).toFixed(1)}% (${call3Turns}/${totalTurns})`,
    );
  }
}
