/**
 * Reisepräferenzen-Review: nach Stadtwechsel oder langer Inaktivität (aktive Nutzung).
 * „Aktiv“ = Frage gestellt oder Modul-1 ausgelöst — bloßes Öffnen zählt nicht.
 */

import * as FileSystem from 'expo-file-system';

const STATE_PATH = `${FileSystem.documentDirectory}findus-travel-prefs-review.json`;

/** ~14 Tage ohne aktive Nutzung → Prefs-Sheet */
export const TRAVEL_PREFS_IDLE_MS = 14 * 24 * 60 * 60_000;
/** Nach Stadtwechsel: Prefs anbieten (einmal pro Stadt) */
export const TRAVEL_PREFS_AFTER_CITY = true;

type State = {
  /** Letzte echte Nutzung (Frage / Modul 1) */
  lastActiveUseAtMs: number | null;
  /** Letztes Prefs-Review (Idle) */
  lastIdleReviewAtMs: number | null;
  /** Letztes Prefs-Review nach Stadtwechsel */
  lastCityReviewAtMs: number | null;
  /** Stadt-IDs, für die nach Wechsel schon Prefs gezeigt wurden */
  reviewedCityIds: string[];
};

let cached: State | null = null;
let pendingOpen: { reason: 'city' | 'idle'; cityId?: string } | null = null;
const listeners = new Set<(p: { reason: 'city' | 'idle'; cityId?: string }) => void>();

function defaultState(): State {
  return {
    lastActiveUseAtMs: Date.now(),
    lastIdleReviewAtMs: null,
    lastCityReviewAtMs: null,
    reviewedCityIds: [],
  };
}

async function load(): Promise<State> {
  if (cached) return cached;
  try {
    const info = await FileSystem.getInfoAsync(STATE_PATH);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(STATE_PATH);
      const parsed = JSON.parse(raw) as Partial<State>;
      cached = {
        lastActiveUseAtMs:
          typeof parsed.lastActiveUseAtMs === 'number'
            ? parsed.lastActiveUseAtMs
            : Date.now(),
        lastIdleReviewAtMs:
          typeof parsed.lastIdleReviewAtMs === 'number'
            ? parsed.lastIdleReviewAtMs
            : null,
        lastCityReviewAtMs:
          typeof parsed.lastCityReviewAtMs === 'number'
            ? parsed.lastCityReviewAtMs
            : null,
        reviewedCityIds: Array.isArray(parsed.reviewedCityIds)
          ? parsed.reviewedCityIds.filter((x) => typeof x === 'string')
          : [],
      };
      return cached;
    }
  } catch {
    /* soft */
  }
  cached = defaultState();
  return cached;
}

async function save(next: State): Promise<void> {
  cached = next;
  try {
    await FileSystem.writeAsStringAsync(STATE_PATH, JSON.stringify(next));
  } catch {
    /* soft */
  }
}

function emit(p: { reason: 'city' | 'idle'; cityId?: string }): void {
  pendingOpen = p;
  for (const l of listeners) {
    try {
      l(p);
    } catch {
      /* soft */
    }
  }
}

/** Frage gestellt / Modul-1 Story → aktive Nutzung. */
export function noteTravelPrefsActiveUse(): void {
  void (async () => {
    const s = await load();
    await save({ ...s, lastActiveUseAtMs: Date.now() });
  })();
}

export function subscribeTravelPrefsReview(
  fn: (p: { reason: 'city' | 'idle'; cityId?: string }) => void,
): () => void {
  listeners.add(fn);
  if (pendingOpen) {
    try {
      fn(pendingOpen);
    } catch {
      /* soft */
    }
  }
  return () => {
    listeners.delete(fn);
  };
}

export function clearPendingTravelPrefsReview(): void {
  pendingOpen = null;
}

/**
 * Nach akzeptiertem Stadtwechsel.
 * Prefs nur alle ~14 Tage — nicht bei jedem Hamburg→Wedel-Hop am selben Tag.
 */
export async function maybeOfferTravelPrefsAfterCity(
  cityId: string,
): Promise<boolean> {
  if (!TRAVEL_PREFS_AFTER_CITY || !cityId.trim()) return false;
  const s = await load();
  if (s.reviewedCityIds.includes(cityId)) return false;
  const lastCity = s.lastCityReviewAtMs ?? 0;
  if (Date.now() - lastCity < TRAVEL_PREFS_IDLE_MS) {
    // Stadt trotzdem merken, Sheet aber nicht öffnen
    const nextIds = [
      ...s.reviewedCityIds.filter((id) => id !== cityId),
      cityId,
    ].slice(-40);
    await save({ ...s, reviewedCityIds: nextIds });
    return false;
  }
  const nextIds = [...s.reviewedCityIds.filter((id) => id !== cityId), cityId].slice(
    -40,
  );
  await save({
    ...s,
    reviewedCityIds: nextIds,
    lastCityReviewAtMs: Date.now(),
  });
  emit({ reason: 'city', cityId });
  return true;
}

/** App wieder aktiv — Idle-Check (ohne Frage = kein Reset von lastActiveUse). */
export async function maybeOfferTravelPrefsAfterIdle(): Promise<boolean> {
  const s = await load();
  const last = s.lastActiveUseAtMs ?? 0;
  const idle = Date.now() - last;
  if (idle < TRAVEL_PREFS_IDLE_MS) return false;
  if (
    s.lastIdleReviewAtMs != null &&
    Date.now() - s.lastIdleReviewAtMs < TRAVEL_PREFS_IDLE_MS
  ) {
    return false;
  }
  await save({ ...s, lastIdleReviewAtMs: Date.now() });
  emit({ reason: 'idle' });
  return true;
}

export async function markTravelPrefsReviewed(): Promise<void> {
  const s = await load();
  await save({
    ...s,
    lastIdleReviewAtMs: Date.now(),
    lastCityReviewAtMs: Date.now(),
    lastActiveUseAtMs: Date.now(),
  });
  pendingOpen = null;
}
