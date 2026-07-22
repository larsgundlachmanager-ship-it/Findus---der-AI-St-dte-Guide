import { env } from '../config/env';
import type { VoiceId } from '../types/userProfile';

/** Ausschließlich 3 native deutsche Kokoro-Voice-Pakete — kein EN, kein Puck. */
export type KokoroVoicePackId = 'de_eva' | 'de_karl' | 'de_thorsten';

export type KokoroModelId = 'martin';

export type KokoroVoicePack = {
  id: KokoroVoicePackId;
  label: string;
  fileName: string;
  modelId: KokoroModelId;
  defaultUrl: string;
  fallbackUrls: string[];
  urlEnvKey?: string;
  npzKey?: string;
};

const HF_MARTIN_PT =
  'https://huggingface.co/kikiri-tts/kikiri-german-martin/resolve/main/voices/martin.pt';
const HF_VICTORIA_PT =
  'https://huggingface.co/kikiri-tts/kikiri-german-victoria/resolve/main/voices/victoria.pt';
const HF_BERND_GGUF =
  'https://huggingface.co/cstr/kokoro-voices-GGUF/resolve/main/kokoro-voice-dm_bernd.gguf';
const HF_EVA_GGUF =
  'https://huggingface.co/cstr/kokoro-voices-GGUF/resolve/main/kokoro-voice-df_eva.gguf';
const HF_MARTIN_NPZ =
  'https://huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin/resolve/main/voices-martin.npz';

export const DEFAULT_KOKORO_PACK: KokoroVoicePackId = 'de_thorsten';

/** Deutsche Basisstimmen — Boot-Preload (nur 3 Packs). */
export const BASE_VOICE_PACK_IDS: readonly KokoroVoicePackId[] = [
  'de_thorsten',
  'de_eva',
  'de_karl',
] as const;

export const KOKORO_VOICE_PACKS: Record<KokoroVoicePackId, KokoroVoicePack> = {
  de_eva: {
    id: 'de_eva',
    label: 'Eva (weiblich)',
    fileName: 'de_eva.bin',
    modelId: 'martin',
    defaultUrl: HF_VICTORIA_PT,
    fallbackUrls: [HF_EVA_GGUF],
    urlEnvKey: 'EXPO_PUBLIC_KOKORO_VOICE_URL_DE_EVA',
  },
  de_karl: {
    id: 'de_karl',
    label: 'Karl (männlich)',
    fileName: 'de_karl.bin',
    modelId: 'martin',
    defaultUrl: HF_BERND_GGUF,
    fallbackUrls: [HF_MARTIN_PT, HF_MARTIN_NPZ],
    urlEnvKey: 'EXPO_PUBLIC_KOKORO_VOICE_URL_DE_KARL',
    npzKey: 'martin',
  },
  de_thorsten: {
    id: 'de_thorsten',
    label: 'Thorsten (männlich)',
    fileName: 'de_thorsten.bin',
    modelId: 'martin',
    defaultUrl: HF_MARTIN_PT,
    fallbackUrls: [HF_MARTIN_NPZ],
    urlEnvKey: 'EXPO_PUBLIC_KOKORO_VOICE_URL_DE_THORSTEN',
    npzKey: 'martin',
  },
};

/**
 * UI-Rolle → deutsches Kokoro-Pack.
 * gen_z → Thorsten (Slang nur über LLM), energisch → Eva (Dynamik über LLM).
 */
export const VOICE_ID_TO_KOKORO_PACK: Record<VoiceId, KokoroVoicePackId> = {
  standard_m: 'de_thorsten',
  standard_w: 'de_eva',
  prinzessin: 'de_eva',
  erzaehler: 'de_thorsten',
  dorfaeltester: 'de_karl',
  historiker: 'de_karl',
  gen_z: 'de_thorsten',
  energisch: 'de_eva',
};

export function getKokoroVoicePack(id: KokoroVoicePackId): KokoroVoicePack {
  return KOKORO_VOICE_PACKS[id];
}

export function resolveKokoroPackId(voiceId?: VoiceId | null): KokoroVoicePackId {
  if (!voiceId) return DEFAULT_KOKORO_PACK;
  return VOICE_ID_TO_KOKORO_PACK[voiceId] ?? DEFAULT_KOKORO_PACK;
}

export function modelIdForPack(_packId: KokoroVoicePackId): KokoroModelId {
  return 'martin';
}

export function resolveKokoroPackUrls(pack: KokoroVoicePack): string[] {
  const urls: string[] = [];
  const push = (u: string) => {
    const t = u.trim();
    if (t && !urls.includes(t)) urls.push(t);
  };
  if (pack.urlEnvKey) push(env.get(pack.urlEnvKey));
  if (pack.id === 'de_thorsten' || pack.id === 'de_karl') {
    push(env.kokoroVoiceUrl());
  }
  push(pack.defaultUrl);
  for (const u of pack.fallbackUrls) push(u);
  return urls;
}

export function resolveKokoroPackUrl(pack: KokoroVoicePack): string {
  return resolveKokoroPackUrls(pack)[0] ?? '';
}

export function listKokoroVoicePacks(): KokoroVoicePack[] {
  return Object.values(KOKORO_VOICE_PACKS);
}

export function listDownloadableKokoroPacks(): KokoroVoicePack[] {
  return listKokoroVoicePacks();
}
