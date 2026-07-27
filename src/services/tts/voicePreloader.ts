/**
 * VoicePreloader — hält die aktive Engine keep-warm (Piper ODER Kokoro).
 */
import {
  resolvePiperModelId,
  type PiperVoiceModelId,
} from '../../constants/piperVoices';
import {
  isKokoroVoice,
  resolveKokoroPackId,
  type KokoroVoicePackId,
} from '../../constants/kokoroVoicePacks';
import type { VoiceId } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';
import {
  ensurePiperModel,
  isPiperReady,
  registerActiveVoiceWarmer,
  markPiperWarmedUp,
  unloadInactivePiperModels,
} from '../AudioVoiceService';
import {
  ensureKokoroPack,
  isKokoroEngineReady,
  unloadKokoroEngine,
} from '../kokoro/kokoroEngine';

export type WarmVoiceResult = {
  activePersona: VoiceId;
  activePack: PiperVoiceModelId | KokoroVoicePackId;
  activeModel: PiperVoiceModelId | KokoroVoicePackId;
  engine: 'piper' | 'kokoro';
};

class VoicePreloaderService {
  private activePersona: VoiceId | null = null;
  private activeModel: PiperVoiceModelId | KokoroVoicePackId | null = null;
  private activeEngine: 'piper' | 'kokoro' | null = null;
  private chain: Promise<void> = Promise.resolve();

  getActivePersona(): VoiceId | null {
    return this.activePersona;
  }

  getActivePack(): PiperVoiceModelId | KokoroVoicePackId | null {
    return this.activeModel;
  }

  getActiveModel(): PiperVoiceModelId | KokoroVoicePackId | null {
    return this.activeModel;
  }

  isZeroLatencyReady(voiceId?: VoiceId): boolean {
    const persona =
      voiceId ?? this.activePersona ?? getCachedUserProfile()?.voiceId ?? null;
    if (!persona) return false;
    if (isKokoroVoice(persona)) {
      return (
        this.activeEngine === 'kokoro' &&
        this.activeModel === resolveKokoroPackId(persona) &&
        isKokoroEngineReady()
      );
    }
    const model = resolvePiperModelId(persona);
    return (
      this.activeEngine === 'piper' &&
      this.activeModel === model &&
      isPiperReady()
    );
  }

  warmActiveVoice(voiceId?: VoiceId): Promise<WarmVoiceResult> {
    return this.enqueue(async () => this.doWarm(voiceId));
  }

  switchActiveVoice(voiceId: VoiceId): Promise<WarmVoiceResult> {
    return this.enqueue(async () => this.doWarm(voiceId, { forceSwitch: true }));
  }

  resetTracking(): void {
    this.activePersona = null;
    this.activeModel = null;
    this.activeEngine = null;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async doWarm(
    voiceId?: VoiceId,
    opts?: { forceSwitch?: boolean },
  ): Promise<WarmVoiceResult> {
    const activePersona =
      voiceId ??
      this.activePersona ??
      getCachedUserProfile()?.voiceId ??
      'standard_m';

    if (isKokoroVoice(activePersona)) {
      const pack = resolveKokoroPackId(activePersona);
      if (
        !opts?.forceSwitch &&
        this.activeEngine === 'kokoro' &&
        this.activeModel === pack &&
        isKokoroEngineReady()
      ) {
        return {
          activePersona,
          activePack: pack,
          activeModel: pack,
          engine: 'kokoro',
        };
      }
      await ensureKokoroPack(pack);
      // Piper-Modelle freigeben wenn Frauenstimme aktiv
      unloadInactivePiperModels(resolvePiperModelId('standard_m'));
      this.activePersona = activePersona;
      this.activeModel = pack;
      this.activeEngine = 'kokoro';
      markPiperWarmedUp();
      return {
        activePersona,
        activePack: pack,
        activeModel: pack,
        engine: 'kokoro',
      };
    }

    const activeModel = resolvePiperModelId(activePersona);
    if (
      !opts?.forceSwitch &&
      this.activeEngine === 'piper' &&
      this.activeModel === activeModel &&
      isPiperReady()
    ) {
      return {
        activePersona,
        activePack: activeModel,
        activeModel,
        engine: 'piper',
      };
    }

    await ensurePiperModel(activeModel);
    unloadInactivePiperModels(activeModel);
    unloadKokoroEngine();
    this.activePersona = activePersona;
    this.activeModel = activeModel;
    this.activeEngine = 'piper';
    markPiperWarmedUp();
    return {
      activePersona,
      activePack: activeModel,
      activeModel,
      engine: 'piper',
    };
  }
}

export const voicePreloader = new VoicePreloaderService();

registerActiveVoiceWarmer(
  (voiceId) => voicePreloader.warmActiveVoice(voiceId).then(() => undefined),
  () => voicePreloader.resetTracking(),
);
