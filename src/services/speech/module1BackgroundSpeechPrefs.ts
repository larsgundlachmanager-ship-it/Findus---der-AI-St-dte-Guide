/**
 * Wann Modul-1-Audio laufen darf, wenn App zu / Display gesperrt.
 * Default: immer (auch Hintergrund / Sperrbildschirm).
 */

import * as FileSystem from 'expo-file-system';

/** immer | nur Kopfhörer | nur bei geöffneter App */
export type Module1BackgroundSpeechMode = 'always' | 'headphones' | 'app_open';

export type Module1BackgroundSpeechPrefs = {
  mode: Module1BackgroundSpeechMode;
};

const PATH = `${FileSystem.documentDirectory}findus-module1-bg-speech.json`;

const DEFAULTS: Module1BackgroundSpeechPrefs = {
  mode: 'always',
};

let cache: Module1BackgroundSpeechPrefs | null = null;
let loaded = false;

function normalize(
  parsed: Partial<Module1BackgroundSpeechPrefs> | null | undefined,
): Module1BackgroundSpeechPrefs {
  const mode = parsed?.mode;
  if (mode === 'always' || mode === 'headphones' || mode === 'app_open') {
    return { mode };
  }
  return { ...DEFAULTS };
}

async function persist(p: Module1BackgroundSpeechPrefs): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(p));
  } catch {
    /* soft */
  }
}

export async function loadModule1BackgroundSpeechPrefs(): Promise<Module1BackgroundSpeechPrefs> {
  if (loaded && cache) return cache;
  loaded = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(PATH);
      cache = normalize(JSON.parse(raw) as Partial<Module1BackgroundSpeechPrefs>);
      return cache;
    }
  } catch {
    /* fresh */
  }
  cache = { ...DEFAULTS };
  return cache;
}

export function getModule1BackgroundSpeechModeSync(): Module1BackgroundSpeechMode {
  return cache?.mode ?? DEFAULTS.mode;
}

export async function patchModule1BackgroundSpeechPrefs(
  patch: Partial<Module1BackgroundSpeechPrefs>,
): Promise<Module1BackgroundSpeechPrefs> {
  const cur = await loadModule1BackgroundSpeechPrefs();
  const next = normalize({ ...cur, ...patch });
  cache = next;
  await persist(next);
  return next;
}
