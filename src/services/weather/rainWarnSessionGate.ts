/**
 * Proaktive Regenwarnung: Session-Ruhe + Anti-Spam + Outdoor-only.
 * Voice / HUD-Tip / Push teilen denselben Gate.
 */

export const RAIN_WARN_AFTER_START_MS = 5 * 60_000;
/** Mindestens so lange zwischen zwei proaktiven Regenwarnungen. */
export const RAIN_WARN_MIN_INTERVAL_MS = 3 * 60 * 60_000;
/** Nach einer Warnung erst wieder, wenn ≥ so lange trocken. */
export const RAIN_WARN_MIN_DRY_AFTER_MS = 90 * 60_000;

const STORAGE_KEY = 'findus.rainWarn.proactive.v1';

type Persist = {
  lastWarnAtMs: number | null;
  drySinceMs: number | null;
  dontCareUntilMs: number | null;
};

let sessionStartedAtMs = 0;
let lastWarnAtMs: number | null = null;
let drySinceMs: number | null = null;
let dontCareUntilMs: number | null = null;
let hydrateStarted = false;

type AsyncStorageLike = {
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
};

function getAsyncStorage(): AsyncStorageLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-async-storage/async-storage').default;
  } catch {
    return null;
  }
}


function scheduleHydrate(): void {
  if (hydrateStarted) return;
  hydrateStarted = true;
  const AsyncStorage = getAsyncStorage();
  if (!AsyncStorage) return;
  void AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (!raw) return;
      const p = JSON.parse(raw) as Persist;
      if (typeof p.lastWarnAtMs === 'number') lastWarnAtMs = p.lastWarnAtMs;
      if (typeof p.drySinceMs === 'number') drySinceMs = p.drySinceMs;
      if (typeof p.dontCareUntilMs === 'number') dontCareUntilMs = p.dontCareUntilMs;
    })
    .catch(() => undefined);
}

function persist(): void {
  const AsyncStorage = getAsyncStorage();
  if (!AsyncStorage) return;
  void AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      lastWarnAtMs,
      drySinceMs,
      dontCareUntilMs,
    } satisfies Persist),
  ).catch(() => undefined);
}

/** Nächster 6-Uhr-Morgen (heute wenn noch vor 6, sonst morgen). */
export function nextMorning6AmMs(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  const six = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 6, 0, 0, 0);
  if (nowMs < six.getTime()) return six.getTime();
  six.setDate(six.getDate() + 1);
  return six.getTime();
}

export function markRainWarnSessionStart(nowMs = Date.now()): void {
  scheduleHydrate();
  if (sessionStartedAtMs === 0) sessionStartedAtMs = nowMs;
}

export function weatherSessionStartedAtMs(): number {
  if (sessionStartedAtMs === 0) markRainWarnSessionStart();
  return sessionStartedAtMs;
}

/** Trockenphase tracken (Regen vorbei → drySince setzen; nass → clear). */
export function noteRainDryState(opts: {
  rainingNow: boolean;
  nowMs?: number;
}): void {
  scheduleHydrate();
  const now = opts.nowMs ?? Date.now();
  if (opts.rainingNow) {
    if (drySinceMs != null) {
      drySinceMs = null;
      persist();
    }
    return;
  }
  if (drySinceMs == null) {
    drySinceMs = now;
    persist();
  }
}

export function markProactiveRainWarningIssued(nowMs = Date.now()): void {
  scheduleHydrate();
  lastWarnAtMs = nowMs;
  // Nach Warnung muss erst wieder eine frische Trockenphase entstehen
  drySinceMs = null;
  persist();
}

/** „Ist mir egal“ → bis nächsten Morgen 6 Uhr keine proaktive Regenwarnung. */
export function markRainDontCareUntilMorning(nowMs = Date.now()): void {
  scheduleHydrate();
  dontCareUntilMs = nextMorning6AmMs(nowMs);
  persist();
}

export function canIssueProactiveRainWarning(nowMs = Date.now()): boolean {
  scheduleHydrate();
  if (sessionStartedAtMs === 0) markRainWarnSessionStart(nowMs);
  if (nowMs - sessionStartedAtMs < RAIN_WARN_AFTER_START_MS) return false;
  if (dontCareUntilMs != null && nowMs < dontCareUntilMs) return false;
  if (lastWarnAtMs != null && nowMs - lastWarnAtMs < RAIN_WARN_MIN_INTERVAL_MS) {
    return false;
  }
  // Nach einer Warnung: erst wieder wenn ≥1,5 h trocken
  if (lastWarnAtMs != null) {
    if (drySinceMs == null) return false;
    if (nowMs - drySinceMs < RAIN_WARN_MIN_DRY_AFTER_MS) return false;
  }
  return true;
}

export function earliestProactiveRainWarnAtMs(nowMs = Date.now()): number {
  scheduleHydrate();
  if (sessionStartedAtMs === 0) markRainWarnSessionStart(nowMs);
  let t = sessionStartedAtMs + RAIN_WARN_AFTER_START_MS;
  if (dontCareUntilMs != null) t = Math.max(t, dontCareUntilMs);
  if (lastWarnAtMs != null) {
    t = Math.max(t, lastWarnAtMs + RAIN_WARN_MIN_INTERVAL_MS);
    if (drySinceMs != null) {
      t = Math.max(t, drySinceMs + RAIN_WARN_MIN_DRY_AFTER_MS);
    } else {
      // Noch nass / keine Trockenphase → frühestens Intervall + min dry ab jetzt
      t = Math.max(t, nowMs + RAIN_WARN_MIN_DRY_AFTER_MS);
    }
  }
  return t;
}

/** Tests. */
export function resetRainWarnSessionForTests(): void {
  sessionStartedAtMs = 0;
  lastWarnAtMs = null;
  drySinceMs = null;
  dontCareUntilMs = null;
  hydrateStarted = true; // skip async hydrate in tests
}
