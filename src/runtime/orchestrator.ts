/**
 * Yorro Runtime Orchestrator (Phase 1).
 * SSOT: active module, GPS queue vs user interrupt, cooldowns.
 */

import { interruptAudioPipeline } from './audioPipeline';
import { noteMobilityUserActivity } from './mobilityModule';
import {
  canFireGpsTrigger,
  createInitialRuntimeContext,
  setCooldown,
  transitionModule,
} from './stateMachine';
import { noteModule2SpeechEnded } from '../services/navigation/modulePriorityPolicy';
import type {
  OrchestratorDecision,
  RuntimeContext,
  RuntimeModule,
  RuntimeTriggerKind,
} from './types';

export type OrchestratorSnapshot = RuntimeContext;

let ctx: RuntimeContext = createInitialRuntimeContext();

export function getRuntimeContext(): Readonly<RuntimeContext> {
  return ctx;
}

/** Nur Cooldown refreshen (ohne erneutes TTS-Interrupt) — z. B. Concierge-Turn. */
export function bumpAfterUserQuestionCooldown(): void {
  ctx = setCooldown(ctx, 'after_user_question');
}

export function resetRuntimeContext(
  partial?: Partial<RuntimeContext>,
): void {
  ctx = createInitialRuntimeContext(partial);
}

export function syncRuntimeFromStore(state: {
  isPlayingAudio?: boolean;
  isListening?: boolean;
  isGenerating?: boolean;
  navActive?: boolean;
}): void {
  ctx = {
    ...ctx,
    isSpeaking: state.isPlayingAudio ?? ctx.isSpeaking,
    isListening: state.isListening ?? ctx.isListening,
    isGenerating: state.isGenerating ?? ctx.isGenerating,
    navActive: state.navActive ?? ctx.navActive,
  };
}

export function setRuntimeOnline(online: boolean): void {
  ctx = { ...ctx, online };
}

export function setRuntimeModule(module: RuntimeModule): void {
  ctx = transitionModule(ctx, module);
}

/**
 * User started voice/text input (Modul 2) — INTERRUPT TTS immediately.
 * Modul 1 Narration abbrechen; Modul 3 stellt sich hinten an (deferred queue).
 */
export async function onUserInputStart(
  kind: 'user_voice' | 'user_text',
): Promise<OrchestratorDecision> {
  noteMobilityUserActivity();
  try {
    const { useFinnusStore } = await import('../store/useFinnusStore');
    // Stichpunkte behalten — nur Rad wird rot; Karte wechselt bei neuer Antwort
    useFinnusStore.getState().setIsGenerating(true);
  } catch {
    /* ignore */
  }
  // Modul 1 hart abbrechen
  try {
    const { interruptNarrationForForce } = await import('./narrationPipeline');
    await interruptNarrationForForce();
  } catch {
    /* ignore */
  }
  await interruptAudioPipeline();
  ctx = transitionModule(ctx, 'questions');
  ctx = setCooldown(ctx, 'after_user_question');
  ctx = {
    ...ctx,
    isListening: kind === 'user_voice',
    isSpeaking: false,
    isGenerating: true,
    queuedGpsTriggerId: null,
  };
  return { action: 'interrupt_for_user' };
}

/**
 * User question handled — keep 60s GPS cooldown (already set).
 */
export function onUserInputEnd(): void {
  ctx = {
    ...ctx,
    isListening: false,
    isGenerating: false,
  };
  // Nach Frage: Modul freigeben — 60s-Cooldown bleibt aktiv
  if (ctx.module === 'questions') {
    ctx = transitionModule(ctx, ctx.navActive ? 'navigation' : 'explore');
  }
  noteModule2SpeechEnded();
}

/**
 * GPS POI trigger candidate — QUEUE if speaking (nur 1 Slot, neuestes gewinnt), else run.
 */
export function onGpsPoiCandidate(poiId: number): OrchestratorDecision {
  if (!ctx.navActive && ctx.module !== 'questions') {
    ctx = transitionModule(ctx, 'explore');
  }

  if (ctx.isSpeaking || ctx.isListening || ctx.isGenerating) {
    // Einziger Queue-Slot — überschreiben = spätere/nähere Story, kein Stau
    ctx = { ...ctx, queuedGpsTriggerId: poiId };
    return { action: 'queue_gps_trigger', poiId };
  }

  const gate = canFireGpsTrigger(ctx);
  if (!gate.ok) {
    return {
      action: 'skip_gps_trigger',
      reason: gate.reason ?? 'blocked',
      remainingMs: gate.remainingMs,
    };
  }

  return { action: 'run_gps_trigger', poiId };
}

/**
 * TTS finished — flush queued GPS trigger if any; start after_speech cooldown.
 */
export function onSpeechEnded(): OrchestratorDecision | null {
  ctx = setCooldown(ctx, 'after_speech');
  ctx = { ...ctx, isSpeaking: false };

  const queued = ctx.queuedGpsTriggerId;
  if (queued == null) return null;

  ctx = { ...ctx, queuedGpsTriggerId: null };
  const gate = canFireGpsTrigger(ctx);
  if (!gate.ok) {
    ctx = { ...ctx, queuedGpsTriggerId: queued };
    return { action: 'queue_gps_trigger', poiId: queued };
  }
  return { action: 'run_gps_trigger', poiId: queued };
}

export function onPoiNarrationComplete(): void {
  ctx = setCooldown(ctx, 'after_poi_complete');
}

export function onNavigationStart(): void {
  ctx = transitionModule(ctx, 'navigation');
  ctx = setCooldown(ctx, 'during_navigation');
}

export function onNavigationEnd(): void {
  if (ctx.module === 'navigation') {
    ctx = transitionModule(ctx, 'idle');
  }
}

export function onSpeechStart(): void {
  ctx = { ...ctx, isSpeaking: true };
}

export function interruptionPolicyFor(
  trigger: RuntimeTriggerKind,
): 'queue' | 'interrupt' {
  if (trigger === 'user_voice' || trigger === 'user_text') return 'interrupt';
  return 'queue';
}
