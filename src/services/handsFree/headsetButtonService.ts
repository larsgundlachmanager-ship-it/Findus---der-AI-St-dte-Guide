/**
 * In-Ear / Headset-Taste → Yorro (aus / einmal / Live-Chat).
 */

import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import {
  getHandsFreePrefsSync,
  loadHandsFreePrefs,
} from './handsFreePrefs';
import { requestHandsFreeListen } from './handsFreeBus';
import {
  isLiveChatActive,
  startLiveChatSession,
} from './liveChatSession';

type NativeHeadset = {
  startControls?: () => Promise<boolean>;
  stopControls?: () => Promise<boolean>;
  isActive?: () => Promise<boolean>;
};

const Native = NativeModules.FindusHeadset as NativeHeadset | undefined;

let wired = false;
let sub: { remove: () => void } | null = null;
let lastFireAt = 0;

async function onHeadsetActivate(reason?: string): Promise<void> {
  const now = Date.now();
  if (now - lastFireAt < 900) return;
  lastFireAt = now;

  await loadHandsFreePrefs();
  const mode = getHandsFreePrefsSync().headsetButtonMode;
  if (mode === 'off') return;
  if (isLiveChatActive()) return;

  if (__DEV__) console.log('[headset] activate:', reason, mode);

  if (mode === 'livechat') {
    const r = await startLiveChatSession('headset');
    if (r.ok) return;
  }
  requestHandsFreeListen(`headset:${reason ?? 'button'}`);
}

/** MediaSession starten + JS-Events. */
export async function syncHeadsetButtonControls(): Promise<void> {
  if (Platform.OS !== 'android' || !Native?.startControls) return;
  await loadHandsFreePrefs();
  const mode = getHandsFreePrefsSync().headsetButtonMode;

  if (mode === 'off') {
    await stopHeadsetButtonControls();
    return;
  }

  try {
    await Native.startControls();
  } catch (err) {
    console.warn('[headset] startControls failed:', err);
    return;
  }

  if (wired) return;
  wired = true;
  try {
    const emitter = new NativeEventEmitter(NativeModules.FindusHeadset);
    sub = emitter.addListener('FindusHeadsetActivate', (payload) => {
      void onHeadsetActivate(
        typeof payload?.reason === 'string' ? payload.reason : undefined,
      );
    });
  } catch (err) {
    console.warn('[headset] event wire failed:', err);
  }
}

export async function stopHeadsetButtonControls(): Promise<void> {
  try {
    sub?.remove();
  } catch {
    /* soft */
  }
  sub = null;
  wired = false;
  if (Native?.stopControls) {
    try {
      await Native.stopControls();
    } catch {
      /* soft */
    }
  }
}
