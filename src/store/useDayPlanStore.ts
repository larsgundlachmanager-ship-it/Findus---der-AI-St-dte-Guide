/**
 * Modul 5 — Persistenter Tagesplan-Store.
 */

import { create } from 'zustand';
import * as FileSystem from 'expo-file-system';
import {
  type DayPlan,
  type DayPlanChange,
  type DayPlanItem,
  todayDateKey,
  uid,
} from '../types/dayPlan';

type DayPlanState = {
  plansByDate: Record<string, DayPlan>;
  selectedDateKey: string;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setSelectedDate: (dateKey: string) => void;
  ensureDay: (dateKey?: string) => DayPlan;
  getDay: (dateKey?: string) => DayPlan;
  upsertItem: (dateKey: string, item: DayPlanItem) => void;
  removeItem: (dateKey: string, itemId: string) => void;
  replaceItems: (dateKey: string, items: DayPlanItem[]) => void;
  markItemDone: (dateKey: string, itemId: string, atMs?: number) => void;
  markItemActual: (
    dateKey: string,
    itemId: string,
    patch: { actualStartMs?: number; actualEndMs?: number; status?: DayPlanItem['status'] },
  ) => void;
  addChange: (
    dateKey: string,
    change: Omit<DayPlanChange, 'id' | 'atMs'> & { atMs?: number },
  ) => DayPlanChange;
  clearUnreadChanges: (dateKey: string) => void;
  markChangeSpoken: (dateKey: string, changeId: string) => void;
  shiftDay: (deltaDays: number) => void;
  carryOverOpenTodos: (fromKey: string, toKey: string) => number;
};

const PATH = `${FileSystem.documentDirectory}findus-day-plans.json`;
/** Retention: ~18 Monate */
const DAY_PLAN_RETENTION_DAYS = 548;

function prunePlansByDate(
  plans: Record<string, DayPlan>,
): Record<string, DayPlan> {
  const cutoff = Date.now() - DAY_PLAN_RETENTION_DAYS * 24 * 60 * 60_000;
  const next: Record<string, DayPlan> = {};
  for (const [k, day] of Object.entries(plans)) {
    const [y, m, d] = k.split('-').map(Number);
    const ms = new Date(y!, (m ?? 1) - 1, d ?? 1).getTime();
    if (Number.isFinite(ms) && ms >= cutoff) next[k] = day;
  }
  return next;
}

function emptyDay(dateKey: string): DayPlan {
  return {
    dateKey,
    items: [],
    changes: [],
    unreadSignificantChangeIds: [],
    updatedAtMs: Date.now(),
  };
}

async function persist(plansByDate: Record<string, DayPlan>): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      PATH,
      JSON.stringify({ plansByDate, savedAt: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

function sortItems(items: DayPlanItem[]): DayPlanItem[] {
  return [...items].sort((a, b) => {
    const ao = a.sortOrder ?? 0;
    const bo = b.sortOrder ?? 0;
    if (ao !== bo) return ao - bo;
    const as = a.startMs ?? Number.MAX_SAFE_INTEGER;
    const bs = b.startMs ?? Number.MAX_SAFE_INTEGER;
    if (as !== bs) return as - bs;
    return a.title.localeCompare(b.title, 'de');
  });
}

export const useDayPlanStore = create<DayPlanState>((set, get) => ({
  plansByDate: {},
  selectedDateKey: todayDateKey(),
  hydrated: false,

  hydrate: async () => {
    try {
      const info = await FileSystem.getInfoAsync(PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(PATH);
        const parsed = JSON.parse(raw) as {
          plansByDate?: Record<string, DayPlan>;
        };
        if (parsed.plansByDate && typeof parsed.plansByDate === 'object') {
          const plansByDate = prunePlansByDate(parsed.plansByDate);
          set({
            plansByDate,
            selectedDateKey: todayDateKey(),
            hydrated: true,
          });
          if (
            Object.keys(plansByDate).length !==
            Object.keys(parsed.plansByDate).length
          ) {
            void persist(plansByDate);
          }
          return;
        }
      }
    } catch {
      /* soft */
    }
    set({ hydrated: true, selectedDateKey: todayDateKey() });
  },

  setSelectedDate: (dateKey) => set({ selectedDateKey: dateKey }),

  ensureDay: (dateKey) => {
    const key = dateKey ?? get().selectedDateKey;
    const existing = get().plansByDate[key];
    if (existing) return existing;
    const day = emptyDay(key);
    const next = { ...get().plansByDate, [key]: day };
    set({ plansByDate: next });
    void persist(next);
    return day;
  },

  getDay: (dateKey) => {
    const key = dateKey ?? get().selectedDateKey;
    return get().ensureDay(key);
  },

  upsertItem: (dateKey, item) => {
    const day = get().ensureDay(dateKey);
    const idx = day.items.findIndex((i) => i.id === item.id);
    const prev = idx >= 0 ? day.items[idx] : null;
    const createdAtMs =
      (typeof item.meta?.createdAtMs === 'number'
        ? item.meta.createdAtMs
        : null) ??
      (typeof prev?.meta?.createdAtMs === 'number'
        ? prev.meta.createdAtMs
        : null) ??
      Date.now();
    const nextItem: DayPlanItem = {
      ...item,
      meta: {
        ...(item.meta ?? {}),
        createdAtMs,
      },
    };
    const items =
      idx >= 0
        ? day.items.map((i) => (i.id === nextItem.id ? nextItem : i))
        : [...day.items, nextItem];
    const nextDay: DayPlan = {
      ...day,
      items: sortItems(items),
      updatedAtMs: Date.now(),
    };
    const plansByDate = { ...get().plansByDate, [dateKey]: nextDay };
    set({ plansByDate });
    void persist(plansByDate);
  },

  removeItem: (dateKey, itemId) => {
    const day = get().ensureDay(dateKey);
    const nextDay: DayPlan = {
      ...day,
      items: day.items.filter((i) => i.id !== itemId),
      updatedAtMs: Date.now(),
    };
    const plansByDate = { ...get().plansByDate, [dateKey]: nextDay };
    set({ plansByDate });
    void persist(plansByDate);
  },

  replaceItems: (dateKey, items) => {
    const day = get().ensureDay(dateKey);
    const nextDay: DayPlan = {
      ...day,
      items: sortItems(items),
      updatedAtMs: Date.now(),
    };
    const plansByDate = { ...get().plansByDate, [dateKey]: nextDay };
    set({ plansByDate });
    void persist(plansByDate);
  },

  markItemDone: (dateKey, itemId, atMs = Date.now()) => {
    const day = get().ensureDay(dateKey);
    const items = day.items.map((i) =>
      i.id === itemId
        ? {
            ...i,
            status: 'done' as const,
            actualEndMs: atMs,
            actualStartMs: i.actualStartMs ?? i.startMs ?? atMs,
          }
        : i,
    );
    const nextDay: DayPlan = { ...day, items, updatedAtMs: Date.now() };
    const plansByDate = { ...get().plansByDate, [dateKey]: nextDay };
    set({ plansByDate });
    void persist(plansByDate);
  },

  markItemActual: (dateKey, itemId, patch) => {
    const day = get().ensureDay(dateKey);
    const items = day.items.map((i) =>
      i.id === itemId ? { ...i, ...patch } : i,
    );
    const nextDay: DayPlan = {
      ...day,
      items: sortItems(items),
      updatedAtMs: Date.now(),
    };
    const plansByDate = { ...get().plansByDate, [dateKey]: nextDay };
    set({ plansByDate });
    void persist(plansByDate);
  },

  addChange: (dateKey, change) => {
    const day = get().ensureDay(dateKey);
    const full: DayPlanChange = {
      id: uid('chg'),
      atMs: change.atMs ?? Date.now(),
      summary: change.summary,
      reason: change.reason,
      significant: change.significant,
      spoken: change.spoken ?? false,
    };
    const unread = change.significant
      ? [...day.unreadSignificantChangeIds, full.id]
      : day.unreadSignificantChangeIds;
    const nextDay: DayPlan = {
      ...day,
      changes: [full, ...day.changes].slice(0, 40),
      unreadSignificantChangeIds: unread,
      updatedAtMs: Date.now(),
    };
    const plansByDate = { ...get().plansByDate, [dateKey]: nextDay };
    set({ plansByDate });
    void persist(plansByDate);
    return full;
  },

  clearUnreadChanges: (dateKey) => {
    const day = get().ensureDay(dateKey);
    const nextDay: DayPlan = {
      ...day,
      unreadSignificantChangeIds: [],
      updatedAtMs: Date.now(),
    };
    const plansByDate = { ...get().plansByDate, [dateKey]: nextDay };
    set({ plansByDate });
    void persist(plansByDate);
  },

  markChangeSpoken: (dateKey, changeId) => {
    const day = get().ensureDay(dateKey);
    const nextDay: DayPlan = {
      ...day,
      changes: day.changes.map((c) =>
        c.id === changeId ? { ...c, spoken: true } : c,
      ),
      updatedAtMs: Date.now(),
    };
    const plansByDate = { ...get().plansByDate, [dateKey]: nextDay };
    set({ plansByDate });
    void persist(plansByDate);
  },

  shiftDay: (deltaDays) => {
    const cur = get().selectedDateKey;
    const [y, m, d] = cur.split('-').map(Number);
    const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
    dt.setDate(dt.getDate() + deltaDays);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    get().ensureDay(key);
    set({ selectedDateKey: key });
  },

  carryOverOpenTodos: (fromKey, toKey) => {
    const from = get().ensureDay(fromKey);
    const to = get().ensureDay(toKey);
    const open = from.items.filter(
      (i) =>
        (i.kind === 'todo' || i.carryOver) &&
        i.status === 'planned' &&
        !i.hardDeadline,
    );
    if (!open.length) return 0;
    const existingTitles = new Set(to.items.map((i) => i.title.toLowerCase()));
    const moved: DayPlanItem[] = [];
    for (const item of open) {
      if (existingTitles.has(item.title.toLowerCase())) continue;
      moved.push({
        ...item,
        id: uid('todo'),
        startMs: null,
        endMs: null,
        timed: false,
        source: 'carryover',
        status: 'planned',
        notes: (item.notes ? `${item.notes} · ` : '') + `Übertrag von ${fromKey}`,
      });
      get().markItemDone(fromKey, item.id);
    }
    if (moved.length) {
      get().replaceItems(toKey, [...to.items, ...moved]);
      get().addChange(toKey, {
        summary: `${moved.length} offene Punkt(e) vom Vortag übernommen`,
        reason: 'carryover',
        significant: false,
      });
    }
    return moved.length;
  },
}));

export function hasUnreadPlanChanges(dateKey?: string): boolean {
  const key = dateKey ?? useDayPlanStore.getState().selectedDateKey;
  const day = useDayPlanStore.getState().plansByDate[key];
  return Boolean(day?.unreadSignificantChangeIds?.length);
}

export function unreadPlanChangeCount(dateKey?: string): number {
  const key = dateKey ?? useDayPlanStore.getState().selectedDateKey;
  return (
    useDayPlanStore.getState().plansByDate[key]?.unreadSignificantChangeIds
      ?.length ?? 0
  );
}
