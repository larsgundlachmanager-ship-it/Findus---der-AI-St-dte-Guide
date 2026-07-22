/**
 * VoicePreloaderService — Singleton Keep-Warm für genau eine aktive Stimme.
 *
 * Hält Martin-ONNX-Session + Style-Vektor der gewählten Persona (voiceId)
 * dauerhaft im RAM. Bei Stimmwechsel: alte Pack-ID entladen, neue warm laden.
 * Aktive Stimme wird nie invalidiert, außer Persona-Wechsel oder App-Exit.
 *
 * Hinweis: Profil-Feld ist `voiceId` (8 UI-Rollen → 3 Packs de_thorsten/eva/karl).
 */
import { resolveKokoroPackId, type KokoroVoicePackId } from '../../constants/kokoroVoicePacks';
import type { VoiceId } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';
import {
  ensureMartinOrtSession,
  isKokoroReady,
  isVoicePackInRam,
  loadVoiceIntoRam,
  markKokoroWarmedUp,
  registerActiveVoiceWarmer,
  synthesizeWav,
  unloadInactiveVoicePacks,
  unloadVoiceFromRam,
} from '../AudioVoiceService';

export type WarmVoiceResult = {
  activePersona: VoiceId;
  activePack: KokoroVoicePackId;
};

class VoicePreloaderService {
  private activePersona: VoiceId | null = null;
  private activePack: KokoroVoicePackId | null = null;
  private chain: Promise<void> = Promise.resolve();

  getActivePersona(): VoiceId | null {
    return this.activePersona;
  }

  getActivePack(): KokoroVoicePackId | null {
    return this.activePack;
  }

  isZeroLatencyReady(voiceId?: VoiceId): boolean {
    const persona =
      voiceId ?? this.activePersona ?? getCachedUserProfile()?.voiceId ?? null;
    if (!persona) return false;
    const pack = resolveKokoroPackId(persona);
    return (
      this.activePack === pack &&
      isVoicePackInRam(pack) &&
      isKokoroReady()
    );
  }

  /**
   * App-Start / Keep-Warm: liest User-Persona (voiceId) und lädt den
   * zugehörigen Pack (de_thorsten | de_eva | de_karl) vollständig in den RAM.
   * ONNX-Session bleibt offen → 0,0s Start-Latenz bei GPS/Chat-TTS.
   */
  warmActiveVoice(voiceId?: VoiceId): Promise<WarmVoiceResult> {
    return this.enqueue(async () => this.doWarm(voiceId));
  }

  /**
   * Settings/Onboarding: alte Stimme aus RAM entladen, neue unverzüglich warm laden.
   */
  switchActiveVoice(voiceId: VoiceId): Promise<WarmVoiceResult> {
    return this.enqueue(async () => this.doWarm(voiceId, { forceSwitch: true }));
  }

  /** Nach System-Reset: interne Keep-Warm-Marker löschen (Session/RAM separat). */
  resetTracking(): void {
    this.activePersona = null;
    this.activePack = null;
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
      voiceId ?? getCachedUserProfile()?.voiceId ?? 'standard_m';
    const activePack = resolveKokoroPackId(activePersona);

    if (
      !opts?.forceSwitch &&
      this.activePersona === activePersona &&
      this.activePack === activePack &&
      isVoicePackInRam(activePack) &&
      isKokoroReady()
    ) {
      return { activePersona, activePack };
    }

    // Session zuerst warm halten — nie die aktive Session schließen
    await ensureMartinOrtSession();

    if (this.activePack && this.activePack !== activePack) {
      unloadVoiceFromRam(this.activePack);
    }
    unloadInactiveVoicePacks(activePack);

    await loadVoiceIntoRam(activePack);
    markKokoroWarmedUp();

    // Keep-warm pulse: Graph/Allocator einmal anstoßen (Fehler ignorieren)
    await synthesizeWav('Start', {
      voiceId: activePersona,
      speechRate: 1,
    }).catch(() => undefined);

    this.activePersona = activePersona;
    this.activePack = activePack;

    console.log(
      `[VoicePreloader] Active voice '${activePersona}' successfully warmed up in RAM. Zero-latency ready.`,
    );

    return { activePersona, activePack };
  }
}

/** Singleton — eine aktive Stimme, dauerhaft keep-warm. */
export const voicePreloader = new VoicePreloaderService();

export { VoicePreloaderService };

// Engine-Hooks: Boot/Warmup/Reset ohne Circular Import / Dynamic Import
registerActiveVoiceWarmer(
  async (voiceId) => {
    await voicePreloader.warmActiveVoice(voiceId);
  },
  () => voicePreloader.resetTracking(),
);
