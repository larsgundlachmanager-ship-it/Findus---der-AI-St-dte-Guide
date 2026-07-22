/**
 * Sprachpakete für Findus TTS.
 *
 * DE Multi-Speaker: Martin-ONNX (männlich) + Victoria-ONNX (weiblich, optional)
 * + 4 echte DE-Stimmpacks (thorsten/eva/karl/puck).
 */
export type LanguagePackId = 'de';

export type LanguagePack = {
  id: LanguagePackId;
  labelDe: string;
  flag: string;
  preferBundled: boolean;
  kokoroLang: string;
  defaultVoiceId: string;
  modelUrl?: string;
  voiceUrl?: string;
  modelSizeMb?: number;
};

export const LANGUAGE_PACKS: LanguagePack[] = [
  {
    id: 'de',
    labelDe: 'Deutsch',
    flag: '🇩🇪',
    preferBundled: true,
    kokoroLang: 'd',
    defaultVoiceId: 'standard_m',
    modelUrl:
      'https://huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin/resolve/main/kokoro-martin.onnx',
    voiceUrl:
      'https://huggingface.co/kikiri-tts/kikiri-german-martin/resolve/main/voices/martin.pt',
    modelSizeMb: 310,
  },
];

export function getLanguagePack(id: LanguagePackId): LanguagePack {
  return LANGUAGE_PACKS.find((p) => p.id === id) ?? LANGUAGE_PACKS[0];
}
