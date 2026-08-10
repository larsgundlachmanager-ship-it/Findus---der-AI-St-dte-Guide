/**
 * Persistierte Logistik-Events + geplante Push-/Zeit-Trigger.
 * Settings → Interne Einstellungen liest denselben Store.
 */

import { create } from 'zustand';
import * as FileSystem from 'expo-file-system';
import type {
  LogisticsCheckKind,
  LogisticsMode,
  StationScale,
} from '../services/logistics/logisticsTriggerMath';
import {
  buildCheckSchedule,
  computeLeavePlan,
  describeLeavePlan,
  formatClockMs,
  nextPollIntervalMs,
  type CheckScheduleProfile,
} from '../services/logistics/logisticsTriggerMath';

export type LogisticsEventKind =
  | 'flight'
  | 'train'
  | 'bus'
  | 'todo'
  | 'reminder'
  | 'alarm'
  | 'geo'
  | 'session';

export type LogisticsEventStatus = 'active' | 'done' | 'cancelled';

export type LogisticsEvent = {
  id: string;
  kind: LogisticsEventKind;
  title: string;
  detail?: string;
  /** Planned absolute time (departure / due / wake) */
  atMs: number | null;
  lat?: number | null;
  lng?: number | null;
  status: LogisticsEventStatus;
  createdAtMs: number;
  updatedAtMs: number;
  /** Optional link to external id (flight code, shopping task, …) */
  externalId?: string | null;
  meta?: Record<string, string | number | boolean | null>;
};

export type LogisticsTriggerStatus =
  | 'scheduled'
  | 'due'
  | 'fired'
  | 'skipped'
  | 'cancelled';

export type LogisticsTrigger = {
  id: string;
  eventId: string;
  kind: LogisticsCheckKind | 'time' | 'geo';
  title: string;
  fireAtMs: number;
  status: LogisticsTriggerStatus;
  /** Next background poll (engine-owned) */
  nextPollAtMs: number | null;
  leaveByMs: number | null;
  walkEtaMin: number | null;
  arrivalBufferMin: number | null;
  delayMin: number;
  mode: LogisticsMode | null;
  stationScale: StationScale | null;
  /** Speak / vibrate on fire */
  alertLevel: 'silent' | 'hud' | 'push' | 'voice';
  createdAtMs: number;
  updatedAtMs: number;
  lastFiredAtMs: number | null;
  note?: string;
};

type LogisticsTriggerState = {
  events: LogisticsEvent[];
  triggers: LogisticsTrigger[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  upsertEvent: (
    input: Omit<LogisticsEvent, 'createdAtMs' | 'updatedAtMs' | 'status'> & {
      status?: LogisticsEventStatus;
    },
  ) => LogisticsEvent;
  completeEvent: (id: string) => void;
  cancelEvent: (id: string) => void;
  removeEvent: (id: string) => void;
  /**
   * Register / refresh a departure watch with smart check schedule.
   * Replaces prior triggers for the same eventId.
   */
  upsertDepartureWatch: (input: {
    eventId: string;
    title: string;
    departureMs: number;
    walkEtaMin: number;
    mode?: LogisticsMode;
    stationName?: string | null;
    delayMin?: number;
    externalId?: string | null;
    detail?: string;
    destLat?: number | null;
    destLng?: number | null;
    destName?: string | null;
    connectionStatus?: string | null;
    /** Minuten vor Leave-by für Hauptwarnung (Prio 1–2 → 30, ab 3 → 5). */
    warnLeadMin?: number;
    planPriority?: number | null;
  }) => { event: LogisticsEvent; triggers: LogisticsTrigger[]; leaveByMs: number };
  /** Simple absolute time reminder (call someone at 18:00). */
  upsertTimeReminder: (input: {
    eventId?: string;
    title: string;
    fireAtMs: number;
    detail?: string;
    alertLevel?: LogisticsTrigger['alertLevel'];
  }) => { event: LogisticsEvent; trigger: LogisticsTrigger };
  /**
   * Wecker-Rhythmus: Mikro → 35-Min-Warnung → Wecker-Moment.
   * Hard-Feuer übernimmt der native Wecker; hier progressive Checks.
   */
  upsertWakeWatch: (input: {
    eventId?: string;
    title: string;
    wakeAtMs: number;
    leaveByMs?: number | null;
    linkedEventId?: string | null;
  }) => { event: LogisticsEvent; triggers: LogisticsTrigger[] };
  /** Geo nudge (restaurant you wanted to try). */
  upsertGeoTrigger: (input: {
    eventId?: string;
    title: string;
    lat: number;
    lng: number;
    detail?: string;
    /** Unmute / fire radius in meters (default 120). */
    radiusM?: number;
  }) => { event: LogisticsEvent; trigger: LogisticsTrigger };
  markTriggerFired: (triggerId: string) => void;
  cancelTriggersForEvent: (eventId: string) => void;
  /** Apply live delay — recomputes leave-by + denser polls. */
  updateDelay: (eventId: string, delayMin: number, walkEtaMin?: number) => void;
  getActiveEvents: () => LogisticsEvent[];
  getUpcomingTriggers: () => LogisticsTrigger[];
  getDueTriggers: (nowMs?: number) => LogisticsTrigger[];
  clearAll: () => Promise<void>;
};

const PATH = `${FileSystem.documentDirectory}findus-logistics-triggers.json`;
const MAX_EVENTS = 60;
const MAX_TRIGGERS = 120;

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

async function persist(state: {
  events: LogisticsEvent[];
  triggers: LogisticsTrigger[];
}): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      PATH,
      JSON.stringify({
        events: state.events.slice(-MAX_EVENTS),
        triggers: state.triggers.slice(-MAX_TRIGGERS),
      }),
    );
  } catch {
    /* soft-fail */
  }
}

function pruneInactive(
  events: LogisticsEvent[],
  triggers: LogisticsTrigger[],
): { events: LogisticsEvent[]; triggers: LogisticsTrigger[] } {
  const cutoff = Date.now() - 7 * 24 * 60 * 60_000;
  const nextEvents = events.filter(
    (e) =>
      e.status === 'active' ||
      (e.updatedAtMs ?? e.createdAtMs) > cutoff,
  );
  const activeIds = new Set(nextEvents.map((e) => e.id));
  const nextTriggers = triggers.filter(
    (t) =>
      activeIds.has(t.eventId) &&
      (t.status === 'scheduled' ||
        t.status === 'due' ||
        (t.updatedAtMs ?? t.createdAtMs) > cutoff),
  );
  return { events: nextEvents, triggers: nextTriggers };
}

export const useLogisticsTriggerStore = create<LogisticsTriggerState>(
  (set, get) => ({
    events: [],
    triggers: [],
    hydrated: false,

    hydrate: async () => {
      try {
        const info = await FileSystem.getInfoAsync(PATH);
        if (!info.exists) {
          set({ hydrated: true });
          return;
        }
        const raw = await FileSystem.readAsStringAsync(PATH);
        const parsed = JSON.parse(raw) as {
          events?: LogisticsEvent[];
          triggers?: LogisticsTrigger[];
        };
        const events = Array.isArray(parsed.events) ? parsed.events : [];
        const triggers = Array.isArray(parsed.triggers) ? parsed.triggers : [];
        const pruned = pruneInactive(events, triggers);
        // Alt-Termine beim Hydrate sofort stilllegen (kein Re-Fire nach App-Start)
        const now = Date.now();
        const GRACE = 4 * 60_000;
        const nextTriggers = pruned.triggers.map((t) => {
          if (t.status !== 'scheduled' && t.status !== 'due') return t;
          if (t.kind === 'geo') return t;
          if (
            t.fireAtMs < now - GRACE ||
            (t.leaveByMs != null && t.leaveByMs < now - GRACE)
          ) {
            return { ...t, status: 'cancelled' as const, updatedAtMs: now };
          }
          return t;
        });
        const nextEvents = pruned.events.map((e) => {
          if (e.status !== 'active') return e;
          if (e.atMs != null && e.atMs < now - 30 * 60_000) {
            return { ...e, status: 'done' as const, updatedAtMs: now };
          }
          return e;
        });
        set({
          events: nextEvents,
          triggers: nextTriggers,
          hydrated: true,
        });
        void persist({ events: nextEvents, triggers: nextTriggers });
      } catch {
        set({ hydrated: true });
      }
    },

    upsertEvent: (input) => {
      const now = Date.now();
      const existing = get().events.find((e) => e.id === input.id);
      const event: LogisticsEvent = {
        id: input.id,
        kind: input.kind,
        title: input.title,
        detail: input.detail,
        atMs: input.atMs,
        lat: input.lat,
        lng: input.lng,
        status: input.status ?? 'active',
        createdAtMs: existing?.createdAtMs ?? now,
        updatedAtMs: now,
        externalId: input.externalId ?? null,
        meta: input.meta,
      };
      const events = [
        ...get().events.filter((e) => e.id !== event.id),
        event,
      ];
      set({ events });
      void persist({ events, triggers: get().triggers });
      return event;
    },

    completeEvent: (id) => {
      const events = get().events.map((e) =>
        e.id === id
          ? { ...e, status: 'done' as const, updatedAtMs: Date.now() }
          : e,
      );
      const triggers = get().triggers.map((t) =>
        t.eventId === id && (t.status === 'scheduled' || t.status === 'due')
          ? { ...t, status: 'cancelled' as const, updatedAtMs: Date.now() }
          : t,
      );
      set({ events, triggers });
      void persist({ events, triggers });
    },

    cancelEvent: (id) => {
      const events = get().events.map((e) =>
        e.id === id
          ? { ...e, status: 'cancelled' as const, updatedAtMs: Date.now() }
          : e,
      );
      const triggers = get().triggers.map((t) =>
        t.eventId === id && (t.status === 'scheduled' || t.status === 'due')
          ? { ...t, status: 'cancelled' as const, updatedAtMs: Date.now() }
          : t,
      );
      set({ events, triggers });
      void persist({ events, triggers });
    },

    removeEvent: (id) => {
      const events = get().events.filter((e) => e.id !== id);
      const triggers = get().triggers.filter((t) => t.eventId !== id);
      set({ events, triggers });
      void persist({ events, triggers });
    },

    upsertDepartureWatch: (input) => {
      const now = Date.now();
      const plan = computeLeavePlan({
        departureMs: input.departureMs,
        walkEtaMin: input.walkEtaMin,
        mode: input.mode,
        stationName: input.stationName,
        delayMin: input.delayMin,
      });
      const eventKind: LogisticsEvent['kind'] =
        input.mode === 'flight'
          ? 'flight'
          : input.mode === 'bus'
            ? 'bus'
            : input.mode === 'train'
              ? 'train'
              : 'reminder';

      const event = get().upsertEvent({
        id: input.eventId,
        kind: eventKind,
        title: input.title,
        detail:
          input.detail ??
          describeLeavePlan(plan) +
            (input.stationName ? ` · ${input.stationName}` : ''),
        atMs: plan.effectiveDepartureMs,
        lat: input.destLat ?? null,
        lng: input.destLng ?? null,
        status: 'active',
        externalId: input.externalId ?? null,
        meta: {
          baseDepartureMs: input.departureMs,
          leaveByMs: plan.leaveByMs,
          walkEtaMin: plan.walkEtaMin,
          arrivalBufferMin: plan.arrivalBufferMin,
          delayMin: plan.delayMin,
          stationScale: plan.stationScale,
          mode: plan.mode,
          stationName: input.stationName ?? null,
          destLat: input.destLat ?? null,
          destLng: input.destLng ?? null,
          destName: input.destName ?? input.stationName ?? null,
          connectionStatus: input.connectionStatus ?? 'unknown',
          warnLeadMin: input.warnLeadMin ?? null,
          planPriority: input.planPriority ?? null,
        },
      });

      const schedule = buildCheckSchedule(plan.leaveByMs, now, 'leave', {
        warnLeadMin: input.warnLeadMin,
      });
      const kept = get().triggers.filter(
        (t) =>
          t.eventId !== input.eventId ||
          (t.status !== 'scheduled' && t.status !== 'due'),
      );

      const alertFor = (
        kind: LogisticsCheckKind,
        role?: 'micro' | 'warn' | 'hard',
      ): LogisticsTrigger['alertLevel'] => {
        if (role === 'micro' || kind === 'coarse' || kind === 'prep') {
          return 'silent';
        }
        if (role === 'warn' || kind === 'safety') return 'push';
        if (kind === 'leave') return 'voice';
        return 'hud';
      };

      const fresh: LogisticsTrigger[] = schedule.map((cp) => ({
        id: uid(`lt_${cp.kind}`),
        eventId: input.eventId,
        kind: cp.kind,
        title: `${input.title} — ${cp.label}`,
        fireAtMs: cp.atMs,
        status: 'scheduled' as const,
        nextPollAtMs:
          cp.kind === 'leave'
            ? null
            : now +
              nextPollIntervalMs({
                leaveByMs: plan.leaveByMs,
                nowMs: now,
                delayMin: plan.delayMin,
              }),
        leaveByMs: plan.leaveByMs,
        walkEtaMin: plan.walkEtaMin,
        arrivalBufferMin: plan.arrivalBufferMin,
        delayMin: plan.delayMin,
        mode: plan.mode,
        stationScale: plan.stationScale,
        alertLevel: alertFor(cp.kind, cp.role),
        createdAtMs: now,
        updatedAtMs: now,
        lastFiredAtMs: null,
        note: `role=${cp.role} · Los ${formatClockMs(plan.leaveByMs)} · Ziel ${formatClockMs(plan.arriveTargetMs)}`,
      }));

      const triggers = [...kept, ...fresh];
      set({ triggers });
      void persist({ events: get().events, triggers });
      return { event, triggers: fresh, leaveByMs: plan.leaveByMs };
    },

    upsertTimeReminder: (input) => {
      const now = Date.now();
      const eventId = input.eventId ?? uid('ev_time');
      const event = get().upsertEvent({
        id: eventId,
        kind: 'reminder',
        title: input.title,
        detail: input.detail,
        atMs: input.fireAtMs,
        status: 'active',
      });
      const kept = get().triggers.filter(
        (t) =>
          !(
            t.eventId === eventId &&
            (t.status === 'scheduled' || t.status === 'due')
          ),
      );
      const trigger: LogisticsTrigger = {
        id: uid('lt_time'),
        eventId,
        kind: 'time',
        title: input.title,
        fireAtMs: input.fireAtMs,
        status: 'scheduled',
        nextPollAtMs: null,
        leaveByMs: null,
        walkEtaMin: null,
        arrivalBufferMin: null,
        delayMin: 0,
        mode: null,
        stationScale: null,
        alertLevel: input.alertLevel ?? 'voice',
        createdAtMs: now,
        updatedAtMs: now,
        lastFiredAtMs: null,
      };
      const triggers = [...kept, trigger];
      set({ triggers });
      void persist({ events: get().events, triggers });
      return { event, trigger };
    },

    upsertWakeWatch: (input) => {
      const now = Date.now();
      const eventId =
        input.eventId ??
        input.linkedEventId ??
        `wake_rhythm_${Math.floor(input.wakeAtMs / 60_000)}`;
      const event = get().upsertEvent({
        id: eventId,
        kind: 'alarm',
        title: input.title,
        detail: `Wecker ${formatClockMs(input.wakeAtMs)} · Vorwarnung 35 Min`,
        atMs: input.wakeAtMs,
        status: 'active',
        meta: {
          linkedWakeAtMs: input.wakeAtMs,
          wakeReason: input.title,
          leaveByMs: input.leaveByMs ?? null,
          scheduleProfile: 'wake' satisfies CheckScheduleProfile,
        },
      });

      const schedule = buildCheckSchedule(input.wakeAtMs, now, 'wake');
      const kept = get().triggers.filter(
        (t) =>
          t.eventId !== eventId ||
          (t.status !== 'scheduled' && t.status !== 'due'),
      );

      const fresh: LogisticsTrigger[] = schedule.map((cp) => ({
        id: uid(`lt_wake_${cp.kind}`),
        eventId,
        kind: cp.kind,
        title: `${input.title} — ${cp.label}`,
        fireAtMs: cp.atMs,
        status: 'scheduled' as const,
        nextPollAtMs:
          cp.role === 'hard'
            ? null
            : now +
              nextPollIntervalMs({
                leaveByMs: input.leaveByMs ?? input.wakeAtMs,
                nowMs: now,
              }),
        leaveByMs: input.leaveByMs ?? input.wakeAtMs,
        walkEtaMin: null,
        arrivalBufferMin: null,
        delayMin: 0,
        mode: null,
        stationScale: null,
        alertLevel:
          cp.role === 'micro'
            ? 'silent'
            : cp.role === 'warn'
              ? 'push'
              : 'voice',
        createdAtMs: now,
        updatedAtMs: now,
        lastFiredAtMs: null,
        note: `role=${cp.role}`,
      }));

      const triggers = [...kept, ...fresh];
      set({ triggers });
      void persist({ events: get().events, triggers });
      return { event, triggers: fresh };
    },

    upsertGeoTrigger: (input) => {
      const now = Date.now();
      const eventId = input.eventId ?? uid('ev_geo');
      const radiusM =
        input.radiusM != null && input.radiusM > 0
          ? Math.round(input.radiusM)
          : 120;
      const event = get().upsertEvent({
        id: eventId,
        kind: 'geo',
        title: input.title,
        detail: input.detail,
        atMs: null,
        lat: input.lat,
        lng: input.lng,
        status: 'active',
        meta: { radiusM },
      });
      const kept = get().triggers.filter(
        (t) =>
          !(
            t.eventId === eventId &&
            (t.status === 'scheduled' || t.status === 'due')
          ),
      );
      const trigger: LogisticsTrigger = {
        id: uid('lt_geo'),
        eventId,
        kind: 'geo',
        title: input.title,
        fireAtMs: now,
        status: 'scheduled',
        nextPollAtMs: now + 5 * 60_000,
        leaveByMs: null,
        walkEtaMin: null,
        arrivalBufferMin: null,
        delayMin: 0,
        mode: null,
        stationScale: null,
        alertLevel: 'voice',
        createdAtMs: now,
        updatedAtMs: now,
        lastFiredAtMs: null,
        note: `Ortsbezogen — feuert bei ≤${radiusM} m`,
      };
      const triggers = [...kept, trigger];
      set({ triggers });
      void persist({ events: get().events, triggers });
      return { event, trigger };
    },

    markTriggerFired: (triggerId) => {
      const now = Date.now();
      const triggers = get().triggers.map((t) =>
        t.id === triggerId
          ? {
              ...t,
              status: 'fired' as const,
              updatedAtMs: now,
              lastFiredAtMs: now,
              nextPollAtMs: null,
            }
          : t,
      );
      set({ triggers });
      void persist({ events: get().events, triggers });
    },

    cancelTriggersForEvent: (eventId) => {
      const triggers = get().triggers.map((t) =>
        t.eventId === eventId &&
        (t.status === 'scheduled' || t.status === 'due')
          ? { ...t, status: 'cancelled' as const, updatedAtMs: Date.now() }
          : t,
      );
      set({ triggers });
      void persist({ events: get().events, triggers });
    },

    updateDelay: (eventId, delayMin, walkEtaMin) => {
      const event = get().events.find((e) => e.id === eventId);
      if (!event || event.atMs == null) return;
      const meta = event.meta ?? {};
      const walk =
        walkEtaMin ??
        (typeof meta.walkEtaMin === 'number' ? meta.walkEtaMin : 15);
      const mode =
        (typeof meta.mode === 'string' ? meta.mode : 'train') as LogisticsMode;
      const stationName =
        typeof meta.stationName === 'string' ? meta.stationName : null;
      // atMs is effective departure without re-adding delay in meta — use scheduled base
      const baseDeparture =
        typeof meta.baseDepartureMs === 'number'
          ? meta.baseDepartureMs
          : event.atMs - (typeof meta.delayMin === 'number' ? meta.delayMin : 0) * 60_000;

      get().upsertDepartureWatch({
        eventId,
        title: event.title,
        departureMs: baseDeparture,
        walkEtaMin: walk,
        mode,
        stationName,
        delayMin,
        externalId: event.externalId,
        detail: event.detail,
        destLat:
          typeof meta.destLat === 'number'
            ? meta.destLat
            : event.lat ?? null,
        destLng:
          typeof meta.destLng === 'number'
            ? meta.destLng
            : event.lng ?? null,
        destName:
          typeof meta.destName === 'string' ? meta.destName : stationName,
        connectionStatus:
          delayMin >= 5
            ? 'delayed'
            : typeof meta.connectionStatus === 'string'
              ? meta.connectionStatus
              : 'unknown',
      });
    },

    getActiveEvents: () => get().events.filter((e) => e.status === 'active'),

    getUpcomingTriggers: () =>
      get()
        .triggers.filter(
          (t) => t.status === 'scheduled' || t.status === 'due',
        )
        .sort((a, b) => a.fireAtMs - b.fireAtMs),

    getDueTriggers: (nowMs = Date.now()) => {
      // Max. 4 Min überfällig noch feuern — ältere Alt-Termine nie wieder
      const oldest = nowMs - 4 * 60_000;
      return get().triggers.filter(
        (t) =>
          (t.status === 'scheduled' || t.status === 'due') &&
          t.kind !== 'geo' &&
          t.fireAtMs <= nowMs &&
          t.fireAtMs >= oldest,
      );
    },

    clearAll: async () => {
      set({ events: [], triggers: [] });
      try {
        const info = await FileSystem.getInfoAsync(PATH);
        if (info.exists) await FileSystem.deleteAsync(PATH, { idempotent: true });
      } catch {
        /* ignore */
      }
    },
  }),
);
