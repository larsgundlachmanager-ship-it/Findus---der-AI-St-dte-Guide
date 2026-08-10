import type { VoiceId } from '../types/userProfile';

/** Metro-gebündelte Hörproben — optional; sonst Live-Cartesia. */
export const VOICE_SAMPLE_MODULES: Partial<Record<VoiceId, number>> = {};

/** Vorgerendertes Onboarding-Intro (Fallback; Live-Cartesia bevorzugt). */
export const INTRO_WAV_MODULE = require('../assets/audio/intro.wav');
