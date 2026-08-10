/**
 * Active multi-intent session plan (persisted lightly in memory + disk).
 */

import { create } from 'zustand';
import * as FileSystem from 'expo-file-system';
import type { SessionPlan, SessionPlanStop } from '../runtime/sessionPlanTypes';

type SessionPlanState = {
  plan: SessionPlan | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setPlan: (plan: SessionPlan | null) => void;
  markStopDone: (stopId: string) => void;
  markDeadlineFired: () => void;
  clearPlan: () => void;
  /** Speichert aktuelle Tour für später (nicht sofort steuern). */
  saveForLater: (activateAtMs?: number | null) => void;
  activateSavedPlan: () => void;
  getBoostPlaceTypes: () => string[];
  getActivePlan: () => SessionPlan | null;
};

const PATH = `${FileSystem.documentDirectory}findus-session-plan.json`;

async function persist(plan: SessionPlan | null): Promise<void> {
  try {
    if (!plan) {
      const info = await FileSystem.getInfoAsync(PATH);
      if (info.exists) await FileSystem.deleteAsync(PATH, { idempotent: true });
      return;
    }
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(plan));
  } catch {
    /* ignore */
  }
}

export const useSessionPlanStore = create<SessionPlanState>((set, get) => ({
  plan: null,
  hydrated: false,

  hydrate: async () => {
    try {
      const info = await FileSystem.getInfoAsync(PATH);
      if (!info.exists) {
        set({ hydrated: true, plan: null });
        return;
      }
      const raw = await FileSystem.readAsStringAsync(PATH);
      const parsed = JSON.parse(raw) as SessionPlan;
      if (parsed?.id && (parsed.active || parsed.savedForLater)) {
        set({ plan: parsed, hydrated: true });
      } else {
        set({ plan: null, hydrated: true });
      }
    } catch {
      set({ plan: null, hydrated: true });
    }
  },

  setPlan: (plan) => {
    set({ plan });
    void persist(plan);
  },

  markStopDone: (stopId) => {
    const cur = get().plan;
    if (!cur) return;
    const stops: SessionPlanStop[] = cur.stops.map((s) =>
      s.id === stopId ? { ...s, done: true } : s,
    );
    const next = { ...cur, stops };
    set({ plan: next });
    void persist(next);
  },

  markDeadlineFired: () => {
    const cur = get().plan;
    if (!cur) return;
    const next = { ...cur, deadlineFired: true, freeRoam: false };
    set({ plan: next });
    void persist(next);
  },

  clearPlan: () => {
    set({ plan: null });
    void persist(null);
  },

  /** Speichert aktuelle Tour für später (nicht sofort steuern). */
  saveForLater: (activateAtMs?: number | null) => {
    const cur = get().plan;
    if (!cur) return;
    const next: SessionPlan = {
      ...cur,
      savedForLater: true,
      active: false,
      activateAtMs: activateAtMs ?? null,
    };
    set({ plan: next });
    void persist(next);
  },

  /** Reaktiviert einen gespeicherten Tour-Plan. */
  activateSavedPlan: () => {
    const cur = get().plan;
    if (!cur?.savedForLater) return;
    const next: SessionPlan = {
      ...cur,
      savedForLater: false,
      active: true,
      activateAtMs: null,
    };
    set({ plan: next });
    void persist(next);
  },

  getBoostPlaceTypes: () => {
    const p = get().plan;
    if (!p?.active || !p.freeRoam) return [];
    return p.boostPlaceTypes;
  },

  getActivePlan: () => {
    const p = get().plan;
    if (!p?.active) return null;
    return p;
  },
}));
