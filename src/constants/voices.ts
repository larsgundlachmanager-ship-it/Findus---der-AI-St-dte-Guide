import type { AppLanguage, VoiceId } from '../types/userProfile';
import {
  resolveKokoroPackId,
  type KokoroVoicePackId,
} from './kokoroVoicePacks';

export type VoiceDefinition = {
  id: VoiceId;
  emoji: string;
  kokoroPackId: KokoroVoicePackId;
  pitch: number;
  /** Systemweit unveränderbar 1.0 — kein Slider, keine Verzerrung. */
  baseSpeed: number;
  sample: string;
};

export const DEFAULT_VOICE_ID: VoiceId = 'standard_m';

/** Inferenz-/Playback-Tempo: systemweit fest (kein Sprechtempo-Slider). */
export const FIXED_SPEECH_RATE = 1.0;

/** @deprecated Früher Minimum — Tempo ist jetzt immer FIXED_SPEECH_RATE. */
export const MIN_SPEECH_RATE = FIXED_SPEECH_RATE;

/** Alle 8 Hörproben — vorgerendert unter src/assets/audio/samples/. */
export const EAGER_SAMPLE_VOICE_IDS: readonly VoiceId[] = [
  'standard_m',
  'standard_w',
  'prinzessin',
  'erzaehler',
  'dorfaeltester',
  'historiker',
  'gen_z',
  'energisch',
] as const;

/**
 * 8 UI-Rollen → 3 native deutsche Kokoro-Packs (de_thorsten / de_eva / de_karl).
 * Charakter nur über LLM-Textstil — nie Pitch/Speed-Manipulation.
 * Tempo ausnahmslos FIXED_SPEECH_RATE (1.0).
 */
export const VOICES: VoiceDefinition[] = [
  {
    id: 'standard_m',
    emoji: '👨',
    kokoroPackId: 'de_thorsten',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    sample:
      'Moin! Ich bin Findus. Mit mir erlebst du jeden Ort ganz entspannt und auf den Punkt gebracht. Ein ehrlicher, verlässlicher Begleiter für deine Tour.',
  },
  {
    id: 'standard_w',
    emoji: '👩',
    kokoroPackId: 'de_eva',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    sample:
      'Hallo! Ich freue mich darauf, gemeinsam mit dir die schönsten Ecken und Geheimnisse dieser Gegend zu entdecken. Lass uns einfach losgehen!',
  },
  {
    id: 'prinzessin',
    emoji: '👑',
    kokoroPackId: 'de_eva',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    sample:
      'Trete näher, werter Gast. Lass dich von mir in eine Welt voller Zauber und verborgener Geschichten entführen. Wir wandeln gemeinsam auf königlichen Pfaden.',
  },
  {
    id: 'erzaehler',
    emoji: '📖',
    kokoroPackId: 'de_thorsten',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    sample:
      'Lehn dich zurück. Wenn du diese Gegend erleben willst wie in einem epischen Blockbuster-Film, dann bist du bei mir genau richtig. Geschichte wird lebendig.',
  },
  {
    id: 'dorfaeltester',
    emoji: '🧓',
    kokoroPackId: 'de_karl',
    pitch: 1.0,
    /** Exakt wie Hörprobe: 1.0 — keine Drosselung. */
    baseSpeed: FIXED_SPEECH_RATE,
    sample:
      'Na, mein Kind. Über achtzig Jahre lebe ich schon hier. Ich kenne jeden Winkel und all die alten Geschichten aus der guten alten Zeit. Setz dich kurz zu mir.',
  },
  {
    id: 'historiker',
    emoji: '📜',
    kokoroPackId: 'de_karl',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    sample:
      'Willkommen. Präzise Fakten, historische Zusammenhänge und fundiertes Wissen – wenn du die Geschichte tiefgründig verstehen willst, bin ich dein perfekter Guide.',
  },
  {
    id: 'gen_z',
    emoji: '✌️',
    kokoroPackId: 'de_thorsten',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    sample:
      "Yo Bro! Wenn dir der ganze alte Kram zu langweilig ist und du Bock auf 'nen richtig freshen Vibe hast – safe, dann bin ich dein Mann! Let's go!",
  },
  {
    id: 'energisch',
    emoji: '⚡',
    kokoroPackId: 'de_eva',
    pitch: 1.0,
    baseSpeed: FIXED_SPEECH_RATE,
    sample:
      'Hey! Bist du bereit für ein richtiges Abenteuer? Pack die Sachen ein, wir erkunden diesen Ort mit voller Power und bester Laune!',
  },
];

export const VOICE_PROFILES = VOICES;

export function getVoice(id: VoiceId): VoiceDefinition {
  return VOICES.find((v) => v.id === id) ?? VOICES[0];
}

export function kokoroPackForVoice(id: VoiceId): KokoroVoicePackId {
  return getVoice(id).kokoroPackId ?? resolveKokoroPackId(id);
}

export function voicesForLanguage(_lang?: AppLanguage): VoiceDefinition[] {
  return VOICES;
}

export function defaultVoiceForLanguage(_lang?: AppLanguage): VoiceId {
  return DEFAULT_VOICE_ID;
}

export function speechLocaleForLanguage(_lang?: AppLanguage): string {
  return 'de-DE';
}

/** Systemweit fest 1.0 — Argumente werden ignoriert. */
export function clampSpeechRate(_rate?: number): number {
  return FIXED_SPEECH_RATE;
}
