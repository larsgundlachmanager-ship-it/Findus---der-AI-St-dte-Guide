/**
 * Android-Kompass wie Google Maps: natives TYPE_ROTATION_VECTOR.
 */

import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import {
  iosLockCompass,
  iosNudgeCompass,
  iosResetCompass,
  iosSetCompassFix,
  iosUnlockCompass,
  startIosNativeCompass,
  stopIosNativeCompass,
} from 'findus-map-native';
import { noteFacingSensorHeading, noteHeadingAccuracy } from './liveDeviceHeading';

type NativeMapCompass = {
  start?: () => Promise<boolean>;
  stop?: () => Promise<boolean>;
  reset?: () => Promise<boolean>;
  lock?: () => Promise<boolean>;
  unlock?: () => Promise<boolean>;
  nudge?: (courseDeg: number) => Promise<boolean>;
  setFix?: (lat: number, lng: number, altM: number) => void;
};

const Native = NativeModules.FindusMapCompass as NativeMapCompass | undefined;

let sub: { remove: () => void } | null = null;
let running = false;
let pendingLock = false;

export function isNativeMapCompassActive(): boolean {
  return running;
}

export function isNativeMapCompassLocked(): boolean {
  return pendingLock;
}

function applyPendingLock(): void {
  if (!pendingLock) return;
  try {
    void Native?.lock?.();
  } catch {
    /* soft */
  }
}

export async function startNativeMapCompass(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    if (running) return true;
    const ok = await startIosNativeCompass(({ deg, accuracy }) => {
      noteFacingSensorHeading(deg);
      if (Number.isFinite(accuracy)) noteHeadingAccuracy(accuracy);
    });
    running = ok;
    return ok;
  }
  if (Platform.OS !== 'android' || !Native?.start) return false;
  if (running) {
    applyPendingLock();
    return true;
  }
  try {
    const ok = await Native.start();
    if (!ok) return false;
    if (!sub) {
      const emitter = new NativeEventEmitter(NativeModules.FindusMapCompass);
      sub = emitter.addListener('FindusMapCompassHeading', (payload) => {
        const deg = Number(payload?.deg);
        if (!Number.isFinite(deg)) return;
        noteFacingSensorHeading(deg);
        const acc = Number(payload?.accuracy);
        if (Number.isFinite(acc)) noteHeadingAccuracy(acc);
      });
    }
    running = true;
    applyPendingLock();
    return true;
  } catch {
    running = false;
    return false;
  }
}

export async function stopNativeMapCompass(): Promise<void> {
  if (Platform.OS === 'ios') {
    running = false;
    await stopIosNativeCompass();
    return;
  }
  running = false;
  try {
    sub?.remove();
  } catch {
    /* soft */
  }
  sub = null;
  try {
    await Native?.stop?.();
  } catch {
    /* soft */
  }
}

export function resetNativeMapCompass(): void {
  pendingLock = false;
  if (Platform.OS === 'ios') {
    iosResetCompass();
    return;
  }
  try {
    void Native?.reset?.();
  } catch {
    /* soft */
  }
}

export function lockNativeMapCompass(): void {
  pendingLock = true;
  if (Platform.OS === 'ios') {
    iosLockCompass();
    return;
  }
  applyPendingLock();
}

export function unlockNativeMapCompass(): void {
  pendingLock = false;
  if (Platform.OS === 'ios') {
    iosUnlockCompass();
    return;
  }
  try {
    void Native?.unlock?.();
  } catch {
    /* soft */
  }
}

export function nudgeNativeMapCompass(courseDeg: number): void {
  if (!Number.isFinite(courseDeg)) return;
  if (!pendingLock) return;
  if (Platform.OS === 'ios') {
    iosNudgeCompass(courseDeg);
    return;
  }
  try {
    void Native?.nudge?.(courseDeg);
  } catch {
    /* soft */
  }
}

export function setNativeMapCompassFix(
  lat: number,
  lng: number,
  altM?: number | null,
): void {
  if (!running) return;
  if (Platform.OS === 'ios') {
    iosSetCompassFix(lat, lng, altM);
    return;
  }
  if (!Native?.setFix) return;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const alt =
    typeof altM === 'number' && Number.isFinite(altM) ? altM : 0;
  try {
    Native.setFix(lat, lng, alt);
  } catch {
    /* soft */
  }
}
