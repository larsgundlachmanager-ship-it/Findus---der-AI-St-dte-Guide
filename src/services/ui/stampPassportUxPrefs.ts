/**
 * Stempelkarte UX prefs — onboarding text disappears after first map interaction.
 */

import * as FileSystem from 'expo-file-system';

const PATH = `${FileSystem.documentDirectory}findus-stamp-passport-ux.json`;

export type StampPassportUxPrefs = {
  /** User pinched/panned/tapped the discover map successfully once. */
  mapInteracted: boolean;
};

let cache: StampPassportUxPrefs | null = null;
let loaded = false;

async function persist(): Promise<void> {
  if (!cache) return;
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

export async function loadStampPassportUxPrefs(): Promise<StampPassportUxPrefs> {
  if (loaded && cache) return cache;
  loaded = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(PATH);
      const parsed = JSON.parse(raw) as Partial<StampPassportUxPrefs>;
      cache = { mapInteracted: parsed.mapInteracted === true };
      return cache;
    }
  } catch {
    /* fresh */
  }
  cache = { mapInteracted: false };
  return cache;
}

export function shouldShowStampMapOnboarding(): boolean {
  if (!cache) return true;
  return !cache.mapInteracted;
}

export async function markStampMapInteracted(): Promise<void> {
  const prefs = cache ?? (await loadStampPassportUxPrefs());
  if (prefs.mapInteracted) return;
  cache = { ...prefs, mapInteracted: true };
  await persist();
}

/** Cloud-Merge: mapInteracted bleibt true wenn lokal oder remote einmal gesetzt. */
export async function applyStampPassportUxPrefsFromCloud(
  remote: Partial<StampPassportUxPrefs> | null | undefined,
): Promise<void> {
  if (!remote || typeof remote !== 'object') return;
  const local = await loadStampPassportUxPrefs();
  const next: StampPassportUxPrefs = {
    mapInteracted: local.mapInteracted || remote.mapInteracted === true,
  };
  if (next.mapInteracted === local.mapInteracted) return;
  cache = next;
  loaded = true;
  await persist();
}
