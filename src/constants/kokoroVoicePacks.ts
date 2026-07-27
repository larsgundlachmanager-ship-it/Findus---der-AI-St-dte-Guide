/**
 * Kokoro-Packs — zwei deutsche Frauenstimmen (Victoria + Bella).
 * Männer bleiben auf Piper.
 * de_bella = af_bella Style (klar weiblich mit Martin lang=d).
 * de_eva ist upstream kaputt (= de_puck) und wird nicht genutzt.
 */
import type { VoiceId } from '../types/userProfile';

export type KokoroVoicePackId = 'de_eva' | 'de_nova' | 'de_bella' | 'de_victoria';
export type KokoroModelId = 'martin';

export type KokoroVoicePack = {
  id: KokoroVoicePackId;
  fileName: string;
  modelId: KokoroModelId;
  description: string;
  /**
   * Kokoro speed-Input (<1 = langsamer/weicher).
   * Leicht unter 1.0 → runder, weniger gehetzt.
   */
  speechSpeed: number;
};

export const KOKORO_VOICE_PACKS: Record<KokoroVoicePackId, KokoroVoicePack> = {
  de_eva: {
    id: 'de_eva',
    fileName: 'de_eva.bin',
    modelId: 'martin',
    description: 'Warm, nah, alltagsfreundlich (df_eva)',
    speechSpeed: 0.97,
  },
  de_nova: {
    id: 'de_nova',
    fileName: 'de_nova.bin',
    modelId: 'martin',
    description: 'Warm weiblich DE (df_victoria)',
    speechSpeed: 0.96,
  },
  de_victoria: {
    id: 'de_victoria',
    fileName: 'de_victoria.bin',
    modelId: 'martin',
    description: 'Klar weiblich, märchenhaft (ohne Flüstern)',
    speechSpeed: 0.95,
  },
  de_bella: {
    id: 'de_bella',
    fileName: 'de_bella.bin',
    modelId: 'martin',
    description: 'Klar weiblich, märchenhaft (af_bella)',
    speechSpeed: 0.93,
  },
};

export const DEFAULT_KOKORO_PACK: KokoroVoicePackId = 'de_nova';

export const FEMALE_KOKORO_PACK_IDS: readonly KokoroVoicePackId[] = [
  'de_nova',
  'de_bella',
  'de_victoria',
] as const;

export const BASE_VOICE_PACK_IDS = FEMALE_KOKORO_PACK_IDS;

export const VOICE_ID_TO_KOKORO_PACK: Partial<
  Record<VoiceId, KokoroVoicePackId>
> = {
  /** Victoria — echte DE-Frau (df_victoria); de_eva war kaputt (= de_puck) */
  standard_w: 'de_nova',
  /** Victoria für Prinzessin (flüstert nicht) */
  prinzessin: 'de_victoria',
};

export function getKokoroVoicePack(id: KokoroVoicePackId): KokoroVoicePack {
  return KOKORO_VOICE_PACKS[id];
}

export function resolveKokoroPackId(
  voiceId?: VoiceId | null,
): KokoroVoicePackId {
  if (!voiceId) return DEFAULT_KOKORO_PACK;
  return VOICE_ID_TO_KOKORO_PACK[voiceId] ?? DEFAULT_KOKORO_PACK;
}

export function kokoroSpeedForVoice(voiceId?: VoiceId | null): number {
  return getKokoroVoicePack(resolveKokoroPackId(voiceId)).speechSpeed;
}

export function isKokoroVoice(voiceId?: VoiceId | null): boolean {
  if (!voiceId) return false;
  return voiceId === 'standard_w' || voiceId === 'prinzessin';
}

export function kokoroModelAssetRelPath(): string {
  return 'kokoro/kokoro-martin.onnx';
}

export function kokoroVoiceAssetRelPath(packId: KokoroVoicePackId): string {
  return `kokoro/voices/${getKokoroVoicePack(packId).fileName}`;
}
