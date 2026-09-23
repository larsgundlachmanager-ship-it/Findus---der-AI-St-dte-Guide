/**
 * Packlisten — persistente Checkliste (abhaken) + Deep-Link.
 * Kein Fake: Items nur aus Wetter / Trip-Signals / User-Text.
 */

import { create } from 'zustand';
import * as FileSystem from 'expo-file-system';
import type { PackPersonRef, PackTraveler } from '../module2/timeline/packListPersons';

export type PackListItem = {
  id: string;
  label: string;
  /** Warum vorgeschlagen (belegt) — UI-Hinweis, kein Speech-Skript */
  reason: string;
  done: boolean;
  /** Stückzahl wenn dynamisch berechnet (z. B. T-Shirts nach Tagen) */
  qty?: number | null;
  /** User-Prio aus dem Live-Durchgang */
  priority?: 'high' | 'normal' | null;
  /** „mach ich später“ — bleibt offen, aber hinten */
  later?: boolean;
  /** Person-Reiter; null = gemeinsam */
  personId?: string | null;
  category:
    | 'docs'
    | 'swim'
    | 'sun'
    | 'cold'
    | 'rain'
    | 'formal'
    | 'hygiene'
    | 'tech'
    | 'clothes'
    | 'activity'
    | 'kids'
    | 'meds'
    | 'misc';
};

export type PackList = {
  id: string;
  title: string;
  createdAtMs: number;
  destHint: string | null;
  weatherNote: string | null;
  items: PackListItem[];
  /** Live-Durchgang läuft */
  walkActive?: boolean;
  walkCursor?: number | null;
  /** Waschmaschine: Research / User-Reiter */
  laundryAccess?: 'yes' | 'no' | 'unknown' | null;
  tripDays?: number | null;
  climate?: {
    warm?: boolean;
    cool?: boolean;
    active?: boolean;
  } | null;
  /** Personen dieser Liste (Reiter) */
  persons?: PackPersonRef[] | null;
};

type PackListState = {
  lists: PackList[];
  /** Gespeicherte Reisende (Alter bleibt über Trips) */
  travelers: PackTraveler[];
  activeListId: string | null;
  overlayVisible: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  upsertList: (list: PackList) => void;
  upsertTravelers: (people: PackTraveler[]) => void;
  removeTraveler: (id: string) => void;
  toggleItem: (listId: string, itemId: string) => void;
  addItems: (listId: string, items: PackListItem[]) => void;
  removeMatching: (listId: string, query: string) => string[];
  setItemDone: (listId: string, query: string, done: boolean) => string | null;
  deleteList: (listId: string) => void;
  patchItem: (
    listId: string,
    itemId: string,
    patch: Partial<Pick<PackListItem, 'done' | 'qty' | 'priority' | 'later' | 'label'>>,
  ) => void;
  setWalk: (listId: string, active: boolean, cursor?: number | null) => void;
  isWalkActive: () => boolean;
  setLaundryAccess: (
    listId: string,
    laundry: 'yes' | 'no',
  ) => PackList | null;
  openOverlay: (listId?: string | null) => void;
  closeOverlay: () => void;
  getList: (id: string) => PackList | null;
  getActiveList: () => PackList | null;
};

const PATH = `${FileSystem.documentDirectory}findus-pack-lists.json`;
const MAX_LISTS = 12;

async function persist(lists: PackList[], travelers: PackTraveler[]): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      PATH,
      JSON.stringify({
        lists: lists.slice(-MAX_LISTS),
        travelers: travelers.slice(-24),
      }),
    );
  } catch {
    /* soft */
  }
}

function mergeTravelers(
  prev: PackTraveler[],
  next: PackTraveler[],
): PackTraveler[] {
  const out = [...prev];
  for (const p of next) {
    const idx = out.findIndex(
      (e) =>
        e.id === p.id ||
        (e.name.toLowerCase() === p.name.toLowerCase() && e.role === p.role),
    );
    if (idx >= 0) {
      const old = out[idx]!;
      out[idx] = {
        ...old,
        ...p,
        id: old.id,
        ageYears: p.ageYears ?? old.ageYears,
        ageAsOfMs:
          p.ageYears != null ? (p.ageAsOfMs ?? Date.now()) : old.ageAsOfMs,
        birthMonth: p.birthMonth ?? old.birthMonth ?? null,
        birthYear: p.birthYear ?? old.birthYear ?? null,
        updatedAtMs: Date.now(),
      };
    } else {
      out.push(p);
    }
  }
  return out.slice(-24);
}

export const usePackListStore = create<PackListState>((set, get) => ({
  lists: [],
  travelers: [],
  activeListId: null,
  overlayVisible: false,
  hydrated: false,

  hydrate: async () => {
    try {
      const info = await FileSystem.getInfoAsync(PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(PATH);
        const parsed = JSON.parse(raw) as {
          lists?: PackList[];
          travelers?: PackTraveler[];
        };
        const lists = Array.isArray(parsed.lists) ? parsed.lists : [];
        const travelers = Array.isArray(parsed.travelers)
          ? parsed.travelers
          : [];
        set({ lists, travelers, hydrated: true });
        return;
      }
    } catch {
      /* fresh */
    }
    set({ lists: [], travelers: [], hydrated: true });
  },

  upsertList: (list) => {
    set((s) => {
      const rest = s.lists.filter((l) => l.id !== list.id);
      const lists = [...rest, list].slice(-MAX_LISTS);
      void persist(lists, s.travelers);
      return { lists, activeListId: list.id };
    });
  },

  upsertTravelers: (people) => {
    if (!people.length) return;
    set((s) => {
      const travelers = mergeTravelers(s.travelers, people);
      void persist(s.lists, travelers);
      return { travelers };
    });
  },

  removeTraveler: (id) => {
    set((s) => {
      const travelers = s.travelers.filter((t) => t.id !== id);
      void persist(s.lists, travelers);
      return { travelers };
    });
  },

  addItems: (listId, items) => {
    if (!items.length) return;
    set((s) => {
      const lists = s.lists.map((l) => {
        if (l.id !== listId) return l;
        const seen = new Set(l.items.map((it) => it.label.toLowerCase()));
        const extra = items.filter((it) => !seen.has(it.label.toLowerCase()));
        return { ...l, items: [...l.items, ...extra] };
      });
      void persist(lists, s.travelers);
      return { lists };
    });
  },

  removeMatching: (listId, query) => {
    const q = query.toLowerCase().trim();
    const removed: string[] = [];
    set((s) => {
      const lists = s.lists.map((l) => {
        if (l.id !== listId) return l;
        const keep = l.items.filter((it) => {
          const bare = it.label.toLowerCase().replace(/^\d+×\s*/u, '');
          const hit = Boolean(q) && (it.label.toLowerCase().includes(q) || bare.includes(q) || q.includes(bare));
          if (hit) removed.push(it.label);
          return !hit;
        });
        return { ...l, items: keep };
      });
      void persist(lists, s.travelers);
      return { lists };
    });
    return removed;
  },

  setItemDone: (listId, query, done) => {
    const q = query.toLowerCase().trim();
    let hitLabel: string | null = null;
    set((s) => {
      const lists = s.lists.map((l) => {
        if (l.id !== listId) return l;
        return {
          ...l,
          items: l.items.map((it) => {
            const bare = it.label.toLowerCase().replace(/^\d+×\s*/u, '');
            const match = Boolean(q) && (it.label.toLowerCase().includes(q) || bare.includes(q));
            if (match && !hitLabel) {
              hitLabel = it.label;
              return { ...it, done };
            }
            return it;
          }),
        };
      });
      void persist(lists, s.travelers);
      return { lists };
    });
    return hitLabel;
  },

  deleteList: (listId) => {
    set((s) => {
      const lists = s.lists.filter((l) => l.id !== listId);
      void persist(lists, s.travelers);
      const activeListId =
        s.activeListId === listId ? (lists.at(-1)?.id ?? null) : s.activeListId;
      return { lists, activeListId };
    });
  },

  patchItem: (listId, itemId, patch) => {
    set((s) => {
      const lists = s.lists.map((l) => {
        if (l.id !== listId) return l;
        return {
          ...l,
          items: l.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
        };
      });
      void persist(lists, s.travelers);
      return { lists };
    });
  },

  setWalk: (listId, active, cursor) => {
    set((s) => {
      const lists = s.lists.map((l) =>
        l.id === listId
          ? {
              ...l,
              walkActive: active,
              walkCursor: cursor ?? l.walkCursor ?? 0,
            }
          : active
            ? { ...l, walkActive: false }
            : l,
      );
      void persist(lists, s.travelers);
      return { lists, activeListId: listId };
    });
  },

  isWalkActive: () => get().lists.some((l) => l.walkActive === true),

  setLaundryAccess: (listId, laundry) => {
    let next: PackList | null = null;
    set((s) => {
      const lists = s.lists.map((l) => {
        if (l.id !== listId) return l;
        const days = l.tripDays != null && l.tripDays > 0 ? l.tripDays : 3;
        try {
          const { reapplyLaundryQuantities } = require('../module2/timeline/packListBuilder') as {
            reapplyLaundryQuantities: (
              items: PackListItem[],
              opts: {
                tripDays: number;
                laundry: boolean;
                warm?: boolean;
                cool?: boolean;
                active?: boolean;
              },
            ) => PackListItem[];
          };
          const items = reapplyLaundryQuantities(l.items, {
            tripDays: days,
            laundry: laundry === 'yes',
            warm: l.climate?.warm,
            cool: l.climate?.cool,
            active: l.climate?.active,
          });
          next = { ...l, laundryAccess: laundry, items };
          return next;
        } catch {
          next = { ...l, laundryAccess: laundry };
          return next;
        }
      });
      void persist(lists, s.travelers);
      return { lists };
    });
    return next;
  },

  toggleItem: (listId, itemId) => {
    set((s) => {
      const lists = s.lists.map((l) => {
        if (l.id !== listId) return l;
        return {
          ...l,
          items: l.items.map((it) =>
            it.id === itemId ? { ...it, done: !it.done } : it,
          ),
        };
      });
      void persist(lists, s.travelers);
      return { lists };
    });
  },

  openOverlay: (listId) => {
    const id = listId || get().activeListId || get().lists[get().lists.length - 1]?.id || null;
    set({ overlayVisible: true, activeListId: id });
  },

  closeOverlay: () => set({ overlayVisible: false }),

  getList: (id) => get().lists.find((l) => l.id === id) || null,

  getActiveList: () => {
    const id = get().activeListId;
    if (!id) return get().lists[get().lists.length - 1] || null;
    return get().lists.find((l) => l.id === id) || null;
  },
}));

export function packListDeepLink(listId: string): string {
  return `yorro://packlist?id=${encodeURIComponent(listId)}`;
}

export function packListDeepLinkFindus(listId: string): string {
  return `findus://packlist?id=${encodeURIComponent(listId)}`;
}
