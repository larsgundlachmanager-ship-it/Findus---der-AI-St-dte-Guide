/**
 * Einmal pro Kalendertag: Index prüfen, nur die AKTIVE Stadt updaten.
 * Andere installierte Städte warten auf den Stadtwechsel.
 */

import { AppState, type NativeEventSubscription } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { getCachedUserProfile } from './userProfileService';
import { installCityPack } from './cityCatalogService';
import { isSoftCityId } from './softWorkingCity';

const META_PATH = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}city-pack-morning.json`
  : null;

type Meta = { lastCheckDay?: string };

let booted = false;
let appSub: NativeEventSubscription | null = null;
let inFlight: Promise<void> | null = null;

function todayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function readMeta(): Promise<Meta> {
  if (!META_PATH) return {};
  try {
    const info = await FileSystem.getInfoAsync(META_PATH);
    if (!info.exists) return {};
    const raw = await FileSystem.readAsStringAsync(META_PATH);
    const parsed = JSON.parse(raw) as Meta;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeMeta(meta: Meta): Promise<void> {
  if (!META_PATH) return;
  try {
    await FileSystem.writeAsStringAsync(META_PATH, JSON.stringify(meta));
  } catch {
    /* ignore */
  }
}

export async function maybeMorningActiveCitySync(opts?: {
  force?: boolean;
}): Promise<void> {
  const profile = getCachedUserProfile();
  if (!profile?.setupComplete) return;
  const cityId = String(profile.cityId || '').trim().toLowerCase();
  if (!cityId || isSoftCityId(cityId)) return;

  if (inFlight) {
    await inFlight;
    return;
  }

  inFlight = (async () => {
    const meta = await readMeta();
    const day = todayKey();
    if (!opts?.force && meta.lastCheckDay === day) return;
    await installCityPack(cityId, { checkRemote: true, reason: 'morning' });
    await writeMeta({ lastCheckDay: day });
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

export function bootstrapCityPackMorningSync(): void {
  if (booted) return;
  booted = true;
  void maybeMorningActiveCitySync().catch(() => undefined);
  appSub = AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    void maybeMorningActiveCitySync().catch(() => undefined);
  });
}

/** Tests */
export function resetCityPackMorningSyncForTests(): void {
  booted = false;
  appSub?.remove();
  appSub = null;
  inFlight = null;
}
