/**
 * Runtime state helpers — module transitions & cooldown bookkeeping.
 */

import type { CooldownKey, RuntimeContext, RuntimeModule } from './types';
import { RUNTIME_COOLDOWNS_MS } from './types';

export function createInitialRuntimeContext(
  partial?: Partial<RuntimeContext>,
): RuntimeContext {
  return {
    module: 'idle',
    isSpeaking: false,
    isListening: false,
    isGenerating: false,
    navActive: false,
    cooldownUntil: {},
    queuedGpsTriggerId: null,
    online: true,
    ...partial,
  };
}

export function isCooldownActive(
  ctx: RuntimeContext,
  key: CooldownKey,
  nowMs = Date.now(),
): boolean {
  const until = ctx.cooldownUntil[key];
  return until != null && nowMs < until;
}

export function setCooldown(
  ctx: RuntimeContext,
  key: CooldownKey,
  nowMs = Date.now(),
): RuntimeContext {
  return {
    ...ctx,
    cooldownUntil: {
      ...ctx.cooldownUntil,
      [key]: nowMs + RUNTIME_COOLDOWNS_MS[key],
    },
  };
}

function cooldownRemainingMs(
  ctx: RuntimeContext,
  key: CooldownKey,
  nowMs: number,
): number {
  const until = ctx.cooldownUntil[key];
  if (until == null) return 0;
  return Math.max(0, until - nowMs);
}

export function canFireGpsTrigger(
  ctx: RuntimeContext,
  nowMs = Date.now(),
): { ok: boolean; reason?: string; remainingMs?: number } {
  if (ctx.isListening) {
    return { ok: false, reason: 'listening' };
  }
  if (ctx.isGenerating) {
    return { ok: false, reason: 'generating' };
  }
  // 60 s nach User-Frage — Modul 1 wartet (Policy)
  if (isCooldownActive(ctx, 'after_user_question', nowMs)) {
    return {
      ok: false,
      reason: 'after_user_question',
      remainingMs: cooldownRemainingMs(ctx, 'after_user_question', nowMs),
    };
  }
  if (ctx.navActive && isCooldownActive(ctx, 'during_navigation', nowMs)) {
    return {
      ok: false,
      reason: 'during_navigation',
      remainingMs: cooldownRemainingMs(ctx, 'during_navigation', nowMs),
    };
  }
  if (isCooldownActive(ctx, 'after_poi_complete', nowMs)) {
    return {
      ok: false,
      reason: 'after_poi_complete',
      remainingMs: cooldownRemainingMs(ctx, 'after_poi_complete', nowMs),
    };
  }
  // after_speech + canModule1Speak bewusst nicht: sonst blockt Wegweiser-TTS
  // die Ankunft (5 s Policy) und stehendes GPS bekommt keinen Recheck.
  return { ok: true };
}

export function transitionModule(
  ctx: RuntimeContext,
  module: RuntimeModule,
): RuntimeContext {
  return { ...ctx, module };
}
