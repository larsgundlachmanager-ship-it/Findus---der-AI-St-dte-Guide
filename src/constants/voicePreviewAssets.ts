/**
 * Offline Voice-Preview Assets — Metro-gebündelte MP3s.
 * Generiert via: node scripts/generateVoicePreviews.js
 */
import type { VoiceId } from '../types/userProfile';

export const VOICE_PREVIEW_MODULES: Record<VoiceId, number> = {
  alina: require('../assets/audio/voices/alina.mp3'),
  sebastian: require('../assets/audio/voices/sebastian.mp3'),
  klaus: require('../assets/audio/voices/klaus.mp3'),
  leander: require('../assets/audio/voices/leander.mp3'),
  lukas: require('../assets/audio/voices/lukas.mp3'),
  varson: require('../assets/audio/voices/varson.mp3'),
  alexander: require('../assets/audio/voices/alexander.mp3'),
  daniel: require('../assets/audio/voices/daniel.mp3'),
  jaqcline: require('../assets/audio/voices/jaqcline.mp3'),
  lea: require('../assets/audio/voices/lea.mp3'),
  rena: require('../assets/audio/voices/rena.mp3'),
  katie: require('../assets/audio/voices/katie.mp3'),
  skylar: require('../assets/audio/voices/skylar.mp3'),
  verini: require('../assets/audio/voices/verini.mp3'),
  viktoria: require('../assets/audio/voices/viktoria.mp3'),
  marlene: require('../assets/audio/voices/marlene.mp3'),
};
