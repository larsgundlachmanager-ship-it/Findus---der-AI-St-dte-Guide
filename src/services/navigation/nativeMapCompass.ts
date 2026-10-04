/**
 * Android-Kompass wie Google Maps: natives TYPE_ROTATION_VECTOR.
 * Hintergrund: Sensoren pausieren (AppState + Android onHostPause), Resume behält Lock.
 */

import {
  AppState,
  NativeEventEmitter,
  NativeModules,
  Platform,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';
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
  /** Sensoren aus, Desire/Lock bleiben (App-Hintergrund). */
  pause?: () => Promise<boolean>;
  reset?: () => Promise<boolean>;
  lock?: () => Promise<boolean>;
  unlock?: () => Promise<boolean>;
  nudge?: (courseDeg: number) => Promise<boolean>;
  setFix?: (lat: number, lng: number, altM: number) => void;
};

const Native = NativeModules.FindusMapCompass as NativeMapCompass | undefined;

let sub: { remove: () => void } | null = null;
/** Sensoren laufen gerade. */
let running = false;
/** JS will Kompass — auch wenn Background-Pause. */
let desired = false;
let backgroundPaused = false;
let pendingLock = false;
let appStateSub: NativeEventSubscription | null = null;
let lastAppState: AppStateStatus = AppState.currentState;

export function isNativeMapCompassActive(): boolean {
  return running;
}

export function isNativeMapCompassDesired(): boolean {
  return desired;
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

function ensureAppStatePause(): void {
  if (appStateSub) return;
  lastAppState = AppState.currentState;
  appStateSub = AppState.addEventListener('change', (next) => {
    const prev = lastAppState;
    lastAppState = next;
    if (
      (next === 'background' || next === 'inactive') &&
      prev === 'active'
    ) {
      void pauseNativeMapCompassForBackground();
      return;
    }
    if (next === 'active' && prev !== 'active') {
      void resumeNativeMapCompassFromBackground();
    }
  });
}

async function actuallyStartAndroid(): Promise<boolean> {
  if (!Native?.start) return false;
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

async function actuallyStopAndroid(opts?: {
  keepListener?: boolean;
  /** true = nur Sensoren (Background); false = volles stop inkl. Desire-Clear auf Native. */
  sensorsOnly?: boolean;
}): Promise<void> {
  running = false;
  if (!opts?.keepListener) {
    try {
      sub?.remove();
    } catch {
      /* soft */
    }
    sub = null;
  }
  try {
    if (opts?.sensorsOnly && Native?.pause) {
      await Native.pause();
    } else {
      await Native?.stop?.();
    }
  } catch {
    /* soft */
  }
}

export async function startNativeMapCompass(): Promise<boolean> {
  desired = true;
  ensureAppStatePause();
  const state = AppState.currentState;
  if (state !== 'active') {
    backgroundPaused = true;
    running = false;
    return true;
  }
  backgroundPaused = false;
  if (Platform.OS === 'ios') {
    if (running) return true;
    const ok = await startIosNativeCompass(({ deg, accuracy }) => {
      noteFacingSensorHeading(deg);
      if (Number.isFinite(accuracy)) noteHeadingAccuracy(accuracy);
    });
    running = ok;
    return ok;
  }
  if (Platform.OS !== 'android') return false;
  return actuallyStartAndroid();
}

export async function stopNativeMapCompass(): Promise<void> {
  desired = false;
  backgroundPaused = false;
  if (Platform.OS === 'ios') {
    running = false;
    await stopIosNativeCompass();
    return;
  }
  await actuallyStopAndroid();
}

/** App in den Hintergrund — Sensoren aus, Desire behalten. */
export async function pauseNativeMapCompassForBackground(): Promise<void> {
  if (!desired || backgroundPaused) return;
  backgroundPaused = true;
  if (Platform.OS === 'ios') {
    if (!running) return;
    running = false;
    await stopIosNativeCompass();
    return;
  }
  if (Platform.OS === 'android') {
    // Listener behalten — Resume ohne Re-Subscribe-Sturm.
    await actuallyStopAndroid({ keepListener: true, sensorsOnly: true });
  }
}

/** Zurück in den Vordergrund — wenn gewünscht, Sensoren wieder an. */
export async function resumeNativeMapCompassFromBackground(): Promise<void> {
  if (!desired) return;
  backgroundPaused = false;
  if (AppState.currentState !== 'active') return;
  if (Platform.OS === 'ios') {
    if (running) return;
    const ok = await startIosNativeCompass(({ deg, accuracy }) => {
      noteFacingSensorHeading(deg);
      if (Number.isFinite(accuracy)) noteHeadingAccuracy(accuracy);
    });
    running = ok;
    return;
  }
  if (Platform.OS === 'android') {
    await actuallyStartAndroid();
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
  if (!running && !desired) return;
  if (Platform.OS === 'ios') {
    if (!running) return;
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
