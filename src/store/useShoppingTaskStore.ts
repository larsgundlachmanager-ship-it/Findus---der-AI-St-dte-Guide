/**
 * Shopping / Errand tasks — location (+ optional time) reminders.
 * Persist open items until user confirms purchase or deletes.
 */

import { create } from 'zustand';
import * as FileSystem from 'expo-file-system';

export type ShoppingPlaceCategory =
  | 'drugstore'
  | 'supermarket'
  | 'pharmacy'
  | 'convenience_store';

/** store = DM/Rossmann/… · hotel = zurück in der Unterkunft */
export type TaskAnchor = 'store' | 'hotel';

export type ShoppingTaskStatus = 'open' | 'done' | 'snoozed';

export type PromptedPlace = {
  placeId: string;
  name: string;
  atMs: number;
};

export type ShoppingTask = {
  id: string;
  /** Human item / action, e.g. „Zahnbürste“ oder „Powerbank laden“ */
  itemLabel: string;
  /** Where to buy — searched near GPS (empty for hotel tasks) */
  placeTypes: ShoppingPlaceCategory[];
  /** Location trigger: store geofence vs confirmed hotel */
  anchor: TaskAnchor;
  status: ShoppingTaskStatus;
  createdAtMs: number;
  /** Optional soft deadline (time-managed reminders) */
  dueAtMs: number | null;
  /**
   * Simple chain: only become active after this task is `done`
   * (e.g. drugstore after hotel powerbank).
   */
  dependsOnTaskId: string | null;
  promptedPlaces: PromptedPlace[];
  lastPromptAtMs: number;
  snoozeUntilMs: number | null;
};

type ShoppingTaskState = {
  tasks: ShoppingTask[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addTask: (input: {
    itemLabel: string;
    placeTypes?: ShoppingPlaceCategory[];
    anchor?: TaskAnchor;
    dueAtMs?: number | null;
    dependsOnTaskId?: string | null;
  }) => ShoppingTask;
  completeTask: (taskId: string) => void;
  snoozeTask: (taskId: string, ms?: number) => void;
  deleteTask: (taskId: string) => void;
  notePrompted: (
    taskId: string,
    place: { placeId: string; name: string },
  ) => void;
  touchLastPrompt: (taskId: string) => void;
  getOpenTasks: () => ShoppingTask[];
};

const PATH = `${FileSystem.documentDirectory}findus-shopping-tasks.json`;
const MAX_TASKS = 40;

async function persist(tasks: ShoppingTask[]): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      PATH,
      JSON.stringify({ tasks: tasks.slice(-MAX_TASKS) }),
    );
  } catch {
    /* ignore */
  }
}

function uid(): string {
  return `shop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export const useShoppingTaskStore = create<ShoppingTaskState>((set, get) => ({
  tasks: [],
  hydrated: false,

  hydrate: async () => {
    try {
      const info = await FileSystem.getInfoAsync(PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(PATH);
        const parsed = JSON.parse(raw) as { tasks?: ShoppingTask[] };
        const tasks = Array.isArray(parsed.tasks)
          ? parsed.tasks.map((t) => ({
              ...t,
              anchor: t.anchor === 'hotel' ? ('hotel' as const) : ('store' as const),
              placeTypes: Array.isArray(t.placeTypes) ? t.placeTypes : [],
              dependsOnTaskId: t.dependsOnTaskId ?? null,
            }))
          : [];
        set({ tasks, hydrated: true });
        return;
      }
    } catch {
      /* fresh */
    }
    set({ tasks: [], hydrated: true });
  },

  addTask: (input) => {
    const label = input.itemLabel.replace(/\s+/g, ' ').trim();
    const anchor: TaskAnchor = input.anchor === 'hotel' ? 'hotel' : 'store';
    const placeTypes =
      anchor === 'hotel' ? [] : (input.placeTypes ?? ['drugstore', 'supermarket']);
    const dependsOnTaskId = input.dependsOnTaskId ?? null;
    const existing = get().tasks.find(
      (t) =>
        t.status === 'open' &&
        t.itemLabel.toLowerCase() === label.toLowerCase() &&
        (t.anchor ?? 'store') === anchor,
    );
    if (existing) {
      const next = get().tasks.map((t) =>
        t.id === existing.id
          ? {
              ...t,
              placeTypes,
              anchor,
              dueAtMs: input.dueAtMs ?? t.dueAtMs,
              dependsOnTaskId:
                input.dependsOnTaskId !== undefined
                  ? dependsOnTaskId
                  : (t.dependsOnTaskId ?? null),
              snoozeUntilMs: null,
              status: 'open' as const,
            }
          : t,
      );
      set({ tasks: next });
      void persist(next);
      const refreshed = next.find((t) => t.id === existing.id)!;
      return refreshed;
    }
    const task: ShoppingTask = {
      id: uid(),
      itemLabel: label,
      placeTypes,
      anchor,
      status: 'open',
      createdAtMs: Date.now(),
      dueAtMs: input.dueAtMs ?? null,
      dependsOnTaskId,
      promptedPlaces: [],
      lastPromptAtMs: 0,
      snoozeUntilMs: null,
    };
    const next = [...get().tasks, task].slice(-MAX_TASKS);
    set({ tasks: next });
    void persist(next);
    return task;
  },

  completeTask: (taskId) => {
    const next = get().tasks.map((t) =>
      t.id === taskId ? { ...t, status: 'done' as const, snoozeUntilMs: null } : t,
    );
    set({ tasks: next });
    void persist(next);
  },

  snoozeTask: (taskId, ms = 45 * 60_000) => {
    const until = Date.now() + ms;
    const next = get().tasks.map((t) =>
      t.id === taskId
        ? { ...t, status: 'snoozed' as const, snoozeUntilMs: until }
        : t,
    );
    set({ tasks: next });
    void persist(next);
  },

  deleteTask: (taskId) => {
    const next = get().tasks.filter((t) => t.id !== taskId);
    set({ tasks: next });
    void persist(next);
  },

  notePrompted: (taskId, place) => {
    const now = Date.now();
    const next = get().tasks.map((t) => {
      if (t.id !== taskId) return t;
      const promptedPlaces = [
        ...t.promptedPlaces.filter((p) => p.placeId !== place.placeId),
        { placeId: place.placeId, name: place.name, atMs: now },
      ].slice(-8);
      return {
        ...t,
        status: 'open' as const,
        promptedPlaces,
        lastPromptAtMs: now,
        snoozeUntilMs: null,
      };
    });
    set({ tasks: next });
    void persist(next);
  },

  touchLastPrompt: (taskId) => {
    const now = Date.now();
    const next = get().tasks.map((t) =>
      t.id === taskId ? { ...t, lastPromptAtMs: now, status: 'open' as const } : t,
    );
    set({ tasks: next });
    void persist(next);
  },

  getOpenTasks: () => {
    const now = Date.now();
    return get().tasks.filter((t) => {
      if (t.status === 'done') return false;
      if (t.status === 'snoozed' && t.snoozeUntilMs != null && t.snoozeUntilMs > now) {
        return false;
      }
      // Auto-unsnooze
      if (t.status === 'snoozed' && (t.snoozeUntilMs == null || t.snoozeUntilMs <= now)) {
        return true;
      }
      return t.status === 'open';
    });
  },
}));
