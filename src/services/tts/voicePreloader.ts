/**
 * VoicePreloader — Cartesia braucht kein lokales Modell-Warmup.
 * Behält die API-Oberfläche für Onboarding/Settings.
 */
import type { VoiceId } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';
import {
  registerActiveVoiceWarmer,
  markTtsWarmedUp,
} from '../AudioVoiceService';
import { useFinnusStore } from '../../store/useFinnusStore';
import { hasCartesiaTtsKey } from '../cartesiaTtsService';

export type WarmVoiceResult = {
  activePersona: VoiceId;
  activePack: string;
  activeModel: string;
  engine: 'cartesia';
};

class VoicePreloaderService {
  private activePersona: VoiceId | null = null;
  private chain: Promise<void> = Promise.resolve();

  getActivePersona(): VoiceId | null {
    return this.activePersona;
  }

  getActivePack(): string | null {
    return this.activePersona;
  }

  getActiveModel(): string | null {
    return this.activePersona;
  }

  isZeroLatencyReady(_voiceId?: VoiceId): boolean {
    return hasCartesiaTtsKey() || true;
  }

  warmActiveVoice(voiceId?: VoiceId): Promise<WarmVoiceResult> {
    return this.enqueue(async () => this.doWarm(voiceId));
  }

  switchActiveVoice(voiceId: VoiceId): Promise<WarmVoiceResult> {
    return this.enqueue(async () => this.doWarm(voiceId, { forceSwitch: true }));
  }

  resetTracking(): void {
    this.activePersona = null;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async doWarm(
    voiceId?: VoiceId,
    _opts?: { forceSwitch?: boolean },
  ): Promise<WarmVoiceResult> {
    const persona =
      voiceId ??
      this.activePersona ??
      getCachedUserProfile()?.voiceId ??
      'alina';
    this.activePersona = persona;
    useFinnusStore.getState().setTtsReady(true);
    useFinnusStore.getState().setTtsStatusMessage(null);
    markTtsWarmedUp();
    return {
      activePersona: persona,
      activePack: 'cartesia',
      activeModel: 'sonic-3.5',
      engine: 'cartesia',
    };
  }
}

export const voicePreloader = new VoicePreloaderService();

registerActiveVoiceWarmer(
  (id) => voicePreloader.warmActiveVoice(id).then(() => undefined),
  () => voicePreloader.resetTracking(),
);
