/**
 * FuturePlanState — flexibler Zukunftsplan (weiche Puffer).
 * Eigenes Modul-2-Modell, kein Alias auf altes SessionPlan.
 */

import { create } from 'zustand';
import { todayDateKey } from '../../utils/dateKeys';

export type FuturePlanStopStatus =
  | 'planned'
  | 'pending_change'
  | 'conflict'
  | 'trigger_active'
  | 'done';

export type FuturePlanStopKind = 'stop' | 'nav_leg' | 'wish';

export type FuturePlanTransport =
  | 'walk'
  | 'bike'
  | 'transit'
  | 'car'
  | 'taxi'
  | 'flight'
  | 'unknown';

export type FuturePlanStop = {
  id: string;
  title: string;
  lat?: number;
  lng?: number;
  plannedStartMs?: number | null;
  plannedEndMs?: number | null;
  bufferMin: number;
  transport: FuturePlanTransport;
  hardAnchor?: boolean;
  ticketRef?: string | null;
  notes?: string;
  status?: FuturePlanStopStatus;
  kind?: FuturePlanStopKind;
  emoji?: string;
  /** Timeline-Split: linke/rechte Wahl-Karte */
  choiceSide?: 'left' | 'right';
  choiceGroupId?: string;
  mapsUrl?: string | null;
  menuUrl?: string | null;
  /** Nach Confirm: Tisch reservieren (1:1 zum Ort) */
  reserveUrl?: string | null;
  /**
   * Sacred Time: User hat Uhrzeit explizit vorgegeben.
   * false/undefined = Engine-Zeit → auto-verschiebbar (Prio 4–6 Soft).
   */
  userFixedTime?: boolean;
  /** Planungs-Prio 1–6 (Offene Pläne / Trigger-Logik) */
  planPriority?: 1 | 2 | 3 | 4 | 5 | 6 | null;
  /** Manuelle Reihenfolge in „Offene Pläne“ (kleiner = weiter oben) */
  openOrder?: number | null;
  /** Verweis auf PlanTask.id */
  planTaskId?: string | null;
  /**
   * Nav-Leg Entfernung: erst Luftlinie (fallback, UI rot),
   * dann OSRM im Hintergrund (routed, normale Farbe).
   */
  routeEstimate?: 'fallback' | 'routed' | null;
};

export type FuturePlanBase = {
  label: string;
  kind: 'home' | 'hotel' | 'gps' | 'other';
  lat?: number;
  lng?: number;
};

export type FuturePlanState = {
  dayKey: string;
  stops: FuturePlanStop[];
  transportDefault: FuturePlanTransport;
  vibe?: string | null;
  /** Fester Aufenthalts-Anker (Zuhause/Hotel) — oben in der UI, kein Fake-08:00-Stop. */
  base?: FuturePlanBase | null;
  updatedAtMs: number;
};

/**
 * Chronology-Gate: timed Stops strikt früh→spät.
 * Wishes ohne Zeit bleiben am Ende (openOrder separat).
 */
export function sortStopsChronologically(
  stops: FuturePlanStop[],
): FuturePlanStop[] {
  return [...stops].sort((a, b) => {
    const aWish = a.kind === 'wish' && a.plannedStartMs == null;
    const bWish = b.kind === 'wish' && b.plannedStartMs == null;
    if (aWish && bWish) {
      const ao = a.openOrder ?? 999;
      const bo = b.openOrder ?? 999;
      if (ao !== bo) return ao - bo;
      return (a.planPriority ?? 6) - (b.planPriority ?? 6);
    }
    if (aWish) return 1;
    if (bWish) return -1;
    const aT = a.plannedStartMs;
    const bT = b.plannedStartMs;
    if (aT == null && bT == null) return 0;
    if (aT == null) return 1;
    if (bT == null) return -1;
    if (aT !== bT) return aT - bT;
    // Bei gleicher Startzeit: kürzerer Stop zuerst, sonst Titel
    const aEnd = a.plannedEndMs ?? aT;
    const bEnd = b.plannedEndMs ?? bT;
    if (aEnd !== bEnd) return aEnd - bEnd;
    return a.title.localeCompare(b.title, 'de');
  });
}

type Store = {
  /** Aktiver Planungstag */
  plan: FuturePlanState;
  /** Archiv / Multi-Day */
  plansByDay: Record<string, FuturePlanState>;
  setPlan: (plan: FuturePlanState) => void;
  upsertStop: (stop: FuturePlanStop) => void;
  /** Upsert ohne den aktiven Planungstag zu wechseln */
  upsertStopOnDay: (dayKey: string, stop: FuturePlanStop) => void;
  removeStop: (id: string) => void;
  setTransportDefault: (t: FuturePlanTransport) => void;
  /** Basis (Zuhause/Hotel) für den Tag setzen — ohne Fake-Timeline-Stop. */
  setDayBase: (dayKey: string, base: FuturePlanBase | null) => void;
  clearDay: (dayKey: string) => void;
  ensureDay: (dayKey: string) => void;
  getPlanForDay: (dayKey: string) => FuturePlanState;
  hydratePlans: (plans: Record<string, FuturePlanState>) => void;
  setStopStatus: (id: string, status: FuturePlanStopStatus) => void;
};

export function emptyPlan(dayKey?: string): FuturePlanState {
  const d = dayKey ?? todayDateKey();
  return {
    dayKey: d,
    stops: [],
    transportDefault: 'walk',
    vibe: null,
    base: null,
    updatedAtMs: Date.now(),
  };
}

function commitDay(
  plansByDay: Record<string, FuturePlanState>,
  plan: FuturePlanState,
): Record<string, FuturePlanState> {
  return { ...plansByDay, [plan.dayKey]: plan };
}

export const useFuturePlanStore = create<Store>((set, get) => ({
  plan: emptyPlan(),
  plansByDay: {},

  hydratePlans: (plans) => {
    const today = todayDateKey();
    const raw = plans[today] ?? emptyPlan(today);
    const plan = {
      ...raw,
      stops: sortStopsChronologically(raw.stops ?? []),
    };
    const nextByDay: Record<string, FuturePlanState> = {};
    for (const [k, v] of Object.entries(plans)) {
      nextByDay[k] = {
        ...v,
        stops: sortStopsChronologically(v.stops ?? []),
      };
    }
    nextByDay[plan.dayKey] = plan;
    set({
      plansByDay: nextByDay,
      plan,
    });
  },

  getPlanForDay: (dayKey) => {
    const { plan, plansByDay } = get();
    if (plan.dayKey === dayKey) return plan;
    return plansByDay[dayKey] ?? emptyPlan(dayKey);
  },

  ensureDay: (dayKey) => {
    const cur = get().plan;
    if (cur.dayKey === dayKey) return;
    // Aktuellen Tag zuerst sichern, sonst gehen Stops beim Tagwechsel verloren
    const saved = commitDay(get().plansByDay, cur);
    const next = saved[dayKey] ?? emptyPlan(dayKey);
    set({
      plan: next,
      plansByDay: commitDay(saved, next),
    });
  },

  setPlan: (plan) =>
    set((s) => {
      const next = {
        ...plan,
        stops: sortStopsChronologically(plan.stops),
        updatedAtMs: Date.now(),
      };
      return {
        plan: next,
        plansByDay: commitDay(s.plansByDay, next),
      };
    }),

  upsertStop: (stop) => {
    const plan = get().plan;
    const idx = plan.stops.findIndex((s) => s.id === stop.id);
    const withDefaults: FuturePlanStop = {
      kind: 'stop',
      status: 'planned',
      ...stop,
    };
    const stops =
      idx >= 0
        ? plan.stops.map((s, i) => (i === idx ? { ...s, ...withDefaults } : s))
        : [...plan.stops, withDefaults];
    const next = {
      ...plan,
      stops: sortStopsChronologically(stops),
      updatedAtMs: Date.now(),
    };
    set({
      plan: next,
      plansByDay: commitDay(get().plansByDay, next),
    });
  },

  upsertStopOnDay: (dayKey, stop) => {
    const base = get().getPlanForDay(dayKey);
    const withDefaults: FuturePlanStop = {
      kind: 'stop',
      status: 'planned',
      ...stop,
    };
    const idx = base.stops.findIndex((s) => s.id === stop.id);
    const stops =
      idx >= 0
        ? base.stops.map((s, i) =>
            i === idx ? { ...s, ...withDefaults } : s,
          )
        : [...base.stops, withDefaults];
    const next: FuturePlanState = {
      ...base,
      dayKey,
      stops: sortStopsChronologically(stops),
      updatedAtMs: Date.now(),
    };
    const cur = get().plan;
    if (cur.dayKey === dayKey) {
      set({ plan: next, plansByDay: commitDay(get().plansByDay, next) });
    } else {
      set({ plansByDay: commitDay(get().plansByDay, next) });
    }
  },

  removeStop: (id) => {
    const plan = get().plan;
    const next = {
      ...plan,
      stops: sortStopsChronologically(plan.stops.filter((s) => s.id !== id)),
      updatedAtMs: Date.now(),
    };
    set({
      plan: next,
      plansByDay: commitDay(get().plansByDay, next),
    });
  },

  setStopStatus: (id, status) => {
    const plan = get().plan;
    const next = {
      ...plan,
      stops: plan.stops.map((s) => (s.id === id ? { ...s, status } : s)),
      updatedAtMs: Date.now(),
    };
    set({
      plan: next,
      plansByDay: commitDay(get().plansByDay, next),
    });
  },

  setTransportDefault: (transportDefault) => {
    const plan = get().plan;
    const next = {
      ...plan,
      transportDefault,
      stops: plan.stops.map((s) =>
        s.kind === 'nav_leg'
          ? { ...s, transport: transportDefault, status: 'pending_change' as const }
          : {
              ...s,
              transport: transportDefault,
              status: 'pending_change' as const,
            },
      ),
      updatedAtMs: Date.now(),
    };
    set({
      plan: next,
      plansByDay: commitDay(get().plansByDay, next),
    });
  },

  setDayBase: (dayKey, base) => {
    const cur = get().plan;
    const existing =
      cur.dayKey === dayKey
        ? cur
        : (get().plansByDay[dayKey] ?? emptyPlan(dayKey));
    const next: FuturePlanState = {
      ...existing,
      dayKey,
      base,
      updatedAtMs: Date.now(),
    };
    if (cur.dayKey === dayKey) {
      set({ plan: next, plansByDay: commitDay(get().plansByDay, next) });
    } else {
      set({ plansByDay: commitDay(get().plansByDay, next) });
    }
  },

  clearDay: (dayKey) => {
    const next = emptyPlan(dayKey);
    set((s) => ({
      plan: s.plan.dayKey === dayKey ? next : s.plan,
      plansByDay: { ...s.plansByDay, [dayKey]: next },
    }));
  },
}));

export function readFuturePlanSnapshot(): FuturePlanState {
  return useFuturePlanStore.getState().plan;
}
