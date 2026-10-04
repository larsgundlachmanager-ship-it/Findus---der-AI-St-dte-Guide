/**
 * Pro-Turn Pace-Telemetrie — Bridge ↔ Call-2 Gap → Collective.
 * Soft: nie Speech/TTS blockieren.
 */

import type { PaceBrick, PaceBucket } from './bridgePace';
import { inferPaceBrick } from './bridgePace';
import { BRIDGE_TO_CALL2_GAP_MAX_MS } from './bridgePace';

export type PaceTurnState = {
  turnId: string;
  turnStartedAtMs: number;
  bucket: PaceBucket;
  brick: PaceBrick;
  bridgeBudgetSec: number;
  bridgeStartedAtMs: number | null;
  /** Geschätztes oder gemessenes Bridge-Ende */
  bridgeEndedAtMs: number | null;
  call2ReadyAtMs: number | null;
  usedCall3: boolean;
  forcedByGapCap: boolean;
};

let active: PaceTurnState | null = null;

export function beginPaceTurn(opts: {
  turnId: string;
  userText: string;
  execution?: string | null;
  lane?: string | null;
  jobHint?: string | null;
  bridgeBudgetSec?: number | null;
}): PaceTurnState {
  const { bucket, brick } = inferPaceBrick({
    userText: opts.userText,
    execution: opts.execution,
    lane: opts.lane,
    jobHint: opts.jobHint,
  });
  const budget =
    typeof opts.bridgeBudgetSec === 'number' && opts.bridgeBudgetSec > 0
      ? Math.round(opts.bridgeBudgetSec)
      : 8;
  active = {
    turnId: opts.turnId,
    turnStartedAtMs: Date.now(),
    bucket,
    brick,
    bridgeBudgetSec: budget,
    bridgeStartedAtMs: null,
    bridgeEndedAtMs: null,
    call2ReadyAtMs: null,
    usedCall3: false,
    forcedByGapCap: false,
  };
  return active;
}

export function getPaceTurn(): PaceTurnState | null {
  return active;
}

/**
 * Bridge-TTS gestartet. speechDurationMs = geschätzte Sprechdauer (Wörter),
 * nicht Research-Budget — sonst Luftloch bis Call 2 (Budget oft 8–14 s).
 */
export function notePaceBridgeStarted(
  atMs: number = Date.now(),
  speechDurationMs?: number,
): void {
  if (!active) return;
  if (active.bridgeStartedAtMs == null) active.bridgeStartedAtMs = atMs;
  const fromWords =
    typeof speechDurationMs === 'number' && Number.isFinite(speechDurationMs)
      ? Math.max(1200, Math.min(6500, Math.round(speechDurationMs)))
      : null;
  // Research-Budget nur als grobe Obergrenze, stark gekappt (Sprechzeit ≠ Recherche).
  const fromBudget = Math.max(
    1500,
    Math.min(4500, active.bridgeBudgetSec * 1000),
  );
  const est = fromWords ?? fromBudget;
  // Wort-Schätzung gewinnt immer (auch wenn Budget schon gesetzt).
  if (active.bridgeEndedAtMs == null || fromWords != null) {
    active.bridgeEndedAtMs = atMs + est;
  }
}

/** Echtes oder korrigiertes Bridge-Ende (TTS fertig / Freigabe). */
export function notePaceBridgeEnded(atMs: number = Date.now()): void {
  if (!active) return;
  active.bridgeEndedAtMs = atMs;
  try {
    const { markBridgeEnd } = require('./turnLatencyMetrics') as {
      markBridgeEnd: () => void;
    };
    markBridgeEnd();
  } catch {
    /* soft */
  }
}

export function notePaceCall2Ready(atMs: number = Date.now()): void {
  if (!active) return;
  if (active.call2ReadyAtMs == null) active.call2ReadyAtMs = atMs;
}

export function notePaceUsedCall3(): void {
  if (!active) return;
  active.usedCall3 = true;
}

export function notePaceForcedByGapCap(): void {
  if (!active) return;
  active.forcedByGapCap = true;
}

/** Ms bis Call-2 Speech spätestens starten muss (null = unbekannt). */
export function msUntilCall2GapCap(nowMs: number = Date.now()): number | null {
  if (!active?.bridgeEndedAtMs) return null;
  return Math.max(0, active.bridgeEndedAtMs + BRIDGE_TO_CALL2_GAP_MAX_MS - nowMs);
}

export function shouldForceCall2FromPace(
  nowMs: number = Date.now(),
): boolean {
  if (!active?.bridgeEndedAtMs) return false;
  return nowMs >= active.bridgeEndedAtMs + BRIDGE_TO_CALL2_GAP_MAX_MS;
}

/** Flush → Collective + Reset. */
export async function flushPaceTurnSample(): Promise<void> {
  const s = active;
  active = null;
  if (!s) return;
  const bridgeMs =
    s.bridgeStartedAtMs != null && s.bridgeEndedAtMs != null
      ? Math.max(0, s.bridgeEndedAtMs - s.bridgeStartedAtMs)
      : s.bridgeBudgetSec * 1000;
  const call2ReadyMs =
    s.call2ReadyAtMs != null
      ? Math.max(0, s.call2ReadyAtMs - s.turnStartedAtMs)
      : 0;
  const gapAfterBridgeMs =
    s.bridgeEndedAtMs != null && s.call2ReadyAtMs != null
      ? Math.max(0, s.call2ReadyAtMs - s.bridgeEndedAtMs)
      : -1;
  try {
    const { contributePaceBridgeSample } = require('../../../services/memory/paceBridgeLearning') as {
      contributePaceBridgeSample: (o: {
        bucket: PaceBucket;
        brick: PaceBrick;
        bridgeMs: number;
        call2ReadyMs: number;
        gapAfterBridgeMs: number;
        usedCall3: boolean;
      }) => Promise<void>;
    };
    await contributePaceBridgeSample({
      bucket: s.bucket,
      brick: s.brick,
      bridgeMs,
      call2ReadyMs,
      gapAfterBridgeMs: gapAfterBridgeMs < 0 ? 0 : gapAfterBridgeMs,
      usedCall3: s.usedCall3,
    });
  } catch {
    /* soft */
  }
}
