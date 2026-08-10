import { filterPhonemesToVocab } from '../../constants/phonemeSanitize';
import type { GermanG2PProvider } from './types';
import { phonemizeGermanIpa } from './de/germanIpaG2p';
import { normalizeGermanTtsText } from './germanTextNormalize';
import {
  phonemizeGermanNativeEspeak,
  warmupNativeEspeakG2P,
} from './nativeEspeakG2p';

/**
 * @deprecated Historischer Name — leitet auf natives espeak-ng um.
 */
export async function warmupEspeakGermanG2P(): Promise<boolean> {
  return warmupNativeEspeakG2P();
}

export async function phonemizeGermanEspeak(text: string): Promise<string> {
  return phonemizeGermanNativeEspeak(text);
}

export const espeakGermanG2P: GermanG2PProvider = {
  id: 'espeak-ng-native-de',
  productionReady: true,
  phonemize(text: string): string {
    return filterPhonemesToVocab(
      phonemizeGermanIpa(normalizeGermanTtsText(text)),
    );
  },
};
