/**
 * Modul-1 / Geofence kurz pausieren, wenn der User eine Frage stellt.
 * Spiegelt den Runtime-Cooldown `after_user_question` (60 s).
 */

const DEFAULT_HOLD_MS = 60_000;

let holdUntilMs = 0;
let lastReason: string | null = null;

export function holdExploreForUserQuestion(
  ms = DEFAULT_HOLD_MS,
  reason = 'user_question',
): void {
  const until = Date.now() + Math.max(5_000, ms);
  if (until > holdUntilMs) holdUntilMs = until;
  lastReason = reason;
  try {
    const { bumpAfterUserQuestionCooldown } = require('./orchestrator') as {
      bumpAfterUserQuestionCooldown: () => void;
    };
    bumpAfterUserQuestionCooldown();
  } catch {
    /* soft */
  }
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[explore-hold]', reason, `ms=${ms}`);
  }
}

export function isExploreHeld(nowMs = Date.now()): boolean {
  if (nowMs < holdUntilMs) return true;
  try {
    const { canFireGpsTrigger, getRuntimeContext } = require('./orchestrator') as {
      canFireGpsTrigger: (ctx: unknown) => { ok: boolean; reason?: string };
      getRuntimeContext: () => unknown;
    };
    // canFireGpsTrigger ist in stateMachine — via orchestrator re-export oder direct
  } catch {
    /* soft */
  }
  try {
    const { canFireGpsTrigger } = require('./stateMachine') as {
      canFireGpsTrigger: (ctx: unknown) => { ok: boolean; reason?: string };
    };
    const { getRuntimeContext } = require('./orchestrator') as {
      getRuntimeContext: () => unknown;
    };
    const gate = canFireGpsTrigger(getRuntimeContext());
    if (!gate.ok && gate.reason === 'after_user_question') return true;
  } catch {
    /* soft */
  }
  return false;
}

export function getExploreHoldReason(): string | null {
  return isExploreHeld() ? lastReason : null;
}

export function clearExploreHold(reason = 'cleared'): void {
  holdUntilMs = 0;
  lastReason = null;
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[explore-hold] OFF', reason);
  }
}

export function exploreHoldDebug(): {
  held: boolean;
  remainingMs: number;
  reason: string | null;
} {
  const now = Date.now();
  return {
    held: now < holdUntilMs,
    remainingMs: Math.max(0, holdUntilMs - now),
    reason: lastReason,
  };
}
