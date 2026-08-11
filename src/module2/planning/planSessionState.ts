/**
 * Modul 5 — Session-SSOT (Lage, Confirm, Conflict-Ask, Selection).
 */

import { create } from 'zustand';
import type { IngestOpenWish, IngestedPlan, PlanTask } from './planningTypes';

type ConfirmResolver = (ok: boolean) => void;
type LocationResolver = (text: string) => void;

export type PlanSessionPhase =
  | 'idle'
  | 'lage'
  | 'list_build'
  | 'clarify_location'
  | 'await_confirm'
  | 'await_conflict'
  | 'select_mode'
  | 'step_loop'
  | 'final';

type Store = {
  active: boolean;
  phase: PlanSessionPhase;
  plan: IngestedPlan | null;
  taskQueue: PlanTask[];
  /** Manueller Override: User tippt offenen Plan */
  overrideWish: IngestOpenWish | null;
  /** Text-Änderung während Confirm / Step */
  pendingAmendment: string | null;
  waitingConfirm: boolean;
  waitingLocation: boolean;
  waitingConflict: boolean;
  confirmResolver: ConfirmResolver | null;
  locationResolver: LocationResolver | null;
  conflictResolver: ConfirmResolver | null;
  setActive: (v: boolean) => void;
  setPhase: (p: PlanSessionPhase) => void;
  setPlan: (plan: IngestedPlan | null) => void;
  setTaskQueue: (tasks: PlanTask[]) => void;
  setOverrideWish: (wish: IngestOpenWish | null) => void;
  clearOverride: () => void;
  setPendingAmendment: (text: string | null) => void;
  takePendingAmendment: () => string | null;
  beginWaitConfirm: (timeoutMs?: number) => Promise<boolean>;
  resolveConfirm: (ok: boolean) => void;
  beginWaitLocation: (timeoutMs?: number) => Promise<string>;
  resolveLocation: (text: string) => void;
  beginWaitConflict: (timeoutMs?: number) => Promise<boolean>;
  resolveConflict: (ok: boolean) => void;
  reset: () => void;
};

export const usePlanSessionStore = create<Store>((set, get) => ({
  active: false,
  phase: 'idle',
  plan: null,
  taskQueue: [],
  overrideWish: null,
  pendingAmendment: null,
  waitingConfirm: false,
  waitingLocation: false,
  waitingConflict: false,
  confirmResolver: null,
  locationResolver: null,
  conflictResolver: null,
  setActive: (active) => set({ active }),
  setPhase: (phase) => set({ phase }),
  setPlan: (plan) => set({ plan }),
  setTaskQueue: (taskQueue) => set({ taskQueue }),
  setOverrideWish: (overrideWish) => set({ overrideWish }),
  clearOverride: () => set({ overrideWish: null }),
  setPendingAmendment: (pendingAmendment) => set({ pendingAmendment }),
  takePendingAmendment: () => {
    const t = get().pendingAmendment;
    set({ pendingAmendment: null });
    return t;
  },
  beginWaitConfirm: (timeoutMs = 180_000) =>
    new Promise<boolean>((resolve) => {
      set({
        waitingConfirm: true,
        phase: 'await_confirm',
        confirmResolver: resolve,
      });
      if (timeoutMs > 0) {
        setTimeout(() => {
          const s = get();
          if (!s.waitingConfirm) return;
          s.resolveConfirm(true);
        }, timeoutMs);
      }
    }),
  resolveConfirm: (ok) => {
    const r = get().confirmResolver;
    set({
      waitingConfirm: false,
      confirmResolver: null,
    });
    r?.(ok);
  },
  beginWaitLocation: (timeoutMs = 120_000) =>
    new Promise<string>((resolve) => {
      set({
        waitingLocation: true,
        phase: 'clarify_location',
        locationResolver: resolve,
      });
      if (timeoutMs > 0) {
        setTimeout(() => {
          const s = get();
          if (!s.waitingLocation) return;
          s.resolveLocation('');
        }, timeoutMs);
      }
    }),
  resolveLocation: (text) => {
    const r = get().locationResolver;
    set({
      waitingLocation: false,
      locationResolver: null,
    });
    r?.(text);
  },
  beginWaitConflict: (timeoutMs = 120_000) =>
    new Promise<boolean>((resolve) => {
      set({
        waitingConflict: true,
        phase: 'await_conflict',
        conflictResolver: resolve,
      });
      if (timeoutMs > 0) {
        setTimeout(() => {
          const s = get();
          if (!s.waitingConflict) return;
          // Timeout = nicht löschen (sicherer Default)
          s.resolveConflict(false);
        }, timeoutMs);
      }
    }),
  resolveConflict: (ok) => {
    const r = get().conflictResolver;
    set({
      waitingConflict: false,
      conflictResolver: null,
    });
    r?.(ok);
  },
  reset: () => {
    const s = get();
    const confirm = s.confirmResolver;
    const loc = s.locationResolver;
    const conflict = s.conflictResolver;
    set({
      active: false,
      phase: 'idle',
      plan: null,
      taskQueue: [],
      overrideWish: null,
      pendingAmendment: null,
      waitingConfirm: false,
      waitingLocation: false,
      waitingConflict: false,
      confirmResolver: null,
      locationResolver: null,
      conflictResolver: null,
    });
    // Wartende Schleifen freigeben (User-Cancel)
    try {
      confirm?.(false);
    } catch {
      /* soft */
    }
    try {
      loc?.('');
    } catch {
      /* soft */
    }
    try {
      conflict?.(false);
    } catch {
      /* soft */
    }
  },
}));

export function getActiveTaskOverride(): IngestOpenWish | null {
  return usePlanSessionStore.getState().overrideWish;
}

export function setActiveTaskOverride(wish: IngestOpenWish | null): void {
  usePlanSessionStore.getState().setOverrideWish(wish);
}

/** Laufende Planung — Kalender allein reicht nicht. */
export function isPlanningModuleActive(): boolean {
  const s = usePlanSessionStore.getState();
  if (!s.active) return false;
  return (
    s.phase === 'lage' ||
    s.phase === 'list_build' ||
    s.phase === 'await_confirm' ||
    s.phase === 'await_conflict' ||
    s.phase === 'select_mode' ||
    s.phase === 'step_loop' ||
    s.phase === 'clarify_location' ||
    s.phase === 'final'
  );
}
