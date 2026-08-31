/**
 * Native map: off-thread JSON parse (iOS + Android) + iOS compass.
 * Android compass: FindusMapCompass in app (nativeMapCompass.ts).
 */

import {
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';

type FindusMapNative = {
  parseMapExtractFile?: (filePath: string) => Promise<string>;
  startCompass?: () => Promise<boolean>;
  stopCompass?: () => Promise<boolean>;
  resetCompass?: () => Promise<boolean>;
  lockCompass?: () => Promise<boolean>;
  unlockCompass?: () => Promise<boolean>;
  nudgeCompass?: (courseDeg: number) => Promise<boolean>;
  setCompassFix?: (lat: number, lng: number, altM: number) => void;
};

const Native = NativeModules.FindusMapNative as FindusMapNative | undefined;

let iosCompassSub: { remove: () => void } | null = null;
let iosCompassRunning = false;

export async function parseMapExtractFileNative(
  filePath: string,
): Promise<string | null> {
  if (!filePath || !Native?.parseMapExtractFile) return null;
  try {
    const raw = await Native.parseMapExtractFile(filePath);
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function isNativeMapParseAvailable(): boolean {
  return typeof Native?.parseMapExtractFile === 'function';
}

export type CompassHeadingEvent = { deg: number; accuracy: number };

export async function startIosNativeCompass(
  onHeading: (ev: CompassHeadingEvent) => void,
): Promise<boolean> {
  if (Platform.OS !== 'ios' || !Native?.startCompass) return false;
  if (iosCompassRunning) return true;
  try {
    const ok = await Native.startCompass();
    if (!ok) return false;
    if (!iosCompassSub) {
      const emitter = new NativeEventEmitter(NativeModules.FindusMapNative);
      iosCompassSub = emitter.addListener(
        'FindusMapCompassHeading',
        (payload: { deg?: number; accuracy?: number }) => {
          const deg = Number(payload?.deg);
          if (!Number.isFinite(deg)) return;
          onHeading({
            deg,
            accuracy: Number(payload?.accuracy ?? -1),
          });
        },
      );
    }
    iosCompassRunning = true;
    return true;
  } catch {
    iosCompassRunning = false;
    return false;
  }
}

export async function stopIosNativeCompass(): Promise<void> {
  iosCompassRunning = false;
  try {
    iosCompassSub?.remove();
  } catch {
    /* soft */
  }
  iosCompassSub = null;
  try {
    await Native?.stopCompass?.();
  } catch {
    /* soft */
  }
}

export function iosLockCompass(): void {
  try {
    void Native?.lockCompass?.();
  } catch {
    /* soft */
  }
}

export function iosUnlockCompass(): void {
  try {
    void Native?.unlockCompass?.();
  } catch {
    /* soft */
  }
}

export function iosResetCompass(): void {
  try {
    void Native?.resetCompass?.();
  } catch {
    /* soft */
  }
}

export function iosNudgeCompass(courseDeg: number): void {
  if (!Number.isFinite(courseDeg)) return;
  try {
    void Native?.nudgeCompass?.(courseDeg);
  } catch {
    /* soft */
  }
}

export function iosSetCompassFix(
  lat: number,
  lng: number,
  altM?: number | null,
): void {
  if (!iosCompassRunning || !Native?.setCompassFix) return;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const alt =
    typeof altM === 'number' && Number.isFinite(altM) ? altM : 0;
  try {
    Native.setCompassFix(lat, lng, alt);
  } catch {
    /* soft */
  }
}
