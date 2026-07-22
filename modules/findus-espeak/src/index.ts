import { NativeModulesProxy, requireNativeModule } from 'expo-modules-core';

export type FindusEspeakNative = {
  initialize(dataPath: string, voice?: string): Promise<boolean>;
  isReady(): boolean;
  textToPhonemes(text: string, voice?: string): Promise<string>;
  getVoice(): string;
};

let native: FindusEspeakNative | null = null;

function getNative(): FindusEspeakNative | null {
  if (native) return native;
  try {
    native = requireNativeModule<FindusEspeakNative>('FindusEspeak');
    return native;
  } catch {
    try {
      // Fallback for older proxy path
      const proxy = (NativeModulesProxy as Record<string, unknown>).FindusEspeak as
        | FindusEspeakNative
        | undefined;
      native = proxy ?? null;
      return native;
    } catch {
      return null;
    }
  }
}

/** true wenn natives espeak-ng JNI geladen ist */
export function isNativeEspeakAvailable(): boolean {
  return getNative() != null;
}

export async function nativeEspeakInitialize(
  dataPath: string,
  voice = 'de',
): Promise<boolean> {
  const mod = getNative();
  if (!mod) return false;
  return mod.initialize(dataPath, voice);
}

export function nativeEspeakIsReady(): boolean {
  const mod = getNative();
  return mod?.isReady() ?? false;
}

/**
 * Text → IPA via natives espeak-ng (voice default: de).
 * Wirft, wenn das Native-Modul fehlt oder nicht initialisiert ist.
 */
export async function nativeEspeakTextToPhonemes(
  text: string,
  voice = 'de',
): Promise<string> {
  const mod = getNative();
  if (!mod) {
    throw new Error('[findus-espeak] Native Modul nicht geladen — Dev Client neu bauen.');
  }
  return mod.textToPhonemes(text, voice);
}

export default {
  isNativeEspeakAvailable,
  nativeEspeakInitialize,
  nativeEspeakIsReady,
  nativeEspeakTextToPhonemes,
};
