import type { AppLanguage, VoiceId } from '../types/userProfile';
import {
  CARTESIA_VOICES,
  DEFAULT_CARTESIA_VOICE_ID,
  getCartesiaVoice,
  type CartesiaVoiceDefinition,
} from './cartesiaVoices';

export type TtsEngineId = 'cartesia';

export type VoiceDefinition = {
  id: VoiceId;
  emoji: string;
  cartesiaVoiceId: string;
  name: string;
  label: string;
  subtitle: string;
  ttsEngine: TtsEngineId;
  pitch: number;
  baseSpeed: number;
  sample: string;
  isPrimaryColor?: boolean;
};

export const DEFAULT_VOICE_ID: VoiceId = DEFAULT_CARTESIA_VOICE_ID;

export const FIXED_SPEECH_RATE = 1.0;
export const MIN_SPEECH_RATE = FIXED_SPEECH_RATE;

export const PRIMARY_VOICE_COLOR_IDS: readonly VoiceId[] =
  CARTESIA_VOICES.map((v) => v.id);

export const EAGER_SAMPLE_VOICE_IDS: readonly VoiceId[] =
  PRIMARY_VOICE_COLOR_IDS;

function fromCartesia(v: CartesiaVoiceDefinition): VoiceDefinition {
  return {
    id: v.id,
    emoji: v.emoji,
    cartesiaVoiceId: v.cartesiaVoiceId,
    name: v.name,
    label: v.label,
    subtitle: v.subtitle,
    ttsEngine: 'cartesia',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    sample: v.sample,
    isPrimaryColor: true,
  };
}

/** 16 Cartesia-Personas — Alina & Sebastian zuerst. */
export const VOICES: VoiceDefinition[] = CARTESIA_VOICES.map(fromCartesia);

export const VOICE_PROFILES = VOICES;

export function getVoice(id: VoiceId): VoiceDefinition {
  return VOICES.find((v) => v.id === id) ?? VOICES[0];
}

export function resolveTtsEngine(_voiceId?: VoiceId | null): TtsEngineId {
  return 'cartesia';
}

export function cartesiaIdForVoice(id?: VoiceId | null): string {
  return getCartesiaVoice(id).cartesiaVoiceId;
}

export function voicesForLanguage(_lang?: AppLanguage): VoiceDefinition[] {
  return VOICES.filter((v) => v.isPrimaryColor);
}

export function allVoices(): VoiceDefinition[] {
  return VOICES;
}

export function defaultVoiceForLanguage(_lang?: AppLanguage): VoiceId {
  return DEFAULT_VOICE_ID;
}

export function speechLocaleForLanguage(_lang?: AppLanguage): string {
  return 'de-DE';
}

export function clampSpeechRate(_rate?: number): number {
  return FIXED_SPEECH_RATE;
}

export function clampPlaybackPitch(rate?: number): number {
  if (rate == null || !Number.isFinite(rate)) return 1;
  return Math.max(0.85, Math.min(1.35, rate));
}

export function pitchForVoice(voiceId?: VoiceId | null): number {
  if (!voiceId) return 1;
  return clampPlaybackPitch(getVoice(voiceId).pitch);
}
