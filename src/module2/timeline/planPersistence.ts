/**
 * Persistiert FuturePlan (Soll) + HistoricalTimeline (Ist) auf Disk.
 * Kein automatisches Löschen — Zeitachse bleibt über App-Neustarts (≥2 Jahre nutzbar).
 */

import * as FileSystem from 'expo-file-system';
import {
  useFuturePlanStore,
  type FuturePlanState,
} from './futurePlanState';
import {
  useHistoricalTimelineStore,
  type HistoricalEntry,
} from './historicalTimelineState';

const PATH = `${FileSystem.documentDirectory}findus-plan-timeline-v1.json`;

type PersistedShape = {
  futurePlans: Record<string, FuturePlanState>;
  historical: HistoricalEntry[];
  savedAt: number;
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false;
let hydratePromise: Promise<void> | null = null;

function persistSoon(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const futurePlans = useFuturePlanStore.getState().plansByDay;
      const historical = useHistoricalTimelineStore.getState().entries;
      const payload: PersistedShape = {
        futurePlans,
        historical,
        savedAt: Date.now(),
      };
      void FileSystem.writeAsStringAsync(PATH, JSON.stringify(payload)).catch(
        () => undefined,
      );
    } catch {
      /* soft */
    }
  }, 800);
}

export function schedulePlanTimelinePersist(): void {
  persistSoon();
}

export async function hydratePlanTimeline(): Promise<void> {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const info = await FileSystem.getInfoAsync(PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(PATH);
        const parsed = JSON.parse(raw) as Partial<PersistedShape>;
        if (parsed.futurePlans && typeof parsed.futurePlans === 'object') {
          useFuturePlanStore.getState().hydratePlans(parsed.futurePlans);
        }
        if (Array.isArray(parsed.historical)) {
          useHistoricalTimelineStore.getState().hydrateEntries(parsed.historical);
        }
      }
    } catch {
      /* soft */
    } finally {
      hydrated = true;
      hydratePromise = null;
    }
  })();
  return hydratePromise;
}

/** Subscribe once after hydrate — keeps disk in sync. */
export function startPlanTimelinePersistWatchers(): () => void {
  const unsubA = useFuturePlanStore.subscribe(() => persistSoon());
  const unsubB = useHistoricalTimelineStore.subscribe(() => persistSoon());
  return () => {
    unsubA();
    unsubB();
    if (saveTimer) clearTimeout(saveTimer);
  };
}
