/**
 * Reservierungs-Status im Memory (Stage A/B) — keine Fake-Bestätigungen.
 */

import { create } from 'zustand';
import * as FileSystem from 'expo-file-system';
import type { ReservationTier } from '../types/reservation';

export type ReservationMemoryStatus =
  | 'opened'
  | 'emailed'
  | 'dialed'
  | 'pending'
  | 'confirmed'
  | 'failed';

export type ReservationMemory = {
  id: string;
  poiName: string;
  poiId?: number | null;
  cityId?: string | null;
  dayKey?: string | null;
  partySize?: number | null;
  timeLabel?: string | null;
  dateIso?: string | null;
  tier?: ReservationTier | null;
  status: ReservationMemoryStatus;
  openUrl?: string | null;
  note?: string | null;
  updatedAtMs: number;
};

type Store = {
  items: ReservationMemory[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  persist: () => Promise<void>;
  record: (
    partial: Omit<ReservationMemory, 'id' | 'updatedAtMs'> & {
      id?: string;
    },
  ) => ReservationMemory;
  markConfirmed: (id: string) => void;
  listOpen: () => ReservationMemory[];
  clearAll: () => void;
};

const PATH = `${FileSystem.documentDirectory}findus-reservation-memory.json`;

function newId(): string {
  return `rsv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

async function writeDisk(items: ReservationMemory[]): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      PATH,
      JSON.stringify({ items: items.slice(-40) }, null, 2),
      { encoding: FileSystem.EncodingType.UTF8 },
    );
  } catch (err) {
    console.warn('[reservationMemory] persist failed', err);
  }
}

export const useReservationMemoryStore = create<Store>((set, get) => ({
  items: [],
  hydrated: false,

  hydrate: async () => {
    try {
      const info = await FileSystem.getInfoAsync(PATH);
      if (!info.exists) {
        set({ hydrated: true });
        return;
      }
      const raw = JSON.parse(await FileSystem.readAsStringAsync(PATH)) as {
        items?: ReservationMemory[];
      };
      set({
        items: Array.isArray(raw.items) ? raw.items : [],
        hydrated: true,
      });
    } catch (err) {
      console.warn('[reservationMemory] hydrate failed', err);
      set({ hydrated: true });
    }
  },

  persist: async () => {
    await writeDisk(get().items);
  },

  record: (partial) => {
    const id = partial.id ?? newId();
    const next: ReservationMemory = {
      id,
      poiName: partial.poiName.trim(),
      poiId: partial.poiId ?? null,
      cityId: partial.cityId ?? null,
      dayKey: partial.dayKey ?? null,
      partySize: partial.partySize ?? null,
      timeLabel: partial.timeLabel ?? null,
      dateIso: partial.dateIso ?? null,
      tier: partial.tier ?? null,
      status: partial.status,
      openUrl: partial.openUrl ?? null,
      note: partial.note ?? null,
      updatedAtMs: Date.now(),
    };
    set((s) => {
      const without = s.items.filter(
        (x) =>
          !(
            x.poiName.toLowerCase() === next.poiName.toLowerCase() &&
            (x.dateIso ?? '') === (next.dateIso ?? '') &&
            (x.timeLabel ?? '') === (next.timeLabel ?? '')
          ),
      );
      return { items: [...without, next].slice(-40) };
    });
    void get().persist();
    return next;
  },

  markConfirmed: (id) => {
    set((s) => ({
      items: s.items.map((x) =>
        x.id === id
          ? { ...x, status: 'confirmed' as const, updatedAtMs: Date.now() }
          : x,
      ),
    }));
    void get().persist();
  },

  listOpen: () =>
    get().items.filter((x) =>
      ['opened', 'emailed', 'dialed', 'pending'].includes(x.status),
    ),

  clearAll: () => {
    set({ items: [] });
    void writeDisk([]);
  },
}));

/** Kurze Zeilen für Morgen-Briefing / Context. */
export function formatOpenReservationsHint(): string | null {
  const open = useReservationMemoryStore.getState().listOpen().slice(0, 3);
  if (!open.length) return null;
  return open
    .map((r) => {
      const when = [r.dateIso, r.timeLabel].filter(Boolean).join(' ');
      const st =
        r.status === 'opened'
          ? 'Buchungsseite geöffnet'
          : r.status === 'emailed'
            ? 'Mail-Anfrage'
            : r.status === 'dialed'
              ? 'Anruf'
              : 'offen';
      return `${r.poiName}${when ? ` (${when})` : ''} — ${st}`;
    })
    .join('; ');
}
