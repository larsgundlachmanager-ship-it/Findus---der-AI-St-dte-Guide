/**
 * Wetter-Plan-Hysterese: Regen → Plan umbauen einmalig.
 * Automatisch zurück nur auf expliziten User-Wunsch — kein Flapping.
 */

import * as FileSystem from 'expo-file-system';
import { todayDateKey } from '../../types/dayPlan';

export type WeatherPlanLock = {
  dateKey: string;
  /** Fingerprint der Regenfenster, die den Swap ausgelöst haben */
  rainFingerprint: string;
  lockedAtMs: number;
  /** true = Outdoor/Indoor wurde wegen Regen getauscht */
  rainSwapApplied: boolean;
  /** User darf Revert erzwingen */
  allowAutoRevert: boolean;
};

const PATH = `${FileSystem.documentDirectory}findus-weather-plan-lock.json`;
let lock: WeatherPlanLock | null = null;
let hydrated = false;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return;
    lock = JSON.parse(await FileSystem.readAsStringAsync(PATH)) as WeatherPlanLock;
  } catch {
    lock = null;
  }
}

function persist(): void {
  void FileSystem.writeAsStringAsync(PATH, JSON.stringify(lock)).catch(() => {});
}

export function rainWindowsFingerprint(
  windows: Array<{ startMs: number; endMs: number; pop?: number }>,
): string {
  return windows
    .slice(0, 6)
    .map(
      (w) =>
        `${Math.round(w.startMs / 60_000)}-${Math.round(w.endMs / 60_000)}-${w.pop ?? 0}`,
    )
    .join('|');
}

export async function getWeatherPlanLock(): Promise<WeatherPlanLock | null> {
  await hydrate();
  if (lock && lock.dateKey !== todayDateKey()) {
    lock = null;
  }
  return lock;
}

export function getWeatherPlanLockSync(): WeatherPlanLock | null {
  void hydrate();
  if (lock && lock.dateKey !== todayDateKey()) return null;
  return lock;
}

/** Nach erfolgreichem Regen-Swap: sperren gegen Auto-Revert. */
export function lockWeatherRainSwap(fingerprint: string): void {
  void hydrate();
  lock = {
    dateKey: todayDateKey(),
    rainFingerprint: fingerprint,
    lockedAtMs: Date.now(),
    rainSwapApplied: true,
    allowAutoRevert: false,
  };
  persist();
}

/** User: „Plan zurück / Wetter egal / wieder outdoor“ → Revert erlaubt. */
export function unlockWeatherPlanForUserRevert(userText?: string): boolean {
  const t = (userText ?? '').toLowerCase();
  const wants =
    /\b(plan\s+zurück|zurück\s+zum\s+plan|wieder\s+outdoor|regen\s+ist\s+mir\s+egal|wetter\s+egal|original\s*plan|tausch\s+rückgängig)\b/iu.test(
      t,
    );
  if (!wants) return false;
  void hydrate();
  if (!lock) {
    lock = {
      dateKey: todayDateKey(),
      rainFingerprint: '',
      lockedAtMs: Date.now(),
      rainSwapApplied: false,
      allowAutoRevert: true,
    };
  } else {
    lock = { ...lock, allowAutoRevert: true, rainSwapApplied: false };
  }
  persist();
  return true;
}

/**
 * Darf Modul 5 wegen „kein Regen mehr“ den Tausch rückgängig machen?
 * Default: nein (Hysterese).
 */
export function canAutoRevertWeatherPlan(currentFingerprint: string): boolean {
  void hydrate();
  if (!lock || lock.dateKey !== todayDateKey()) return true; // noch nie geswappt
  if (lock.allowAutoRevert) return true;
  if (!lock.rainSwapApplied) return true;
  // Neuer / stärkerer Regen → erneut anpassen ok
  if (currentFingerprint && currentFingerprint !== lock.rainFingerprint) {
    return true;
  }
  // Regen weg (leerer Fingerprint) → NICHT auto zurück
  if (!currentFingerprint && lock.rainSwapApplied) return false;
  return false;
}

/** Context: Outdoor im Plan oder Nav aktiv? */
export function shouldWeatherStayAlert(opts: {
  navActive: boolean;
  hasOutdoorPlanToday: boolean;
  stationaryMs: number;
}): { alertMode: boolean; sleepMs: number } {
  if (opts.navActive || opts.hasOutdoorPlanToday) {
    return { alertMode: true, sleepMs: 0 };
  }
  // 3h still + kein Outdoor → Sleep (4h Basis-Check)
  if (opts.stationaryMs >= 3 * 60 * 60_000) {
    return { alertMode: false, sleepMs: 4 * 60 * 60_000 };
  }
  return { alertMode: true, sleepMs: 0 };
}
