/**
 * Native bridge: device lock + external audio (BT / wired headset).
 * Android: FindusDeviceAudioModule. iOS/web: AppState fallback.
 */

import { AppState, NativeModules, Platform } from 'react-native';

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
  if (Platform.OS === 'android' && Native?.getSpeechRouteState) {
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

  // iOS / fallback: no reliable lock API — treat non-active as locked,
  // assume no external audio (safer: no pocket speaker).
  const active = AppState.currentState === 'active';
  return {
    deviceLocked: !active,
    hasExternalAudio: false,
  };
}

/**
 * May Findus speak aloud right now?
 * - Unlocked → yes
 * - Locked + BT/headset → yes
 * - Locked + phone speaker → no (vibrate + notify instead)
 */
export async function canSpeakAloudNow(): Promise<boolean> {
  const { deviceLocked, hasExternalAudio } = await getSpeechRouteState();
  if (!deviceLocked) return true;
  return hasExternalAudio;
}
