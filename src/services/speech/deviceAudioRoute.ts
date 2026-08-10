/**
 * Native bridge: device lock + external audio (BT / wired headset).
 * Android: FindusDeviceAudioModule (app Kotlin).
 * iOS: findus-device-audio Expo-Modul (AVAudioSession + protected data).
 *
 * Modul-1-Hintergrund: User-Pref always | headphones | app_open (Default: always).
 */

import { AppState, NativeModules, Platform } from 'react-native';
import { isLinkBackgroundSpeechArmed } from './backgroundSpeechPolicy';
import {
  getModule1BackgroundSpeechModeSync,
  loadModule1BackgroundSpeechPrefs,
} from './module1BackgroundSpeechPrefs';

export type SpeechRouteState = {
  deviceLocked: boolean;
  hasExternalAudio: boolean;
};

type NativeSpeechRoute = {
  getSpeechRouteState: () => Promise<{
    deviceLocked: boolean;
    hasExternalAudio: boolean;
    keyguardLocked?: boolean;
    screenInteractive?: boolean;
  }>;
};

const Native = NativeModules.FindusDeviceAudio as NativeSpeechRoute | undefined;

export async function getSpeechRouteState(): Promise<SpeechRouteState> {
  if (Native?.getSpeechRouteState) {
    try {
      const s = await Native.getSpeechRouteState();
      return {
        deviceLocked: Boolean(s.deviceLocked),
        hasExternalAudio: Boolean(s.hasExternalAudio),
      };
    } catch (err) {
      if (__DEV__) console.warn('[speechRoute] native failed:', err);
    }
  }

  if (isLinkBackgroundSpeechArmed()) {
    return { deviceLocked: false, hasExternalAudio: true };
  }
  const active = AppState.currentState === 'active';
  if (Platform.OS === 'ios' && AppState.currentState === 'inactive') {
    return { deviceLocked: false, hasExternalAudio: false };
  }
  return {
    deviceLocked: !active,
    hasExternalAudio: false,
  };
}

/**
 * May Findus speak aloud right now? (Modul 1 + Assistant, respektiert Pref)
 * - App offen + entsperrt → immer ja
 * - always → auch Hintergrund / Sperre
 * - headphones → Hintergrund/Sperre nur mit BT/Kabel
 * - app_open → nur Vordergrund, nie automatisch im Hintergrund
 * - Link-Background-Arm → ja (User hat Link aus Findus geöffnet)
 */
export async function canSpeakAloudNow(): Promise<boolean> {
  if (isLinkBackgroundSpeechArmed()) return true;

  try {
    await loadModule1BackgroundSpeechPrefs();
  } catch {
    /* soft */
  }

  const mode = getModule1BackgroundSpeechModeSync();
  const { deviceLocked, hasExternalAudio } = await getSpeechRouteState();
  const appState = AppState.currentState;
  // iOS: 'inactive' = z. B. Control Center / Lock-Übergang — nicht als „App offen“
  const appOpen = appState === 'active';
  const inForegroundUnlocked = appOpen && !deviceLocked;

  if (inForegroundUnlocked) return true;

  if (mode === 'always') return true;

  if (mode === 'headphones') {
    return hasExternalAudio;
  }

  // app_open: kein Auto-Audio wenn App zu oder Display gesperrt
  return false;
}

/**
 * Modul-1-Narration starten? Bei app_open im Hintergrund still überspringen
 * (kein Vibrations-/Notification-Stau).
 */
export async function canStartModule1Narration(): Promise<boolean> {
  try {
    await loadModule1BackgroundSpeechPrefs();
  } catch {
    /* soft */
  }
  const mode = getModule1BackgroundSpeechModeSync();
  if (mode === 'app_open') {
    const { deviceLocked } = await getSpeechRouteState();
    return AppState.currentState === 'active' && !deviceLocked;
  }
  return canSpeakAloudNow();
}
