/**
 * Modul 5 — Session-SSOT (Lage, Confirm, Conflict-Ask, Selection).
 */

import { create } from 'zustand';
import type { IngestOpenWish, IngestedPlan, PlanTask } from './planningTypes';
import { foldCityKey } from '../../services/navigation/landmarkAliases';
import { sameFoldedCity } from './planDestinationCity';

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

export type PlanConfirmKind = 'pack_switch' | 'generic';

type Store = {
  active: boolean;
  /** Harte Stadt-Partition (foldCityKey) — bei Stadtwechsel parken/reset */
  cityKey: string | null;
  cityHint: string | null;
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
  /** Warum waitingConfirm — Pack-Wechsel darf die Session nicht killen. */
  confirmKind: PlanConfirmKind | null;
  confirmResolver: ConfirmResolver | null;
  locationResolver: LocationResolver | null;
  conflictResolver: ConfirmResolver | null;
  setActive: (v: boolean) => void;
  setCityScope: (opts: {
    cityKey?: string | null;
    cityHint?: string | null;
  }) => void;
  setPhase: (p: PlanSessionPhase) => void;
  setPlan: (plan: IngestedPlan | null) => void;
  setTaskQueue: (tasks: PlanTask[]) => void;
  setOverrideWish: (wish: IngestOpenWish | null) => void;
  clearOverride: () => void;
  setPendingAmendment: (text: string | null) => void;
  takePendingAmendment: () => string | null;
  beginWaitConfirm: (
    timeoutMs?: number,
    timeoutOk?: boolean,
    kind?: PlanConfirmKind,
  ) => Promise<boolean>;
  resolveConfirm: (ok: boolean) => void;
  beginWaitLocation: (timeoutMs?: number) => Promise<string>;
  resolveLocation: (text: string) => void;
  beginWaitConflict: (timeoutMs?: number) => Promise<boolean>;
  resolveConflict: (ok: boolean) => void;
  reset: () => void;
};

export const usePlanSessionStore = create<Store>((set, get) => ({
  active: false,
  cityKey: null,
  cityHint: null,
  phase: 'idle',
  plan: null,
  taskQueue: [],
  overrideWish: null,
  pendingAmendment: null,
  waitingConfirm: false,
  waitingLocation: false,
  waitingConflict: false,
  confirmKind: null,
  confirmResolver: null,
  locationResolver: null,
  conflictResolver: null,
  setActive: (active) => set({ active }),
  setCityScope: (opts) => {
    const hint = opts.cityHint?.trim() || null;
    const keyRaw = opts.cityKey?.trim() || hint;
    const cityKey = keyRaw ? foldCityKey(keyRaw) || null : null;
    set({
      cityKey: cityKey || null,
      cityHint: hint || (cityKey ? opts.cityKey?.trim() || null : null),
    });
  },
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
  beginWaitConfirm: (timeoutMs = 180_000, timeoutOk = false, kind = 'generic') =>
    new Promise<boolean>((resolve) => {
      set({
        waitingConfirm: true,
        confirmKind: kind,
        phase: 'await_confirm',
        confirmResolver: resolve,
      });
      if (timeoutMs > 0) {
        setTimeout(() => {
          const s = get();
          if (!s.waitingConfirm) return;
          s.resolveConfirm(timeoutOk);
        }, timeoutMs);
      }
      try {
        const { onPlanDirectAsk } = require('./planDirectAsk') as {
          onPlanDirectAsk: () => void;
        };
        onPlanDirectAsk();
      } catch {
        /* soft */
      }
    }),
  resolveConfirm: (ok) => {
    const r = get().confirmResolver;
    set({
      waitingConfirm: false,
      confirmKind: null,
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
      try {
        const { onPlanDirectAsk } = require('./planDirectAsk') as {
          onPlanDirectAsk: () => void;
        };
        onPlanDirectAsk();
      } catch {
        /* soft */
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
      try {
        const { onPlanDirectAsk } = require('./planDirectAsk') as {
          onPlanDirectAsk: () => void;
        };
        onPlanDirectAsk();
      } catch {
        /* soft */
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
      cityKey: null,
      cityHint: null,
      phase: 'idle',
      plan: null,
      taskQueue: [],
      overrideWish: null,
      pendingAmendment: null,
      waitingConfirm: false,
      waitingLocation: false,
      waitingConflict: false,
      confirmKind: null,
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

/** Session wartet auf User (Ja/Nein, Ort, Konflikt) — nächste Äußerung = Gate. */
export function isPlanAwaitingUserReply(): boolean {
  const s = usePlanSessionStore.getState();
  return Boolean(s.waitingConfirm || s.waitingLocation || s.waitingConflict);
}

/** Neues Thema (z. B. Flug) — offene Ja/Ort-Schleife des totigen Plans lösen, Timeline behalten. */
export function releasePlanWaitForForeignTopic(): void {
  const s = usePlanSessionStore.getState();
  if (s.waitingConfirm) s.resolveConfirm(false);
  if (s.waitingLocation) s.resolveLocation('');
  if (s.waitingConflict) s.resolveConflict(false);
}

/** Taggt die aktive M5-Session mit Stadt (bei Start / Resume). */
export function tagPlanSessionCity(opts: {
  cityKey?: string | null;
  cityHint?: string | null;
}): void {
  usePlanSessionStore.getState().setCityScope(opts);
}

function planWantsCity(nextName: string, s: Store): boolean {
  if (sameFoldedCity(s.cityKey, nextName) || sameFoldedCity(s.cityHint, nextName)) {
    return true;
  }
  return sameFoldedCity(s.plan?.destinationCity, nextName);
}

/**
 * Pack/GPS-Stadtwechsel.
 * Zielstadt des laufenden Plans (oder Pack-Switch-Wait) → Session behalten
 * und weiterrecherchieren. Fremde Stadt → hart reset.
 */
export function parkPlanSessionOnCitySwitch(nextCityName: string): void {
  const nextKey = foldCityKey(nextCityName);
  if (!nextKey) return;
  const s = usePlanSessionStore.getState();
  if (!s.active && !s.plan) return;
  if (planWantsCity(nextCityName, s)) {
    s.setCityScope({
      cityKey: nextKey,
      cityHint: nextCityName.trim().slice(0, 48),
    });
    if (s.waitingConfirm && s.confirmKind === 'pack_switch') {
      s.resolveConfirm(true);
    }
    return;
  }
  s.reset();
}
