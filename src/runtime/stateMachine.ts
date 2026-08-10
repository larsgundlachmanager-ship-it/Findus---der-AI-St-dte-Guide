/**
 * Runtime state helpers — module transitions & cooldown bookkeeping.
 */

import type { CooldownKey, RuntimeContext, RuntimeModule } from './types';
import { RUNTIME_COOLDOWNS_MS } from './types';
import { canModule1Speak } from '../services/navigation/modulePriorityPolicy';

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

export function canFireGpsTrigger(
  ctx: RuntimeContext,
  nowMs = Date.now(),
): { ok: boolean; reason?: string } {
  if (ctx.isListening) {
    return { ok: false, reason: 'listening' };
  }
  if (ctx.isGenerating) {
    return { ok: false, reason: 'generating' };
  }
  // 35 s nach User-Frage — Modul 1 wartet (Policy)
  if (isCooldownActive(ctx, 'after_user_question', nowMs)) {
    return { ok: false, reason: 'after_user_question' };
  }
  if (ctx.navActive && isCooldownActive(ctx, 'during_navigation', nowMs)) {
    return { ok: false, reason: 'during_navigation' };
  }
  if (isCooldownActive(ctx, 'after_poi_complete', nowMs)) {
    return { ok: false, reason: 'after_poi_complete' };
  }
  if (isCooldownActive(ctx, 'after_speech', nowMs)) {
    return { ok: false, reason: 'after_speech' };
  }
  const gate = canModule1Speak(nowMs);
  if (!gate.ok) return { ok: false, reason: gate.reason };
  return { ok: true };
}

export function transitionModule(
  ctx: RuntimeContext,
  module: RuntimeModule,
): RuntimeContext {
  return { ...ctx, module };
}
