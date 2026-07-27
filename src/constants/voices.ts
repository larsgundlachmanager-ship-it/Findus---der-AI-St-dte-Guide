import type { AppLanguage, VoiceId } from '../types/userProfile';
import {
  resolvePiperModelId,
  type PiperVoiceModelId,
} from './piperVoices';
import type { KokoroVoicePackId } from './kokoroVoicePacks';
import { isKokoroVoice } from './kokoroVoicePacks';

export type TtsEngineId = 'piper' | 'kokoro';

export type VoiceDefinition = {
  id: VoiceId;
  emoji: string;
  /** Piper-ONNX (Männer) oder ungenutzt bei Kokoro-Frauen. */
  piperModelId?: PiperVoiceModelId;
  /** Kokoro Style-Pack (Frauen). */
  kokoroPackId?: KokoroVoicePackId;
  ttsEngine: TtsEngineId;
  pitch: number;
  baseSpeed: number;
  sample: string;
  isPrimaryColor?: boolean;
};

export const DEFAULT_VOICE_ID: VoiceId = 'standard_m';

export const FIXED_SPEECH_RATE = 1.0;
export const MIN_SPEECH_RATE = FIXED_SPEECH_RATE;

export const PRIMARY_VOICE_COLOR_IDS: readonly VoiceId[] = [
  'standard_m',
  'standard_w',
  'dorfaeltester',
  'prinzessin',
  'gen_z',
  'historiker',
] as const;

export const EAGER_SAMPLE_VOICE_IDS: readonly VoiceId[] = [
  'standard_m',
  'standard_w',
  'dorfaeltester',
  'prinzessin',
  'gen_z',
  'historiker',
  'erzaehler',
] as const;

/**
 * Hybrid: Frauen → zwei Kokoro-Packs (eva / nova), Männer → Piper.
 */
export const VOICES: VoiceDefinition[] = [
  {
    id: 'standard_m',
    emoji: '🎙️',
    ttsEngine: 'piper',
    piperModelId: 'de_DE-thorsten-medium',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    isPrimaryColor: true,
    sample:
      'Moin! Schön, dass du da bist. Ich bin dein Begleiter für unterwegs und bringe die Geschichten direkt auf den Punkt – ganz ohne Schnickschnack. Egal ob Altstadt, Bahnhof oder historische Orte: Wenn du Bock auf eine entspannte, lebendige Tour hast, wähl mich einfach aus und wir düsen gemeinsam los!',
  },
  {
    id: 'standard_w',
    emoji: '🌸',
    ttsEngine: 'kokoro',
    kokoroPackId: 'de_nova',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    isPrimaryColor: true,
    sample:
      'Hallo. Ich freue mich, dich auf deiner Tour zu begleiten. Mit mir entdeckst du ganz entspannt die schönsten Ecken. Mit Liebe zum Detail, und einem warmen Vibe. Lass uns einfach zusammen durch die Straßen schlendern. Und die Geschichten genießen. Hast du Lust?',
  },
  {
    id: 'dorfaeltester',
    emoji: '🧓',
    ttsEngine: 'piper',
    piperModelId: 'de_DE-karl-medium',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    isPrimaryColor: true,
    sample:
      'Na, mein Lieber! Weißt du, ich kenne hier wirklich jeden einzelnen Stein und jede alte Gasse. Aber keine Sorge, ich schlafe beim Erzählen nicht ein! Ich hab immer noch ordentlich Humor und die besten Anekdoten von früher auf Lager. Schnapp dir deinen Krückstock und lass uns einfach losgehen!',
  },
  {
    id: 'prinzessin',
    emoji: '👑',
    ttsEngine: 'kokoro',
    kokoroPackId: 'de_bella',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    isPrimaryColor: true,
    sample:
      'Pst. Schau mal da drüben. Schön, dass du hier bist. Ich liebe verzauberte Orte, alte Schlösser, und geheimnisvolle Rätsel. Lass uns auf leisen Sohlen durch die Straßen wandeln. Und die magischen Geschichten entdecken. Kommst du mit mir?',
  },
  {
    id: 'gen_z',
    emoji: '✌️',
    ttsEngine: 'piper',
    piperModelId: 'de_DE-thorsten_emotional',
    /** ~16: höhere Stimmlage (Pitch-Shift nach Piper). */
    pitch: 1.2,
    baseSpeed: FIXED_SPEECH_RATE,
    isPrimaryColor: true,
    sample:
      'Yo, real talk: trockenes Museumsgelaber? Absolut kein Bock. Wir checken die coolsten Spots, haben richtig guten Vibe, und ich baller dir die besten Fun Facts und Insider raus. Safe, wähl mich – und ab geht’s!',
  },
  {
    id: 'historiker',
    emoji: '📜',
    ttsEngine: 'piper',
    piperModelId: 'de_DE-m_aishel-medium',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    isPrimaryColor: true,
    sample:
      'Schau mal! Vor dir liegt die Geschichte zum Anfassen. Kein staubiges Buch, sondern echte Orte, echte Menschen, echte Geheimnisse. Geh einfach drauf zu, und ich erzähl dir, was dahintersteckt — präzise, spannend, und nur für dich!',
  },
  {
    id: 'erzaehler',
    emoji: '📖',
    ttsEngine: 'piper',
    piperModelId: 'de_DE-thorsten-high',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    isPrimaryColor: false,
    sample:
      'Tritt näher... Und mach dich bereit. Wenn du deine Tour wie in einem epischen Blockbuster-Film erleben willst, dann bin ich deine Stimme.',
  },
];

export const VOICE_PROFILES = VOICES;

export function getVoice(id: VoiceId): VoiceDefinition {
  return VOICES.find((v) => v.id === id) ?? VOICES[0];
}

export function resolveTtsEngine(voiceId?: VoiceId | null): TtsEngineId {
  if (!voiceId) return 'piper';
  if (isKokoroVoice(voiceId)) return 'kokoro';
  return getVoice(voiceId).ttsEngine ?? 'piper';
}

export function piperModelForVoice(id: VoiceId): PiperVoiceModelId {
  const v = getVoice(id);
  return v.piperModelId ?? resolvePiperModelId(id);
}

/** @deprecated */
export function kokoroPackForVoice(id: VoiceId): KokoroVoicePackId | PiperVoiceModelId {
  const v = getVoice(id);
  if (v.kokoroPackId) return v.kokoroPackId;
  return piperModelForVoice(id);
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

/** Stimmlage der Persona (1 = original; >1 = jünger/höher). */
export function pitchForVoice(voiceId?: VoiceId | null): number {
  if (!voiceId) return 1;
  return clampPlaybackPitch(getVoice(voiceId).pitch);
}
