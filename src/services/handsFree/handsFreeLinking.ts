/**
 * Deep-Links + System-Intents für Hands-free (yorro://voice/listen, Legacy findus://)
 * und QA/Text-Ask (yorro://ask?q=… / findus://voice/ask?q=…).
 */

import { Linking, Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import { requestHandsFreeListen, requestTypedAsk } from './handsFreeBus';

const LISTEN_PATHS = [
  'yorro://voice/listen',
  'yorro://listen',
  'findus://voice/listen',
  'findus://listen',
  'de.findus.app://voice/listen',
];

export function urlRequestsHandsFreeListen(url: string | null): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  // Ask-Links nicht als Listen missverstehen
  if (u.includes('voice/ask') || /:\/\/ask([/?#]|$)/i.test(u)) return false;
  if (u.includes('voice/listen') || u.endsWith('://listen')) return true;
  if (u.includes('action=speak') || u.includes('handsfree')) return true;
  return false;
}

/** findus://ask?q=… | findus://voice/ask?text=… */
export function extractTypedAskFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.replace(/^exp\+[a-z0-9-]+:\/\//i, 'https://'));
    const hostPath = `${parsed.host}${parsed.pathname}`.replace(/\/+$/, '');
    const isAsk =
      hostPath === 'ask' ||
      hostPath.endsWith('/ask') ||
      hostPath === 'voice/ask' ||
      /\/voice\/ask$/i.test(hostPath);
    if (!isAsk && !/:\/\/ask([/?#]|$)/i.test(url)) return null;
    const q =
      parsed.searchParams.get('q') ||
      parsed.searchParams.get('text') ||
      parsed.searchParams.get('query') ||
      '';
    return q.trim() || null;
  } catch {
    const m = url.match(/[?&#](?:q|text|query)=([^&#]+)/i);
    if (!m?.[1]) return null;
    try {
      return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() || null;
    } catch {
      return m[1].trim() || null;
    }
  }
}

export function handleIncomingHandsFreeUrl(url: string | null): boolean {
  const ask = extractTypedAskFromUrl(url);
  if (ask) {
    requestTypedAsk(ask, `url:${url}`);
    return true;
  }
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

/** Android: Assistenten-/Spracheingabe-Einstellungen öffnen (Gemini vs Yorro). */
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
