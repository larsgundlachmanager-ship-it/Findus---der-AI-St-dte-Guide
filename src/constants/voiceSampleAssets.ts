import type { VoiceId } from '../types/userProfile';

/** Metro-gebündelte Hörproben — 0 ms Ladezeit beim Play-Button. */
export const VOICE_SAMPLE_MODULES: Record<VoiceId, number> = {
  standard_m: require('../assets/audio/samples/standard_m.wav'),
  standard_w: require('../assets/audio/samples/standard_w.wav'),
  prinzessin: require('../assets/audio/samples/prinzessin.wav'),
  erzaehler: require('../assets/audio/samples/erzaehler.wav'),
  dorfaeltester: require('../assets/audio/samples/dorfaeltester.wav'),
  historiker: require('../assets/audio/samples/historiker.wav'),
  gen_z: require('../assets/audio/samples/gen_z.wav'),
};

/** Vorgerendertes Onboarding-Intro (de_thorsten / Standard-Männlich). */
export const INTRO_WAV_MODULE = require('../assets/audio/intro.wav');
