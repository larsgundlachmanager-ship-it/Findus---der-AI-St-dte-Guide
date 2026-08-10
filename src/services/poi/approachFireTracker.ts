/**
 * Approach/Wegweiser-Feuer-Tracker:
 * 2× getriggert mit ≥1 h Abstand, User nie am Haupt → dauerhaft LOCK.
 */

import * as FileSystem from 'expo-file-system';

const PATH = `${FileSystem.documentDirectory}findus-approach-fires.json`;
const MIN_GAP_MS = 60 * 60_000;

type FireRec = {
  /** Epoch-ms der Approach-Fires */
  fires: number[];
  /** Dauerhaft gesperrt */
  locked: boolean;
};

type Store = Record<string, FireRec>;

let cache: Store | null = null;

async function load(): Promise<Store> {
  if (cache) return cache;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) {
      cache = {};
      return cache;
    }
    const raw = await FileSystem.readAsStringAsync(PATH);
    const parsed = JSON.parse(raw) as Store;
    cache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    cache = {};
  }
  return cache;
}

async function save(store: Store): Promise<void> {
  cache = store;
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

function keyFor(spotKey: string | null | undefined, poiId: number): string {
  const sk = (spotKey ?? '').trim();
  return sk ? `sk:${sk}` : `id:${poiId}`;
}

export async function isApproachFireLocked(
  spotKey: string | null | undefined,
  poiId: number,
): Promise<boolean> {
  const store = await load();
  return Boolean(store[keyFor(spotKey, poiId)]?.locked);
}

/**
 * Nach erfolgreichem Approach-Speak aufrufen.
 * Zweiter Fire erst nach ≥1 h; danach ohne Main-Visit → lock.
 */
export async function recordApproachFire(opts: {
  spotKey?: string | null;
  poiId: number;
  mainVisited: boolean;
  nowMs?: number;
}): Promise<{ locked: boolean; fireCount: number }> {
  const now = opts.nowMs ?? Date.now();
  const store = await load();
  const key = keyFor(opts.spotKey, opts.poiId);
  const rec: FireRec = store[key] ?? { fires: [], locked: false };

  if (rec.locked) {
    return { locked: true, fireCount: rec.fires.length };
  }

  if (opts.mainVisited) {
    // Main besucht → Zähler zurück / kein Lock
    rec.fires = [];
    rec.locked = false;
    store[key] = rec;
    await save(store);
    return { locked: false, fireCount: 0 };
  }

  const last = rec.fires[rec.fires.length - 1];
  if (last != null && now - last < MIN_GAP_MS) {
    // Zu früh für „zweiten“ Fire — trotzdem merken für Gap, aber nicht als 2. zählen
    return { locked: false, fireCount: rec.fires.length };
  }

  rec.fires.push(now);
  // Nur die letzten 3 behalten
  if (rec.fires.length > 3) rec.fires = rec.fires.slice(-3);

  if (rec.fires.length >= 2) {
    rec.locked = true;
  }

  store[key] = rec;
  await save(store);
  return { locked: rec.locked, fireCount: rec.fires.length };
}

/** Main besucht → zugehörige Approach-Locks/Zähler clearen. */
export async function clearApproachFiresForSpot(
  spotKey: string | null | undefined,
  poiId: number,
): Promise<void> {
  const store = await load();
  const key = keyFor(spotKey, poiId);
  if (!store[key]) return;
  delete store[key];
  await save(store);
}
