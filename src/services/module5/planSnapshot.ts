/**
 * Plan-Snapshot vor Wetter-Swap — 1:1 Restore bei „Plan zurück“.
 */

import * as FileSystem from 'expo-file-system';
import type { DayPlanItem } from '../../types/dayPlan';
import { todayDateKey } from '../../types/dayPlan';
import { useDayPlanStore } from '../../store/useDayPlanStore';

export type PlanSnapshot = {
  dateKey: string;
  savedAtMs: number;
  reason: string;
  items: DayPlanItem[];
};

const PATH = `${FileSystem.documentDirectory}findus-plan-weather-snapshot.json`;
let snapshot: PlanSnapshot | null = null;
let hydrated = false;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return;
    snapshot = JSON.parse(
      await FileSystem.readAsStringAsync(PATH),
    ) as PlanSnapshot;
  } catch {
    snapshot = null;
  }
}

function persist(): void {
  void FileSystem.writeAsStringAsync(
    PATH,
    JSON.stringify(snapshot),
  ).catch(() => {});
}

/** Vor Regen-Swap: aktuellen Plan sichern (nur einmal pro Tag, bis restored). */
export function saveWeatherPlanSnapshot(opts?: {
  dateKey?: string;
  reason?: string;
}): void {
  void hydrate();
  const dateKey = opts?.dateKey ?? todayDateKey();
  if (snapshot?.dateKey === dateKey && snapshot.items.length) {
    // Bestehenden Snapshot behalten (erster Zustand vor erstem Swap)
    return;
  }
  const day = useDayPlanStore.getState().getDay(dateKey);
  snapshot = {
    dateKey,
    savedAtMs: Date.now(),
    reason: opts?.reason ?? 'pre_weather_swap',
    items: day.items.map((it) => ({ ...it, meta: it.meta ? { ...it.meta } : undefined })),
  };
  persist();
}

export function getWeatherPlanSnapshotSync(): PlanSnapshot | null {
  void hydrate();
  if (snapshot && snapshot.dateKey !== todayDateKey()) return null;
  return snapshot;
}

/**
 * Snapshot 1:1 wiederherstellen — keine API-Checks.
 * @returns true wenn restored
 */
export function restoreWeatherPlanSnapshot(opts?: {
  dateKey?: string;
  userText?: string;
}): boolean {
  void hydrate();
  const dateKey = opts?.dateKey ?? todayDateKey();
  if (!snapshot || snapshot.dateKey !== dateKey || !snapshot.items.length) {
    return false;
  }
  useDayPlanStore.getState().replaceItems(
    dateKey,
    snapshot.items.map((it) => ({ ...it })),
  );
  useDayPlanStore.getState().addChange(dateKey, {
    summary: 'Plan aus Speicher wiederhergestellt',
    reason: 'user_plan_zurück',
    significant: true,
  });
  snapshot = null;
  persist();
  return true;
}

export function clearWeatherPlanSnapshot(): void {
  snapshot = null;
  persist();
}

export function wantsPlanSnapshotRestore(userText: string): boolean {
  return /\b(plan\s+zurück|zurück\s+zum\s+plan|wieder\s+outdoor|original\s*plan|tausch\s+rückgängig|mach\s+(?:das\s+)?wieder\s+rückgängig|rückgängig)\b/iu.test(
    userText,
  );
}
