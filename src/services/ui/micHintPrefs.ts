/**
 * Merkt, ob User Tap-to-Type, Hold-to-Speak und Swipe-Lock schon genutzt hat.
 */

import * as FileSystem from 'expo-file-system';

const PATH = `${FileSystem.documentDirectory}findus-mic-hint.json`;

type MicHintPrefs = {
  usedTap: boolean;
  usedHold: boolean;
  usedLock: boolean;
};

let cache: MicHintPrefs | null = null;
let loaded = false;

async function persist(): Promise<void> {
  if (!cache) return;
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

export async function loadMicHintPrefs(): Promise<MicHintPrefs> {
  if (loaded && cache) return cache;
  loaded = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(PATH);
      const parsed = JSON.parse(raw) as Partial<MicHintPrefs>;
      cache = {
        usedTap: parsed.usedTap === true,
        usedHold: parsed.usedHold === true,
        usedLock: parsed.usedLock === true,
      };
      return cache;
    }
  } catch {
    /* fresh */
  }
  cache = { usedTap: false, usedHold: false, usedLock: false };
  return cache;
}

export function shouldShowMicHint(): boolean {
  return false;
}

/** Ausführliche Lock-Erklärung — dauerhaft aus (Mic-Coach entfernt). */
export function shouldShowMicLockHint(): boolean {
  return false;
}

export async function markMicTapUsed(): Promise<void> {
  const prefs = cache ?? (await loadMicHintPrefs());
  if (prefs.usedTap) return;
  cache = { ...prefs, usedTap: true };
  await persist();
}

export async function markMicHoldUsed(): Promise<void> {
  const prefs = cache ?? (await loadMicHintPrefs());
  if (prefs.usedHold) return;
  cache = { ...prefs, usedHold: true };
  await persist();
}

export async function markMicLockUsed(): Promise<void> {
  const prefs = cache ?? (await loadMicHintPrefs());
  if (prefs.usedLock) return;
  cache = { ...prefs, usedLock: true };
  await persist();
}
