import { NativeModulesProxy, requireNativeModule } from 'expo-modules-core';

export type FindusEspeakNative = {
  initialize(dataPath: string, voice?: string): Promise<boolean>;
  isReady(): boolean;
  textToPhonemes(text: string, voice?: string): Promise<string>;
  getVoice(): string;
  /** APK-Asset → Dateisystem. Bytes geschrieben, oder -1. */
  copyAssetFile?(assetRelPath: string, destAbsPath: string): Promise<number>;
  /** Asset-Größe in Bytes, oder -1. */
  assetFileSize?(assetRelPath: string): Promise<number>;
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

/**
 * Kopiert eine APK-Asset-Datei nach destAbsPath via AssetManager.
 * Zuverlässiger als FileSystem.copyAsync(file:///android_asset/…).
 */
export async function nativeCopyAssetFile(
  assetRelPath: string,
  destAbsPath: string,
): Promise<boolean> {
  const mod = getNative();
  if (!mod?.copyAssetFile) {
    console.warn('[findus-espeak] copyAssetFile fehlt im Native-Modul');
    return false;
  }
  try {
    // file:// abstreifen — Kotlin File() braucht echten FS-Pfad
    let dest = destAbsPath.trim();
    if (dest.startsWith('file://')) {
      dest = dest.slice('file://'.length);
    }
    const size = await mod.copyAssetFile(assetRelPath, dest);
    const n = typeof size === 'number' ? size : Number(size);
    if (!Number.isFinite(n) || n <= 1000) {
      console.warn(
        `[findus-espeak] copyAssetFile fehlgeschlagen: ${assetRelPath} → ${dest} (size=${String(size)})`,
      );
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[findus-espeak] copyAssetFile:', e);
    return false;
  }
}

export async function nativeAssetFileSize(
  assetRelPath: string,
): Promise<number> {
  const mod = getNative();
  if (!mod?.assetFileSize) return -1;
  try {
    const size = await mod.assetFileSize(assetRelPath);
    return typeof size === 'number' ? size : -1;
  } catch {
    return -1;
  }
}

export default {
  isNativeEspeakAvailable,
  nativeEspeakInitialize,
  nativeEspeakIsReady,
  nativeEspeakTextToPhonemes,
  nativeCopyAssetFile,
  nativeAssetFileSize,
};
