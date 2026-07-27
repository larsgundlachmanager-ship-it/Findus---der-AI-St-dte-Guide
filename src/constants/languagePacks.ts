/**
 * Sprachpakete für Findus TTS — Piper DE (6 Stimmen).
 */
export type LanguagePackId = 'de';

export type LanguagePack = {
  id: LanguagePackId;
  labelDe: string;
  flag: string;
  preferBundled: boolean;
  defaultVoiceId: string;
  /** @deprecated Kokoro-Lang-Code — Piper nutzt espeak voice "de". */
  kokoroLang?: string;
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
    defaultVoiceId: 'standard_m',
    kokoroLang: 'de',
    modelSizeMb: 63,
  },
];

export function getLanguagePack(id: LanguagePackId): LanguagePack {
  return LANGUAGE_PACKS.find((p) => p.id === id) ?? LANGUAGE_PACKS[0];
}
