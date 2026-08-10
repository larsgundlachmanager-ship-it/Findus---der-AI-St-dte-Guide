/**
 * Deep-Links + System-Intents für Hands-free (findus://voice/listen).
 */

import { Linking, Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import { requestHandsFreeListen } from './handsFreeBus';

const LISTEN_PATHS = [
  'findus://voice/listen',
  'findus://listen',
  'de.findus.app://voice/listen',
];

export function urlRequestsHandsFreeListen(url: string | null): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  if (u.includes('voice/listen') || u.endsWith('://listen')) return true;
  if (u.includes('action=speak') || u.includes('handsfree')) return true;
  return false;
}

export function handleIncomingHandsFreeUrl(url: string | null): boolean {
  if (!urlRequestsHandsFreeListen(url)) return false;
  requestHandsFreeListen(`url:${url}`);
  return true;
}

export async function openHandsFreeListenDeepLink(): Promise<void> {
  try {
    await Linking.openURL(LISTEN_PATHS[0]!);
  } catch {
    requestHandsFreeListen('deeplink_fallback');
  }
}

/** Android: Assistenten-/Spracheingabe-Einstellungen öffnen (Gemini vs Findus). */
export async function openDigitalAssistantSettings(): Promise<void> {
  if (Platform.OS !== 'android') {
    try {
      await Linking.openSettings();
    } catch {
      /* soft */
    }
    return;
  }
  const candidates = [
    'android.settings.VOICE_INPUT_SETTINGS',
    'android.settings.MANAGE_DEFAULT_APPS_SETTINGS',
    'android.settings.SETTINGS',
  ];
  for (const action of candidates) {
    try {
      await IntentLauncher.startActivityAsync(action);
      return;
    } catch {
      /* next */
    }
  }
  try {
    await Linking.openSettings();
  } catch {
    /* soft */
  }
}
