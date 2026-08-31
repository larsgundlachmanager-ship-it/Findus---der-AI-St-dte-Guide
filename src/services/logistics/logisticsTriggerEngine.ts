/**
 * Tick logistics triggers: fire due checkpoints, densify polls on delay.
 * Wired from proactive reminder engine / mobility tick.
 *
 * Checkpoint fire → Logistics Guardian (Route / Taxi / Plan B).
 * Background tick → GPS-Drift + Disruption alerts.
 */

import {
  scheduleLeaveByReminder,
  scheduleFlightDepartureReminder,
} from '../notifications/notificationService';
import {
  formatClockMs,
  type LogisticsMode,
} from './logisticsTriggerMath';
import {
  useLogisticsTriggerStore,
  type LogisticsTrigger,
} from '../../store/useLogisticsTriggerStore';
import { useGpsStore } from '../../store/useGpsStore';
import {
  presentCheckpointHelp,
  tickLogisticsGuardian,
  probeAlternativeIfNeeded,
} from './logisticsGuardian';

const GEO_RADIUS_M = 150;
let lastTickMs = 0;
const MIN_TICK_GAP_MS = 20_000;

function eventGeoRadiusM(event: {
  meta?: Record<string, string | number | boolean | null> | undefined;
}): number {
  const r = event.meta?.radiusM;
  return typeof r === 'number' && r > 0 ? r : GEO_RADIUS_M;
}

function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function fireTrigger(trigger: LogisticsTrigger): Promise<void> {
  const store = useLogisticsTriggerStore.getState();
  store.markTriggerFired(trigger.id);

  // Full helper UX: speech + Route / Taxi / Plan B
  try {
    await presentCheckpointHelp(trigger);
    if (trigger.kind === 'prep' || trigger.kind === 'safety') {
      void probeAlternativeIfNeeded(trigger.eventId);
    }
  } catch (err) {
    console.warn('[logistics] checkpoint help failed', err);
  }
}

function pruneStaleTriggers(now: number): void {
  const store = useLogisticsTriggerStore.getState();
  const GRACE = 4 * 60_000;
  const triggers = store.triggers.map((t) => {
    if (t.status !== 'scheduled' && t.status !== 'due') return t;
    if (t.kind === 'geo') return t;
    const leave = t.leaveByMs;
    if (
      t.fireAtMs < now - GRACE ||
      (leave != null && leave < now - GRACE)
    ) {
      return { ...t, status: 'cancelled' as const, updatedAtMs: now };
    }
    return t;
  });
  const events = store.events.map((e) => {
    if (e.status !== 'active') return e;
    if (e.atMs != null && e.atMs < now - 30 * 60_000) {
      return { ...e, status: 'done' as const, updatedAtMs: now };
    }
    return e;
  });
  const changed =
    triggers.some((t, i) => t.status !== store.triggers[i]?.status) ||
    events.some((e, i) => e.status !== store.events[i]?.status);
  if (changed) {
    useLogisticsTriggerStore.setState({ events, triggers });
  }
}

/**
 * Background tick — call from proactive reminder / GPS loops.
 */
export async function tickLogisticsTriggerEngine(opts?: {
  force?: boolean;
  nowMs?: number;
}): Promise<{ fired: number }> {
  const now = opts?.nowMs ?? Date.now();
  if (!opts?.force && now - lastTickMs < MIN_TICK_GAP_MS) {
    return { fired: 0 };
  }
  lastTickMs = now;

  // Modul 4: 30s nach Modul 2 + nie während Modul 2
  try {
    const { canModule4Speak } = await import(
      '../navigation/modulePriorityPolicy'
    );
    const gate = canModule4Speak(now);
    if (!gate.ok && !opts?.force) {
      return { fired: 0 };
    }
  } catch {
    /* soft */
  }

  const store = useLogisticsTriggerStore.getState();
  if (!store.hydrated) return { fired: 0 };

  pruneStaleTriggers(now);

  // Adaptive help: drift, delay, cancel, taxi storno
  try {
    await tickLogisticsGuardian({ nowMs: now });
  } catch (err) {
    console.warn('[logistics] guardian tick failed', err);
  }

  // Live-Abfahrten pollen (Verspätung / Ausfall / Gleis)
  try {
    const { pollLiveDeparturesForWatches } = await import('./liveDeparturePoll');
    await pollLiveDeparturesForWatches({ nowMs: now });
  } catch (err) {
    console.warn('[logistics] live departure poll failed', err);
  }

  try {
    const { tickFlightWatch } = await import('../flights/flightWatchService');
    await tickFlightWatch(now);
  } catch (err) {
    console.warn('[logistics] flight watch failed', err);
  }

  let fired = 0;
  const liveStore = useLogisticsTriggerStore.getState();

  const due = liveStore.getDueTriggers(now);
  for (const t of due) {
    // Nochmals: Event muss aktiv sein und Ziel nicht längst vorbei
    const event = liveStore.events.find((e) => e.id === t.eventId);
    if (!event || event.status !== 'active') continue;
    if (event.atMs != null && event.atMs < now - 10 * 60_000) {
      liveStore.cancelEvent(event.id);
      continue;
    }
    // Timeline-SSOT: plan_*/dining_* nur wenn Stop noch in der Timeline
    if (event.id.startsWith('plan_') || event.id.startsWith('dining_')) {
      try {
        const { useFuturePlanStore } = require('../../module2/timeline/futurePlanState') as {
          useFuturePlanStore: {
            getState: () => {
              plan: { stops: Array<{ id: string; kind?: string }> };
            };
          };
        };
        const stopId = event.id.replace(/^(plan_|dining_)/, '');
        const hit = useFuturePlanStore
          .getState()
          .plan.stops.find((s) => s.id === stopId && s.kind === 'stop');
        if (!hit) {
          liveStore.cancelEvent(event.id);
          continue;
        }
      } catch {
        /* soft */
      }
    }
    await fireTrigger(t);
    fired += 1;
  }

  const gps = useGpsStore.getState();
  const lat = gps.lat;
  const lng = gps.lng;
  if (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    const geoStore = useLogisticsTriggerStore.getState();
    const geoTriggers = geoStore.triggers.filter(
      (t) =>
        t.kind === 'geo' && (t.status === 'scheduled' || t.status === 'due'),
    );
    for (const t of geoTriggers) {
      const event = geoStore.events.find((e) => e.id === t.eventId);
      if (
        event?.lat == null ||
        event?.lng == null ||
        !Number.isFinite(event.lat) ||
        !Number.isFinite(event.lng) ||
        event.status !== 'active'
      ) {
        continue;
      }
      const dist = haversineM(
        { lat, lng },
        { lat: event.lat, lng: event.lng },
      );
      if (dist <= eventGeoRadiusM(event)) {
        await fireTrigger(t);
        fired += 1;
      }
    }
  }

  return { fired };
}

/** Sync helpers used by catch-my-bus / flight orchestrators. */
export function registerDepartureWatch(input: {
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
  /** false = caller already scheduled OS push (e.g. catch-my-bus) */
  scheduleOsPush?: boolean;
  warnLeadMin?: number;
  planPriority?: number | null;
  deadlineSoftness?: 'strict' | 'forgiving' | null;
  stopId?: string | null;
  directionHint?: string | null;
  platform?: string | null;
}): { leaveByMs: number } {
  const result = useLogisticsTriggerStore
    .getState()
    .upsertDepartureWatch(input);
  const { leaveByMs } = result;
  const buffer =
    result.triggers.find((t) => t.kind === 'leave')?.arrivalBufferMin ??
    undefined;

  if (input.scheduleOsPush === false) {
    return { leaveByMs };
  }

  const key = input.externalId ?? input.eventId;
  const departureMs =
    input.departureMs + Math.max(0, input.delayMin ?? 0) * 60_000;
  const mode = input.mode ?? 'generic';
  if (mode === 'flight') {
    void scheduleFlightDepartureReminder({
      departureMs,
      walkEtaMinutes: input.walkEtaMin,
      flightLabel: input.title,
      safetyBufferMin: buffer,
      reminderKey: `logistics:${key}`,
    });
  } else {
    void scheduleLeaveByReminder({
      departureMs,
      walkEtaMinutes: input.walkEtaMin,
      mode,
      title: input.title,
      line:
        mode === 'bus' || mode === 'train' || mode === 'ferry'
          ? input.title
          : undefined,
      destName: input.destName ?? input.title,
      stationName:
        mode === 'bus' || mode === 'train' || mode === 'ferry'
          ? (input.stationName ?? undefined)
          : undefined,
      safetyBufferMin: buffer,
      reminderKey: `logistics:${key}`,
    });
  }

  return { leaveByMs };
}

export function registerTimeReminder(input: {
  title: string;
  fireAtMs: number;
  detail?: string;
  eventId?: string;
}): void {
  useLogisticsTriggerStore.getState().upsertTimeReminder(input);
  const id = `task:${input.eventId ?? input.title}:${input.fireAtMs}`;
  void import('../notifications/taskReminderNotifications')
    .then(({ scheduleTaskReminderAt }) =>
      scheduleTaskReminderAt({
        id,
        fireAtMs: input.fireAtMs,
        task: input.title,
        userText: input.detail ?? input.title,
      }),
    )
    .catch(() => {
      /* notifications optional in tests */
    });
}

/**
 * Wecker-Rhythmus: Mikro-Checks (stumm) — kein Vorwarn-Speak.
 * Native Alarm feuert hard; hier nur progressive ÖPNV-Logik drumherum.
 */
export function registerWakeRhythm(input: {
  wakeAtMs: number;
  reasonLabel: string;
  leaveByMs?: number | null;
  linkedEventId?: string | null;
}): void {
  useLogisticsTriggerStore.getState().upsertWakeWatch({
    title: input.reasonLabel,
    wakeAtMs: input.wakeAtMs,
    leaveByMs: input.leaveByMs ?? null,
    linkedEventId: input.linkedEventId ?? null,
    eventId: input.linkedEventId
      ? `wake_meta_${input.linkedEventId}`
      : undefined,
  });

  // Leave-Event mit Wecker verknüpfen, falls vorhanden
  if (input.linkedEventId) {
    const store = useLogisticsTriggerStore.getState();
    const existing = store.events.find((e) => e.id === input.linkedEventId);
    if (existing) {
      store.upsertEvent({
        id: existing.id,
        kind: existing.kind,
        title: existing.title,
        detail: existing.detail,
        atMs: existing.atMs,
        lat: existing.lat,
        lng: existing.lng,
        status: 'active',
        externalId: existing.externalId,
        meta: {
          ...(existing.meta ?? {}),
          linkedWakeAtMs: input.wakeAtMs,
          wakeReason: input.reasonLabel,
          leaveByMs: input.leaveByMs ?? metaNumSafe(existing.meta, 'leaveByMs'),
        },
      });
    }
  }
}

function metaNumSafe(
  meta: Record<string, string | number | boolean | null> | undefined,
  key: string,
): number | null {
  const v = meta?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function registerGeoNudge(input: {
  title: string;
  lat: number;
  lng: number;
  detail?: string;
  eventId?: string;
  radiusM?: number;
}): void {
  useLogisticsTriggerStore.getState().upsertGeoTrigger(input);
}

export function formatTriggerStatusLine(t: LogisticsTrigger): string {
  const when = formatClockMs(t.fireAtMs);
  const status =
    t.status === 'scheduled'
      ? 'geplant'
      : t.status === 'due'
        ? 'fällig'
        : t.status === 'fired'
          ? 'ausgelöst'
          : t.status;
  const alert =
    t.alertLevel === 'voice'
      ? 'Push+Stimme'
      : t.alertLevel === 'push'
        ? 'Push'
        : t.alertLevel === 'hud'
          ? 'HUD'
          : 'still';
  return `${when} · ${status} · ${alert}`;
}

// Re-export guardian APIs for orchestrators / action handlers
export {
  reportConnectionDisruption,
  reportTaxiStatus,
  assessLogisticsHelp,
} from './logisticsGuardian';
