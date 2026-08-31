/**
 * Logistics Guardian — „immer dem User perfekt helfen“.
 *
 * Bei jedem Checkpoint und im Hintergrund-Tick:
 * - GPS-Drift → Leave-by & Trigger nach vorne
 * - Verspätung → Puffer + dichtere Checks
 * - Ausfall → Taxi / Alternativ-ÖPNV (Plan B)
 * - Leave-Push → Route starten + Taxi anbieten
 * - Taxi storniert → neu organisieren oder ÖPNV
 */

import type { QuickAction, GeminiConciergeResponse } from '../../types/concierge';
import { estimateTravelEta, estimateTravelEtaRouted } from '../navigation/travelEta';
import { recalculateMissedConnection } from '../transit/journeyPlanner';
import {
  formatMissedSilentHud,
} from '../transit/missedConnectionPolicy';
import { getNavPhase } from '../navigation/boardingDetector';
import { formatClockMs, computeLeavePlan } from './logisticsTriggerMath';
import {
  useLogisticsTriggerStore,
  type LogisticsEvent,
  type LogisticsTrigger,
} from '../../store/useLogisticsTriggerStore';
import { useGpsStore } from '../../store/useGpsStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import { haversineMeters } from '../../db/database';
import { presentConciergeResponse } from '../concierge/presentConcierge';
import {
  scheduleLeaveByReminder,
  scheduleFlightDepartureReminder,
} from '../notifications/notificationService';
import { cleanLeaveDestLabel, buildLeaveReminderBody } from '../notifications/reminderMath';
import { resolveLeaveContextHint } from '../notifications/leaveContextHint';
import type { LogisticsMode } from './logisticsTriggerMath';
import { useFuturePlanStore } from '../../module2/timeline/futurePlanState';

/** Ziele weiter weg als das sind Stale-Trip-Reste (z. B. anderer Kontinent). */
const STALE_DEST_MAX_M = 80_000;

export type ConnectionStatus =
  | 'ok'
  | 'delayed'
  | 'cancelled'
  | 'missed'
  | 'unknown';

export type TaxiStatus = 'none' | 'booked' | 'cancelled' | 'rebooking';

export type GuardianVerdict = {
  situation:
    | 'on_track'
    | 'user_drifted'
    | 'delayed'
    | 'cancelled'
    | 'tight'
    | 'taxi_cancelled'
    | 'leave_now'
    | 'prep'
    | 'safety'
    | 'coarse';
  speech: string;
  bullets: string[];
  actions: QuickAction[];
  /** Walk ETA changed enough to reschedule */
  rescheduleWalkEtaMin?: number;
  rescheduleDelayMin?: number;
  cardTitle: string;
};

const WALK_DRIFT_RESCHEDULE_MIN = 3;
const TIGHT_BUFFER_MIN = 4;
/** Parkticket: ~10 Min drüber noch ok — nicht sofort „knapp“. */
const TIGHT_BUFFER_PARKING_MIN = -8;
let lastGuardianPresentMs = 0;
const GUARDIAN_PRESENT_GAP_MS = 45_000;

function metaNum(meta: LogisticsEvent['meta'], key: string): number | null {
  const v = meta?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function metaStr(meta: LogisticsEvent['meta'], key: string): string | null {
  const v = meta?.[key];
  return typeof v === 'string' && v.trim() ? v : null;
}

function connectionStatusOf(event: LogisticsEvent): ConnectionStatus {
  const s = metaStr(event.meta, 'connectionStatus');
  if (
    s === 'ok' ||
    s === 'delayed' ||
    s === 'cancelled' ||
    s === 'missed' ||
    s === 'unknown'
  ) {
    return s;
  }
  return 'unknown';
}

function taxiStatusOf(event: LogisticsEvent): TaxiStatus {
  const s = metaStr(event.meta, 'taxiStatus');
  if (s === 'booked' || s === 'cancelled' || s === 'rebooking' || s === 'none') {
    return s;
  }
  return 'none';
}

function destOf(event: LogisticsEvent): {
  lat: number;
  lng: number;
  name: string;
} | null {
  // Reiner Wecker ≠ Navigationsziel
  if (event.kind === 'alarm') return null;

  const lat = event.lat ?? metaNum(event.meta, 'destLat');
  const lng = event.lng ?? metaNum(event.meta, 'destLng');
  if (lat == null || lng == null) return null;
  const name =
    metaStr(event.meta, 'stationName') ||
    metaStr(event.meta, 'destName') ||
    event.title;
  if (/^wecker\b/i.test(name.trim()) && metaNum(event.meta, 'destLat') == null) {
    return null;
  }

  const gps = useGpsStore.getState();
  if (
    gps.lat != null &&
    gps.lng != null &&
    Number.isFinite(gps.lat) &&
    Number.isFinite(gps.lng)
  ) {
    const dist = haversineMeters(gps.lat, gps.lng, lat, lng);
    if (dist > STALE_DEST_MAX_M) {
      if (__DEV__) {
        console.warn(
          `[logistics] stale dest discarded id=${event.id} name=${name} distKm=${(dist / 1000).toFixed(0)}`,
        );
      }
      return null;
    }
  }
  return { lat, lng, name };
}

/** Nächstes echtes Ziel nach Transit-Leg (z. B. Theater nach Bahn). */
function resolveChainDestName(event: LogisticsEvent): string | null {
  const dest =
    cleanLeaveDestLabel(metaStr(event.meta, 'destName')) ||
    cleanLeaveDestLabel(event.title);
  try {
    const now = Date.now();
    const stops = useFuturePlanStore
      .getState()
      .plan.stops.filter(
        (s) =>
          s.kind === 'stop' &&
          !s.id.startsWith('choice_') &&
          !s.id.startsWith('wish_') &&
          !s.id.startsWith('wake_') &&
          s.plannedStartMs != null &&
          s.plannedStartMs >= now - 5 * 60_000,
      )
      .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0));
    const selfIdx = stops.findIndex(
      (s) =>
        s.title.trim().toLowerCase() === dest.toLowerCase() ||
        event.id.includes(s.id),
    );
    const next =
      selfIdx >= 0
        ? stops[selfIdx + 1]
        : stops.find(
            (s) =>
              s.title.trim().toLowerCase() !== dest.toLowerCase() &&
              (s.plannedStartMs ?? 0) >
                (metaNum(event.meta, 'baseDepartureMs') ?? now),
          );
    if (!next) return null;
    const n = cleanLeaveDestLabel(next.title);
    if (!n || n.toLowerCase() === dest.toLowerCase()) return null;
    return n;
  } catch {
    return null;
  }
}

async function currentWalkEtaMin(event: LogisticsEvent): Promise<number | null> {
  const dest = destOf(event);
  const gps = useGpsStore.getState();
  if (
    !dest ||
    gps.lat == null ||
    gps.lng == null ||
    !Number.isFinite(gps.lat) ||
    !Number.isFinite(gps.lng)
  ) {
    return metaNum(event.meta, 'walkEtaMin');
  }
  try {
    const eta = await estimateTravelEtaRouted({
      userLat: gps.lat,
      userLng: gps.lng,
      destLat: dest.lat,
      destLng: dest.lng,
      destName: dest.name,
    });
    return Math.max(1, Math.ceil(eta.totalMinutes));
  } catch {
    const eta = estimateTravelEta({
      userLat: gps.lat,
      userLng: gps.lng,
      destLat: dest.lat,
      destLng: dest.lng,
      destName: dest.name,
    });
    return Math.max(1, Math.ceil(eta.totalMinutes));
  }
}

function buildNavAction(
  dest: { lat: number; lng: number; name: string } | null,
): QuickAction | null {
  if (!dest) return null;
  return {
    type: 'START_NAVIGATION',
    label: `Route zu ${dest.name}`,
    payload: {
      destLat: dest.lat,
      destLng: dest.lng,
      destName: dest.name,
    },
  };
}

function buildTaxiAction(
  dest: { lat: number; lng: number; name: string } | null,
  label = 'Taxi / Uber rufen',
): QuickAction | null {
  if (!dest) return null;
  return {
    type: 'BOOK_UBER',
    label,
    payload: {
      destLat: dest.lat,
      destLng: dest.lng,
      destName: dest.name,
    },
  };
}

function buildPlanBAction(title: string): QuickAction {
  return {
    type: 'SHOW_MORE',
    label: 'Plan B vorschlagen',
    payload: {
      textPrompt:
        `Meine Verbindung „${title}“ ist problematisch (Ausfall/Verspätung/Taxi weg). ` +
        `Finde sofort die beste Alternative: nächste ÖPNV-Verbindung oder Taxi — ` +
        `mit klarer Leave-by-Zeit und Buttons Route/Taxi.`,
    },
  };
}

/**
 * Pure-ish verdict for a checkpoint or disruption.
 */
export function assessLogisticsHelp(opts: {
  event: LogisticsEvent;
  trigger?: LogisticsTrigger | null;
  walkEtaMin?: number | null;
  nowMs?: number;
}): GuardianVerdict {
  const now = opts.nowMs ?? Date.now();
  const event = opts.event;
  const trigger = opts.trigger ?? null;
  const dest = destOf(event);
  const walk =
    opts.walkEtaMin ??
    metaNum(event.meta, 'walkEtaMin') ??
    trigger?.walkEtaMin ??
    15;
  const delayMin =
    metaNum(event.meta, 'delayMin') ?? trigger?.delayMin ?? 0;
  const baseDeparture =
    metaNum(event.meta, 'baseDepartureMs') ??
    (event.atMs != null
      ? event.atMs - delayMin * 60_000
      : now + 60 * 60_000);
  const mode = (metaStr(event.meta, 'mode') as LogisticsMode | null) ?? 'generic';
  const plan = computeLeavePlan({
    departureMs: baseDeparture,
    walkEtaMin: walk,
    mode,
    stationName: metaStr(event.meta, 'stationName'),
    delayMin,
  });
  const minsUntilLeave = Math.round((plan.leaveByMs - now) / 60_000);
  const conn = connectionStatusOf(event);
  const taxi = taxiStatusOf(event);
  const nav = buildNavAction(dest);
  const taxiBtn = buildTaxiAction(dest);
  const actions: QuickAction[] = [];
  const forgiving =
    metaStr(event.meta, 'deadlineSoftness') === 'forgiving' ||
    metaStr(event.meta, 'mode') === 'car';
  const tightLimit = forgiving ? TIGHT_BUFFER_PARKING_MIN : TIGHT_BUFFER_MIN;

  // --- Taxi cancelled: highest urgency help ---
  if (taxi === 'cancelled') {
    if (taxiBtn) actions.push({ ...taxiBtn, label: 'Neues Taxi organisieren' });
    actions.push({
      type: 'SHOW_MORE',
      label: 'Mit Öffis weiter?',
      payload: {
        textPrompt:
          `Das Taxi zu „${event.title}“ wurde storniert. ` +
          `Schlage sofort Plan B vor: beste ÖPNV-Verbindung ODER neues Taxi, ` +
          `mit Leave-by und klarer Empfehlung.`,
      },
    });
    if (nav) actions.push(nav);
    return {
      situation: 'taxi_cancelled',
      cardTitle: 'Taxi storniert — Plan B',
      speech:
        `Hey — der Fahrer hat die Fahrt zu ${event.title} storniert. ` +
        `Ich organisiere ein neues Taxi. Wenn keins kommt: bist du bereit, mit den Öffis zu fahren? ` +
        `Ich hab sofort einen Alternativvorschlag.`,
      bullets: [
        'Taxi storniert',
        dest ? `Ziel: ${dest.name}` : event.title,
        `Leave-by aktuell ${formatClockMs(plan.leaveByMs)}`,
      ],
      actions: actions.slice(0, 4),
    };
  }

  // --- Connection cancelled / missed (nicht während in_transit) ---
  if (
    (conn === 'cancelled' || conn === 'missed') &&
    getNavPhase() !== 'in_transit'
  ) {
    if (taxiBtn) actions.push({ ...taxiBtn, label: 'Taxi rufen' });
    actions.push(buildPlanBAction(event.title));
    if (nav) actions.push(nav);
    const earlyLeave =
      minsUntilLeave > 0
        ? `Wir sollten eher früher los — ideal um ${formatClockMs(plan.leaveByMs - 15 * 60_000)} oder direkt Plan B.`
        : `Am besten jetzt Plan B.`;
    return {
      situation: 'cancelled',
      cardTitle: 'Verbindung ausgefallen',
      speech:
        `Hey — deine Verbindung „${event.title}“ fällt aus bzw. ist weg. ` +
        `${earlyLeave} Taxi oder nächste Bahn/Bus — Buttons.`,
      bullets: [
        'Verbindung ausgefallen / verpasst',
        `Geplant war ${formatClockMs(plan.effectiveDepartureMs)}`,
        earlyLeave,
      ],
      actions: actions.slice(0, 4),
      rescheduleDelayMin: delayMin,
    };
  }

  // --- Delayed but running ---
  if (conn === 'delayed' || delayMin >= 5) {
    if (nav) actions.push(nav);
    if (taxiBtn && minsUntilLeave <= 40) actions.push(taxiBtn);
    actions.push({
      type: 'SHOW_MORE',
      label: 'Status nochmal prüfen',
      payload: {
        textPrompt: `Prüfe Live-Status für „${event.title}“ — Verspätung, Gleis, Alternativen.`,
      },
    });
    return {
      situation: 'delayed',
      cardTitle: `Verspätung +${delayMin} Min`,
      speech:
        `Deine Verbindung hat aktuell etwa ${delayMin} Minuten Verspätung. ` +
        `Ich habe Extra-Puffer eingeplant — Losgehen spätestens um ${formatClockMs(plan.leaveByMs)}. ` +
        `Du kannst etwas entspannen, aber ich checke engmaschig, falls sie Zeit aufholt.`,
      bullets: [
        `Verspätung ~${delayMin} Min`,
        `Neuer Leave-by ${formatClockMs(plan.leaveByMs)}`,
        `Ankunftspuffer ${plan.arrivalBufferMin} Min`,
      ],
      actions: actions.slice(0, 4),
      rescheduleDelayMin: delayMin,
    };
  }

  // --- Tight: barely make it ---
  if (minsUntilLeave <= tightLimit && minsUntilLeave >= (forgiving ? -15 : -2)) {
    if (nav) actions.push(nav);
    if (taxiBtn) actions.push({ ...taxiBtn, label: 'Taxi — sicherer' });
    return {
      situation: 'tight',
      cardTitle: 'Knapp — jetzt handeln',
      speech:
        `Achtung: Es wird knapp für „${event.title}“. ` +
        `Fußweg ca. ${walk} Minuten. Route oder Taxi — beides als Button.`,
      bullets: [
        `Noch ~${Math.max(0, minsUntilLeave)} Min bis Leave-by`,
        `Fußweg ~${walk} Min`,
        `Abfahrt ${formatClockMs(plan.effectiveDepartureMs)}`,
      ],
      actions: actions.slice(0, 4),
    };
  }

  // --- Checkpoint-specific help ---
  const kind = trigger?.kind;
  const chainDest = resolveChainDestName(event);
  const leaveInMin = Math.max(0, minsUntilLeave);
  if (kind === 'leave' || (!trigger && minsUntilLeave <= 0)) {
    if (nav) actions.push(nav);
    if (taxiBtn && (mode === 'train' || mode === 'bus' || mode === 'flight')) {
      actions.push(taxiBtn);
    }
    actions.push({
      type: 'SHOW_MORE',
      label: 'Alles noch ok?',
      payload: {
        textPrompt: `Kurzer Statuscheck vor dem Aufbruch zu „${event.title}“ — Verspätung, Weghindernisse, Alternativen.`,
      },
    });
    const destLabel =
      cleanLeaveDestLabel(metaStr(event.meta, 'destName')) ||
      cleanLeaveDestLabel(event.title) ||
      'unser Ziel';
    const minsThere = Math.max(1, Math.round(walk + plan.arrivalBufferMin));
    const contextHint = resolveLeaveContextHint({ nowMs: now });
    const speech = buildLeaveReminderBody({
      mode,
      destName: destLabel,
      stationName: metaStr(event.meta, 'stationName'),
      line: mode === 'flight' || mode === 'bus' || mode === 'train' || mode === 'ferry'
        ? event.title
        : null,
      minutesUntilArrive: minsThere,
      minutesUntilLeave: null,
      chainDestName: chainDest,
      contextHint,
    });
    const travelBullet =
      mode === 'bike'
        ? `Rad ~${walk} Min`
        : mode === 'walk'
          ? `Fuß ~${walk} Min`
          : mode === 'taxi'
            ? `Taxi ~${walk} Min`
            : mode === 'train' || mode === 'bus' || mode === 'ferry'
              ? `ÖPNV · Zustieg ~${walk} Min`
              : `Weg ~${walk} Min`;
    return {
      situation: 'leave_now',
      cardTitle: 'Zeit aufzubrechen',
      speech,
      bullets: [
        `Los jetzt · ankommen ~${formatClockMs(plan.effectiveDepartureMs)}`,
        travelBullet,
        ...(chainDest ? [`Dann: ${chainDest}`] : []),
      ],
      actions: actions.slice(0, 4),
    };
  }

  if (kind === 'safety') {
    if (nav) actions.push(nav);
    if (taxiBtn && walk >= 20) actions.push(taxiBtn);
    const destLabel =
      cleanLeaveDestLabel(metaStr(event.meta, 'destName')) ||
      cleanLeaveDestLabel(event.title) ||
      event.title;
    const speech = buildLeaveReminderBody({
      mode,
      destName: destLabel,
      stationName: metaStr(event.meta, 'stationName'),
      line:
        mode === 'flight' || mode === 'bus' || mode === 'train' || mode === 'ferry'
          ? event.title
          : null,
      minutesUntilArrive: Math.max(1, Math.round(walk + plan.arrivalBufferMin)),
      minutesUntilLeave: leaveInMin > 0 ? leaveInMin : 30,
      chainDestName: chainDest,
      contextHint: null,
    });
    return {
      situation: 'safety',
      cardTitle: 'Gleich los',
      speech,
      bullets: [
        `Leave-by ${formatClockMs(plan.leaveByMs)}`,
        mode === 'walk'
          ? `Fuß ~${walk} Min`
          : mode === 'bike'
            ? `Rad ~${walk} Min`
            : mode === 'taxi'
              ? `Taxi`
              : mode === 'train' || mode === 'bus' || mode === 'ferry'
                ? `ÖPNV`
                : `Weg ~${walk} Min`,
        ...(chainDest ? [`Kette → ${chainDest}`] : []),
      ],
      actions: actions.slice(0, 4),
    };
  }

  if (kind === 'prep') {
    if (nav) actions.push(nav);
    if (taxiBtn && walk >= 25) {
      actions.push({ ...taxiBtn, label: 'Lieber Taxi?' });
    }
    actions.push({
      type: 'SHOW_MORE',
      label: 'Beste Verbindung prüfen',
      payload: {
        textPrompt: `Bereite „${event.title}“ vor: Live-Status, beste Route zum Bahnhof/Halt, Hindernisse, Plan B.`,
      },
    });
    return {
      situation: 'prep',
      cardTitle: 'Vorbereitung',
      speech:
        `In etwa einer Stunde musst du los für ${event.title}. ` +
        `Ich prüfe, ob die Verbindung pünktlich ist, und suche schon die beste Route. ` +
        `Wenn sie ausfällt, melde ich mich mit Taxi oder Alternativ-Bahn.`,
      bullets: [
        `Leave-by ${formatClockMs(plan.leaveByMs)}`,
        `Fußweg ~${walk} Min`,
      ],
      actions: actions.slice(0, 4),
    };
  }

  if (kind === 'coarse') {
    actions.push({
      type: 'SHOW_MORE',
      label: 'Früh-Status',
      payload: {
        textPrompt: `Grob-Check für „${event.title}“: fährt noch, Verspätung, Ausfall?`,
      },
    });
    if (nav) actions.push(nav);
    return {
      situation: 'coarse',
      cardTitle: 'Grob-Check',
      speech:
        `Kurzer Blick voraus auf ${event.title}: soweit alles geplant. ` +
        `Ich bleibe dran — bei Ausfall oder wenn du weit wegläufst, ziehe ich den Trigger von allein nach vorne.`,
      bullets: [
        `Abfahrt ${formatClockMs(plan.effectiveDepartureMs)}`,
        `Leave-by ${formatClockMs(plan.leaveByMs)}`,
      ],
      actions: actions.slice(0, 4),
    };
  }

  // default on track
  if (nav) actions.push(nav);
  return {
    situation: 'on_track',
    cardTitle: event.title,
    speech: `${event.title} ist im Blick — Leave-by ${formatClockMs(plan.leaveByMs)}.`,
    bullets: [`Leave-by ${formatClockMs(plan.leaveByMs)}`],
    actions: actions.slice(0, 3),
  };
}

async function presentVerdict(verdict: GuardianVerdict): Promise<void> {
  const now = Date.now();
  if (now - lastGuardianPresentMs < GUARDIAN_PRESENT_GAP_MS) {
    // Still allow cancelled / taxi_cancelled / leave_now through
    if (
      verdict.situation !== 'cancelled' &&
      verdict.situation !== 'taxi_cancelled' &&
      verdict.situation !== 'leave_now' &&
      verdict.situation !== 'tight'
    ) {
      return;
    }
  }
  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isGenerating) {
    // Critical disruptions still try to surface as card without blocking forever
    if (
      verdict.situation !== 'cancelled' &&
      verdict.situation !== 'taxi_cancelled'
    ) {
      return;
    }
  }
  lastGuardianPresentMs = now;
  const response: GeminiConciergeResponse = {
    speechText: verdict.speech,
    cardTitle: verdict.cardTitle,
    visualBullets: verdict.bullets,
    quickActions: verdict.actions,
  };
  await presentConciergeResponse(response);
}

/**
 * Fire a checkpoint with full helper offers (Route / Taxi / Plan B).
 */
export async function presentCheckpointHelp(
  trigger: LogisticsTrigger,
): Promise<void> {
  const event = useLogisticsTriggerStore
    .getState()
    .events.find((e) => e.id === trigger.eventId);
  if (!event || event.status !== 'active') return;

  // Reiner Wecker: ÖPNV-Lage am verknüpften Leave-Event prüfen — kein „losgehen“-Speech
  if (event.kind === 'alarm') {
    const leaveBy = metaNum(event.meta, 'leaveByMs');
    if (leaveBy == null) return; // reiner Aufsteh-Wecker: nur native Alarm
    const linked = useLogisticsTriggerStore
      .getState()
      .events.find(
        (e) =>
          e.id !== event.id &&
          e.status === 'active' &&
          metaNum(e.meta, 'linkedWakeAtMs') != null &&
          (e.id === metaStr(event.meta, 'linkedEventId') ||
            Math.abs((metaNum(e.meta, 'leaveByMs') ?? 0) - leaveBy) < 120_000),
      );
    if (!linked) return;
    const conn = connectionStatusOf(linked);
    if (conn === 'cancelled' || conn === 'missed' || conn === 'delayed') {
      const verdict = assessLogisticsHelp({ event: linked, trigger });
      if (
        verdict.situation === 'cancelled' ||
        verdict.situation === 'delayed' ||
        verdict.situation === 'tight'
      ) {
        const hour = new Date().getHours();
        if (hour >= 6 && hour < 22) {
          await presentVerdict(verdict);
        }
        if (conn === 'cancelled' || conn === 'missed') {
          void probeAlternativeIfNeeded(linked.id);
        }
      }
    }
    return;
  }

  const liveWalk = await currentWalkEtaMin(event);
  const storedWalk = metaNum(event.meta, 'walkEtaMin') ?? trigger.walkEtaMin;
  let rescheduleWalk: number | undefined;
  if (
    liveWalk != null &&
    storedWalk != null &&
    liveWalk >= storedWalk + WALK_DRIFT_RESCHEDULE_MIN
  ) {
    rescheduleWalk = liveWalk;
    applyWalkDriftReschedule(event, liveWalk);
  }

  const verdict = assessLogisticsHelp({
    event: useLogisticsTriggerStore
      .getState()
      .events.find((e) => e.id === event.id)!,
    trigger,
    walkEtaMin: rescheduleWalk ?? liveWalk ?? storedWalk,
  });

  if (rescheduleWalk != null && verdict.situation === 'on_track') {
    verdict.situation = 'user_drifted';
    verdict.speech =
      `Du bist weiter weg als gedacht — Fußweg jetzt ca. ${rescheduleWalk} Minuten. ` +
      `Ich habe den Aufbruch nach vorne gezogen (Leave-by ${formatClockMs(
        metaNum(
          useLogisticsTriggerStore.getState().events.find((e) => e.id === event.id)
            ?.meta,
          'leaveByMs',
        ) ?? Date.now(),
      )}). ` + verdict.speech;
    verdict.cardTitle = 'Standort geändert — früher los';
  }

  // Mikro-Check: alles ok → still wieder „schlafen“, kein Spam
  // Auch situation „prep“/„safety“ bei micro: NIE sprechen (Leak: 1h-vor-Wecker)
  const isMicro =
    trigger.alertLevel === 'silent' ||
    trigger.kind === 'coarse' ||
    (trigger.kind === 'prep' && /mikro/i.test(trigger.title));
  const acute =
    verdict.situation === 'cancelled' ||
    verdict.situation === 'taxi_cancelled' ||
    verdict.situation === 'tight' ||
    verdict.situation === 'delayed' ||
    verdict.situation === 'user_drifted' ||
    verdict.situation === 'leave_now';

  if (isMicro && !acute) {
    return; // passt — wieder schlafen (kein „in einer Stunde musst du los“)
  }

  await presentVerdict(verdict);
}

function applyWalkDriftReschedule(
  event: LogisticsEvent,
  newWalkEtaMin: number,
): void {
  const delayMin = metaNum(event.meta, 'delayMin') ?? 0;
  const baseDeparture =
    metaNum(event.meta, 'baseDepartureMs') ??
    (event.atMs != null ? event.atMs - delayMin * 60_000 : null);
  if (baseDeparture == null) return;

  const mode =
    (metaStr(event.meta, 'mode') as LogisticsMode | null) ?? 'generic';
  const dest = destOf(event);

  const { leaveByMs, triggers } = useLogisticsTriggerStore
    .getState()
    .upsertDepartureWatch({
      eventId: event.id,
      title: event.title,
      departureMs: baseDeparture,
      walkEtaMin: newWalkEtaMin,
      mode,
      stationName: metaStr(event.meta, 'stationName'),
      delayMin,
      externalId: event.externalId,
      detail: `Weg aktualisiert: ${newWalkEtaMin} Min (du bist weiter weg)`,
      destLat: dest?.lat,
      destLng: dest?.lng,
      destName: dest?.name ?? metaStr(event.meta, 'destName'),
      connectionStatus: connectionStatusOf(event),
    });

  const buffer =
    triggers.find((t) => t.kind === 'leave')?.arrivalBufferMin ?? undefined;
  const departureMs = baseDeparture + delayMin * 60_000;
  const key = event.externalId ?? event.id;
  if (mode === 'flight') {
    void scheduleFlightDepartureReminder({
      departureMs,
      walkEtaMinutes: newWalkEtaMin,
      flightLabel: event.title,
      safetyBufferMin: buffer,
      reminderKey: `logistics:${key}`,
    });
  } else {
    void scheduleLeaveByReminder({
      departureMs,
      walkEtaMinutes: newWalkEtaMin,
      mode,
      title: event.title,
      destName: dest?.name ?? metaStr(event.meta, 'destName') ?? event.title,
      stationName:
        mode === 'bus' || mode === 'train' || mode === 'ferry'
          ? (metaStr(event.meta, 'stationName') ?? undefined)
          : undefined,
      line:
        mode === 'bus' || mode === 'train' || mode === 'ferry'
          ? event.title
          : undefined,
      safetyBufferMin: buffer,
      reminderKey: `logistics:${key}`,
    });
  }
  void leaveByMs;

  // Verknüpften Wecker-Rhythmus mitziehen (Prep vor Leave-by)
  void import('./linkedWakeSync').then(({ syncLinkedWakeToLeaveBy }) =>
    syncLinkedWakeToLeaveBy({
      eventId: event.id,
      newLeaveByMs: leaveByMs,
    }),
  );
}

/**
 * Background: refresh walk ETA for all active departure watches; pull triggers forward.
 */
export async function tickLogisticsGuardian(opts?: {
  nowMs?: number;
}): Promise<{ rescheduled: number; alerts: number }> {
  const now = opts?.nowMs ?? Date.now();
  const store = useLogisticsTriggerStore.getState();
  if (!store.hydrated) return { rescheduled: 0, alerts: 0 };

  let rescheduled = 0;
  let alerts = 0;

  for (const event of store.getActiveEvents()) {
    if (
      event.kind !== 'flight' &&
      event.kind !== 'train' &&
      event.kind !== 'bus' &&
      event.kind !== 'session'
    ) {
      // Still handle taxi cancels on reminders
      if (taxiStatusOf(event) === 'cancelled') {
        const verdict = assessLogisticsHelp({ event, nowMs: now });
        await presentVerdict(verdict);
        alerts += 1;
      }
      continue;
    }

    const liveWalk = await currentWalkEtaMin(event);
    const storedWalk = metaNum(event.meta, 'walkEtaMin');
    if (
      liveWalk != null &&
      storedWalk != null &&
      liveWalk >= storedWalk + WALK_DRIFT_RESCHEDULE_MIN
    ) {
      applyWalkDriftReschedule(event, liveWalk);
      rescheduled += 1;

      // Proactive nudge if leave-by moved a lot
      const leaveBy = metaNum(
        useLogisticsTriggerStore.getState().events.find((e) => e.id === event.id)
          ?.meta,
        'leaveByMs',
      );
      if (leaveBy != null && leaveBy - now < 50 * 60_000) {
        const refreshed = useLogisticsTriggerStore
          .getState()
          .events.find((e) => e.id === event.id);
        if (refreshed) {
          const verdict = assessLogisticsHelp({
            event: refreshed,
            walkEtaMin: liveWalk,
            nowMs: now,
          });
          const dest = destOf(refreshed);
          // Ohne plausibles Ziel (Wecker / Stale-Coords) keine Explore-Hijack-Card
          if (!dest) {
            continue;
          }
          verdict.situation = 'user_drifted';
          verdict.cardTitle = 'Du bist weiter weg';
          verdict.speech =
            `Du bist weiter vom Ziel entfernt — Fußweg jetzt ca. ${liveWalk} Minuten. ` +
            `Ich habe den Trigger nach vorne gesetzt. Leave-by: ${formatClockMs(
              leaveBy,
            )}. Route oder Taxi — beides als Button.`;
          verdict.actions = [
            buildNavAction(dest),
            buildTaxiAction(dest),
          ].filter(Boolean) as QuickAction[];
          await presentVerdict(verdict);
          alerts += 1;
        }
      }
    }

    // Trödel-Nudge: Leave-by bald, Fußweg knapper als Restzeit → automatisch Bescheid
    {
      const leaveBy = metaNum(event.meta, 'leaveByMs');
      const walk = liveWalk ?? storedWalk;
      const lastDawdle = metaNum(event.meta, 'lastDawdleAlertAtMs') ?? 0;
      const forgiving =
        metaStr(event.meta, 'deadlineSoftness') === 'forgiving' ||
        metaStr(event.meta, 'mode') === 'car';
      // Parken: seltener nachhaken; Bahn: enger
      const dawdleCooldown = forgiving ? 18 * 60_000 : 8 * 60_000;
      const dawdleWindowMax = forgiving ? 14 : 22;
      // Slack: Parken erst wenn schon ~8 Min „zu spät“ zur Walk-Zeit; Bahn bei ≤3 Min
      const slackLimit = forgiving ? -8 : 3;
      if (
        leaveBy != null &&
        walk != null &&
        walk > 0 &&
        now - lastDawdle > dawdleCooldown
      ) {
        const untilLeaveMin = (leaveBy - now) / 60_000;
        const slack = untilLeaveMin - walk;
        if (
          untilLeaveMin > (forgiving ? -12 : 0) &&
          untilLeaveMin <= dawdleWindowMax &&
          slack <= slackLimit
        ) {
          const refreshed = useLogisticsTriggerStore
            .getState()
            .events.find((e) => e.id === event.id);
          if (refreshed) {
            useLogisticsTriggerStore.getState().upsertEvent({
              id: refreshed.id,
              kind: refreshed.kind,
              title: refreshed.title,
              detail: refreshed.detail,
              atMs: refreshed.atMs,
              lat: refreshed.lat,
              lng: refreshed.lng,
              status: 'active',
              externalId: refreshed.externalId,
              meta: {
                ...(refreshed.meta ?? {}),
                lastDawdleAlertAtMs: now,
              },
            });
            const dest = destOf(refreshed);
            const plat = metaStr(refreshed.meta, 'platform');
            const verdict = assessLogisticsHelp({
              event: refreshed,
              walkEtaMin: walk,
              nowMs: now,
            });
            verdict.situation = 'leave_now';
            verdict.cardTitle = forgiving
              ? 'Richtung Auto'
              : 'Zeit zum Losgehen';
            verdict.speech = forgiving
              ? `Kurz zum Parken: Fußweg zurück ca. ${Math.round(
                  walk,
                )} Minuten — Ticket-Zeit wird eng, aber ein paar Minuten Spielraum sind ok. Wenn du willst, starte ich die Route.`
              : `Hey — für ${refreshed.title} wird's eng: noch ca. ${Math.max(
                  0,
                  Math.round(untilLeaveMin),
                )} Minuten bis Aufbruch, Fußweg ~${Math.round(walk)} Minuten.` +
                (plat ? ` Aktuell Gleis ${plat}.` : '') +
                ` Am besten jetzt los.`;
            if (dest) {
              verdict.actions = forgiving
                ? ([buildNavAction(dest)].filter(Boolean) as QuickAction[])
                : ([
                    buildNavAction(dest),
                    buildTaxiAction(dest),
                  ].filter(Boolean) as QuickAction[]);
            }
            await presentVerdict(verdict);
            alerts += 1;
          }
        }
      }
    }

    if (
      connectionStatusOf(event) === 'cancelled' ||
      taxiStatusOf(event) === 'cancelled'
    ) {
      const verdict = assessLogisticsHelp({ event, nowMs: now });
      await presentVerdict(verdict);
      alerts += 1;
    }
  }

  return { rescheduled, alerts };
}

/**
 * Live-Disruption melden (Ausfall / Verspätung) — z. B. aus Transit-Poll.
 */
export function reportConnectionDisruption(input: {
  eventId: string;
  status: ConnectionStatus;
  delayMin?: number;
  note?: string;
}): void {
  const store = useLogisticsTriggerStore.getState();
  const event = store.events.find((e) => e.id === input.eventId);
  if (!event) return;

  store.upsertEvent({
    id: event.id,
    kind: event.kind,
    title: event.title,
    detail: input.note ?? event.detail,
    atMs: event.atMs,
    lat: event.lat,
    lng: event.lng,
    status: 'active',
    externalId: event.externalId,
    meta: {
      ...(event.meta ?? {}),
      connectionStatus: input.status,
      delayMin: input.delayMin ?? metaNum(event.meta, 'delayMin') ?? 0,
    },
  });

  if (input.status === 'delayed' || input.delayMin != null) {
    store.updateDelay(
      input.eventId,
      input.delayMin ?? metaNum(event.meta, 'delayMin') ?? 0,
      metaNum(event.meta, 'walkEtaMin') ?? undefined,
    );
    const refreshed = useLogisticsTriggerStore
      .getState()
      .events.find((e) => e.id === input.eventId);
    const newLeave = metaNum(refreshed?.meta, 'leaveByMs');
    if (newLeave != null) {
      void import('./linkedWakeSync').then(({ syncLinkedWakeToLeaveBy }) =>
        syncLinkedWakeToLeaveBy({
          eventId: input.eventId,
          newLeaveByMs: newLeave,
        }),
      );
    }
  }

  if (input.status === 'cancelled' || input.status === 'missed') {
    const refreshed = useLogisticsTriggerStore
      .getState()
      .events.find((e) => e.id === input.eventId);
    if (refreshed) {
      const leaveBy = metaNum(refreshed.meta, 'leaveByMs') ?? refreshed.atMs ?? Date.now();
      void import('./linkedWakeSync').then(
        async ({ hasHardAppointmentAfter }) => {
          const hard = hasHardAppointmentAfter(leaveBy);
          // Nachts / ohne festen Termin: still umbuchen, erst morgens erklären
          const hour = new Date().getHours();
          const quietNight = hour < 6 || hour >= 22;
          if (!hard && quietNight) {
            void probeAlternativeIfNeeded(input.eventId);
            return;
          }
          void presentVerdict(assessLogisticsHelp({ event: refreshed }));
          void probeAlternativeIfNeeded(input.eventId);
        },
      );
    }
  } else if (input.status === 'delayed') {
    const refreshed = useLogisticsTriggerStore
      .getState()
      .events.find((e) => e.id === input.eventId);
    if (!refreshed) return;
    const hour = new Date().getHours();
    const quietNight = hour < 6 || hour >= 22;
    const leaveBy = metaNum(refreshed.meta, 'leaveByMs') ?? refreshed.atMs ?? 0;
    // Nachts + Wecker verknüpft: still länger schlafen lassen, kein Speech
    if (quietNight && metaNum(refreshed.meta, 'linkedWakeAtMs') != null) {
      return;
    }
    void import('./linkedWakeSync').then(({ hasHardAppointmentAfter }) => {
      if (quietNight && !hasHardAppointmentAfter(leaveBy)) return;
      void presentVerdict(assessLogisticsHelp({ event: refreshed }));
    });
  }
}

/**
 * Taxi-Buchung tracken / Storno → Plan B.
 */
export function reportTaxiStatus(input: {
  eventId: string;
  status: TaxiStatus;
  destLat?: number;
  destLng?: number;
  destName?: string;
}): void {
  const store = useLogisticsTriggerStore.getState();
  const event = store.events.find((e) => e.id === input.eventId);
  if (!event) {
    store.upsertEvent({
      id: input.eventId,
      kind: 'reminder',
      title: input.destName ?? 'Taxi',
      atMs: Date.now(),
      lat: input.destLat ?? null,
      lng: input.destLng ?? null,
      status: 'active',
      meta: {
        taxiStatus: input.status,
        destLat: input.destLat ?? null,
        destLng: input.destLng ?? null,
        destName: input.destName ?? null,
      },
    });
  } else {
    store.upsertEvent({
      id: event.id,
      kind: event.kind,
      title: event.title,
      detail: event.detail,
      atMs: event.atMs,
      lat: input.destLat ?? event.lat,
      lng: input.destLng ?? event.lng,
      status: event.status,
      externalId: event.externalId,
      meta: {
        ...(event.meta ?? {}),
        taxiStatus: input.status,
        destLat: input.destLat ?? metaNum(event.meta, 'destLat'),
        destLng: input.destLng ?? metaNum(event.meta, 'destLng'),
        destName: input.destName ?? metaStr(event.meta, 'destName'),
      },
    });
  }

  if (input.status === 'cancelled') {
    const refreshed = useLogisticsTriggerStore
      .getState()
      .events.find((e) => e.id === input.eventId);
    if (refreshed) {
      void presentVerdict(assessLogisticsHelp({ event: refreshed }));
    }
  }
}

/**
 * Optional: at prep/safety, try next ÖPNV if we have coords (enrich cancel detection).
 * <10 Min → stilles Umbuchen (gleiche Linie). ≥10 Min → aktiver Prompt.
 * Fastest nur wenn >15 Min früher am Ziel.
 */
export async function probeAlternativeIfNeeded(
  eventId: string,
): Promise<void> {
  const event = useLogisticsTriggerStore
    .getState()
    .events.find((e) => e.id === eventId);
  if (!event) return;
  const dest = destOf(event);
  const gps = useGpsStore.getState();
  if (
    !dest ||
    gps.lat == null ||
    gps.lng == null ||
    connectionStatusOf(event) === 'ok'
  ) {
    return;
  }
  if (
    connectionStatusOf(event) !== 'cancelled' &&
    connectionStatusOf(event) !== 'missed'
  ) {
    return;
  }
  // Already riding — don't rebook
  if (getNavPhase() === 'in_transit') return;

  try {
    const preferLine =
      metaStr(event.meta, 'line') ||
      metaStr(event.meta, 'firstTransitLine') ||
      event.title;
    const pick = await recalculateMissedConnection({
      from: { lat: gps.lat, lng: gps.lng },
      to: { lat: dest.lat, lng: dest.lng },
      preferLine,
      missedLineLabel: preferLine,
    });
    if (!pick.primary) return;
    const next = pick.primary;
    const nextDep = next.firstTransitDeparture;
    if (!nextDep) return;
    const leaveHint = formatClockMs(nextDep.getTime());
    const walk =
      metaNum(event.meta, 'walkEtaMin') ??
      (await currentWalkEtaMin(event)) ??
      10;

    // Silent rebook: UI + optional short ping, no Plan-B interrogation
    if (pick.mode === 'silent_same_line') {
      const { leaveByMs } = useLogisticsTriggerStore.getState().upsertDepartureWatch({
        eventId: event.id,
        title: event.title,
        departureMs: nextDep.getTime(),
        walkEtaMin: walk,
        mode:
          (metaStr(event.meta, 'mode') as
            | 'train'
            | 'bus'
            | 'flight'
            | 'ferry'
            | 'generic'
            | null) ?? 'train',
        stationName: metaStr(event.meta, 'stationName'),
        destLat: dest.lat,
        destLng: dest.lng,
        destName: dest.name,
        connectionStatus: 'ok',
        detail: formatMissedSilentHud(pick),
        delayMin: 0,
        warnLeadMin:
          typeof event.meta?.warnLeadMin === 'number'
            ? event.meta.warnLeadMin
            : undefined,
        planPriority:
          typeof event.meta?.planPriority === 'number'
            ? event.meta.planPriority
            : null,
      });
      const clock = formatClockMs(nextDep.getTime());
      const hour = new Date().getHours();
      const quietNight = hour < 6 || hour >= 22;
      const morningNote = quietNight
        ? `Deine Bahn ist ausgefallen. Nächste sinnvolle Verbindung um ${clock} — deshalb hast du länger geschlafen.`
        : null;
      void import('./linkedWakeSync').then(({ syncLinkedWakeToLeaveBy }) =>
        syncLinkedWakeToLeaveBy({
          eventId: event.id,
          newLeaveByMs: leaveByMs,
          morningNote,
        }),
      );
      return;
    }

    const actions: QuickAction[] = [
      buildNavAction(dest),
      buildTaxiAction(dest, 'Taxi statt warten'),
      {
        type: 'SHOW_MORE',
        label: 'Warten — diese Verbindung',
        payload: {
          textPrompt: `Nimm die ${next.firstTransitLine || ''} um ${leaveHint} zu ${dest.name} — setze Leave-by und Reminder.`,
        },
      },
    ].filter(Boolean) as QuickAction[];

    const alt = pick.fastestAlternate;
    const altDep = alt?.firstTransitDeparture ?? null;
    if (alt && altDep) {
      const altHint = formatClockMs(altDep.getTime());
      actions.unshift({
        type: 'SHOW_MORE',
        label: `Schneller: ${alt.firstTransitLine || 'Alternative'} (~${pick.etaGainMin} Min früher)`,
        payload: {
          textPrompt:
            `Nimm die schnellere Alternative ${alt.firstTransitLine || ''} um ${altHint} ` +
            `statt ${waitMinLabel(pick.waitMinForPrimary)} auf ${next.firstTransitLine || 'gleiche Linie'} zu warten ` +
            `(~${pick.etaGainMin} Min früher am Ziel).`,
        },
      });
    }

    await presentVerdict({
      situation: 'cancelled',
      cardTitle:
        pick.mode === 'active_prompt'
          ? 'Bahn weg — warten oder Alternative?'
          : 'Plan B — nächste Verbindung',
      speech:
        pick.promptSpeech ||
        `Die ursprüngliche Verbindung fällt aus. Nächste Option: ` +
          `${next.firstTransitLine || 'ÖPNV'} um ${leaveHint}. ` +
          `Route oder Taxi — beides als Button.`,
      bullets: [
        `Nächste: ${next.firstTransitLine || 'ÖPNV'} ${leaveHint} (Wartezeit ~${pick.waitMinForPrimary} Min)`,
        pick.fastestAlternate
          ? `Schnellere Alt: ${pick.fastestAlternate.firstTransitLine || 'ÖPNV'} (~${pick.etaGainMin} Min früher)`
          : pick.sameLineFound
            ? 'Gleiche Linie priorisiert (am Gleis bleiben)'
            : 'Live-Plan',
        next.durationSec != null
          ? `Dauer ~${Math.round(next.durationSec / 60)} Min`
          : '—',
      ],
      actions: actions.slice(0, 4),
    });
  } catch {
    /* soft-fail */
  }
}

function waitMinLabel(n: number): string {
  return n === 1 ? '1 Minute' : `${n} Minuten`;
}
