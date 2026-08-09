/**
 * HistoricalTimelineState — append-only Realitätstagebuch (Ist).
 */

import { create } from 'zustand';
import { dateKeyFromMs, todayDateKey } from '../../utils/dateKeys';

export type HistoricalEntry = {
  id: string;
  dayKey: string;
  atMs: number;
  title: string;
  lat: number;
  lng: number;
  source: 'dwell' | 'module1' | 'manual' | 'disambiguation' | 'stamp';
  confidence: number;
  placeIds?: string[];
  emoji?: string;
};

type Store = {
  /** Alle Tage — append-only */
  entries: HistoricalEntry[];
  /** Kompat: aktueller Tag-Snapshot */
  timeline: { dayKey: string; entries: HistoricalEntry[] };
  append: (
    entry: Omit<HistoricalEntry, 'id' | 'dayKey'> & {
      id?: string;
      dayKey?: string;
    },
  ) => void;
  ensureDay: (dayKey: string) => void;
  entriesForDay: (dayKey: string) => HistoricalEntry[];
  hydrateEntries: (entries: HistoricalEntry[]) => void;
};

function syncTimeline(
  entries: HistoricalEntry[],
  dayKey: string,
): { dayKey: string; entries: HistoricalEntry[] } {
  return {
    dayKey,
    entries: entries
      .filter((e) => e.dayKey === dayKey)
      .sort((a, b) => a.atMs - b.atMs),
  };
}

export const useHistoricalTimelineStore = create<Store>((set, get) => ({
  entries: [],
  timeline: { dayKey: todayDateKey(), entries: [] },

  hydrateEntries: (raw) => {
    const entries = raw
      .map((e) => ({
        ...e,
        dayKey: e.dayKey || dateKeyFromMs(e.atMs),
      }))
      .sort((a, b) => a.atMs - b.atMs);
    const dayKey = todayDateKey();
    set({ entries, timeline: syncTimeline(entries, dayKey) });
  },

  ensureDay: (dayKey) => {
    const entries = get().entries;
    set({ timeline: syncTimeline(entries, dayKey) });
  },

  entriesForDay: (dayKey) =>
    get()
      .entries.filter((e) => e.dayKey === dayKey)
      .sort((a, b) => a.atMs - b.atMs),

  append: (entry) => {
    const dayKey = entry.dayKey ?? dateKeyFromMs(entry.atMs);
    const id =
      entry.id ??
      `h_${entry.atMs}_${Math.random().toString(36).slice(2, 8)}`;
    const next: HistoricalEntry = {
      id,
      dayKey,
      atMs: entry.atMs,
      title: entry.title,
      lat: entry.lat,
      lng: entry.lng,
      source: entry.source,
      confidence: entry.confidence,
      placeIds: entry.placeIds,
      emoji: entry.emoji,
    };
    const entries = [...get().entries, next];
    set({
      entries,
      timeline: syncTimeline(entries, todayDateKey()),
    });
  },
}));

export function readHistoricalSnapshot(): {
  dayKey: string;
  entries: HistoricalEntry[];
} {
  return useHistoricalTimelineStore.getState().timeline;
}
