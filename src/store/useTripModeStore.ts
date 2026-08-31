/**
 * Aktiver Touristen-Trip (N Tage in Stadt) — SSOT für Welcome / Briefing / Calendar.
 */

import { create } from 'zustand';
import * as FileSystem from 'expo-file-system';
import { offsetDateKey, todayDateKey } from '../utils/dateKeys';

export type TripModeState = {
  active: boolean;
  cityId: string | null;
  cityName: string | null;
  startDayKey: string;
  endDayKey: string;
  dayCount: number;
  source: 'voice' | 'onboarding' | 'manual';
  activatedAtMs: number;
};

type Store = TripModeState & {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  persist: () => Promise<void>;
  startTrip: (input: {
    cityId?: string | null;
    cityName?: string | null;
    startDayKey: string;
    dayCount: number;
    source?: TripModeState['source'];
  }) => TripModeState;
  clearTrip: () => void;
  /** 1-basiert; null wenn kein aktiver Trip / außerhalb Fenster */
  getTripDayIndex: (dayKey?: string) => number | null;
  isTripCity: (cityId?: string | null, cityName?: string | null) => boolean;
};

const PATH = `${FileSystem.documentDirectory}findus-trip-mode.json`;

function emptyTrip(): TripModeState {
  const today = todayDateKey();
  return {
    active: false,
    cityId: null,
    cityName: null,
    startDayKey: today,
    endDayKey: today,
    dayCount: 0,
    source: 'manual',
    activatedAtMs: 0,
  };
}

function endKeyFrom(start: string, dayCount: number): string {
  const n = Math.max(1, Math.min(14, dayCount));
  // dayCount=1 → nur Starttag; dayCount=4 → Start + 3
  return offsetDateKey(n - 1, Date.parse(`${start}T12:00:00`));
}

async function writeDisk(state: TripModeState): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      PATH,
      JSON.stringify(state, null, 2),
      { encoding: FileSystem.EncodingType.UTF8 },
    );
  } catch (err) {
    console.warn('[tripMode] persist failed', err);
  }
}

export const useTripModeStore = create<Store>((set, get) => ({
  ...emptyTrip(),
  hydrated: false,

  hydrate: async () => {
    try {
      const info = await FileSystem.getInfoAsync(PATH);
      if (!info.exists) {
        set({ hydrated: true });
        return;
      }
      const raw = JSON.parse(
        await FileSystem.readAsStringAsync(PATH),
      ) as Partial<TripModeState>;
      if (!raw?.active || !raw.startDayKey || !raw.dayCount) {
        set({ ...emptyTrip(), hydrated: true });
        return;
      }
      // Abgelaufene Trips still ablegen
      const today = todayDateKey();
      const end = raw.endDayKey || endKeyFrom(raw.startDayKey, raw.dayCount);
      if (today > end) {
        set({ ...emptyTrip(), hydrated: true });
        void writeDisk(emptyTrip());
        return;
      }
      set({
        active: true,
        cityId: raw.cityId ?? null,
        cityName: raw.cityName ?? null,
        startDayKey: raw.startDayKey,
        endDayKey: end,
        dayCount: Math.max(1, Math.min(14, Number(raw.dayCount) || 1)),
        source: raw.source ?? 'manual',
        activatedAtMs: Number(raw.activatedAtMs) || Date.now(),
        hydrated: true,
      });
    } catch (err) {
      console.warn('[tripMode] hydrate failed', err);
      set({ hydrated: true });
    }
  },

  persist: async () => {
    const {
      active,
      cityId,
      cityName,
      startDayKey,
      endDayKey,
      dayCount,
      source,
      activatedAtMs,
    } = get();
    await writeDisk({
      active,
      cityId,
      cityName,
      startDayKey,
      endDayKey,
      dayCount,
      source,
      activatedAtMs,
    });
  },

  startTrip: (input) => {
    const dayCount = Math.max(1, Math.min(14, input.dayCount));
    const startDayKey = input.startDayKey || todayDateKey();
    const next: TripModeState = {
      active: true,
      cityId: input.cityId?.trim().toLowerCase() || null,
      cityName: input.cityName?.trim() || null,
      startDayKey,
      endDayKey: endKeyFrom(startDayKey, dayCount),
      dayCount,
      source: input.source ?? 'voice',
      activatedAtMs: Date.now(),
    };
    set({ ...next });
    void get().persist();
    return next;
  },

  clearTrip: () => {
    set({ ...emptyTrip() });
    void writeDisk(emptyTrip());
  },

  getTripDayIndex: (dayKey) => {
    const s = get();
    if (!s.active || s.dayCount < 1) return null;
    const key = dayKey ?? todayDateKey();
    if (key < s.startDayKey || key > s.endDayKey) return null;
    const startMs = Date.parse(`${s.startDayKey}T12:00:00`);
    const curMs = Date.parse(`${key}T12:00:00`);
    if (!Number.isFinite(startMs) || !Number.isFinite(curMs)) return null;
    const idx = Math.round((curMs - startMs) / 86_400_000) + 1;
    if (idx < 1 || idx > s.dayCount) return null;
    return idx;
  },

  isTripCity: (cityId, cityName) => {
    const s = get();
    if (!s.active) return false;
    const id = cityId?.trim().toLowerCase();
    if (id && s.cityId && id === s.cityId) return true;
    const name = cityName?.trim().toLowerCase();
    const tripName = s.cityName?.trim().toLowerCase();
    if (name && tripName) {
      return (
        name === tripName ||
        name.includes(tripName) ||
        tripName.includes(name)
      );
    }
    // Kein Stadtfilter gesetzt → Trip gilt ortsunabhängig
    return !s.cityId && !s.cityName;
  },
}));
