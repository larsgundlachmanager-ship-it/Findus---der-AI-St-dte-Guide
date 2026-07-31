/**
 * FlightAware Delta-Patch — kein voller Reverse-Schedule bei Polls.
 * Neu rechnen nur bei Δ Verspätung ≥5 Min oder Gate-Wechsel.
 * ±2 Min → still.
 */

import type { FlightStatus } from '../flights/FlightTrackingService';
import { useDayPlanStore } from '../../store/useDayPlanStore';
import { clockLabel, todayDateKey, uid } from '../../types/dayPlan';
import { bufferMinutesForKind, arriveByFromDeadline } from './bufferMath';
import { enqueueProactiveSpeech } from './proactiveSpeechQueue';

export type FlightDeltaState = {
  ident: string;
  departureMs: number;
  delayMin: number | null;
  gate: string | null;
  terminal: string | null;
  updatedAtMs: number;
};

const lastByIdent = new Map<string, FlightDeltaState>();

const NOISE_DELAY_MIN = 2;
const SIGNIFICANT_DELAY_DELTA_MIN = 5;

export function getLastFlightDelta(ident: string): FlightDeltaState | null {
  return lastByIdent.get(ident.replace(/\s+/g, '').toUpperCase()) ?? null;
}

export function rememberFlightDelta(state: FlightDeltaState): void {
  lastByIdent.set(state.ident.replace(/\s+/g, '').toUpperCase(), state);
}

export type FlightDeltaDecision =
  | { action: 'noop'; reason: string }
  | { action: 'patch'; reason: string; significant: boolean }
  | { action: 'full_resync'; reason: string };

/**
 * Entscheide: still / leicht patchen / voller Sync.
 */
export function decideFlightDelta(
  flight: FlightStatus,
  prev: FlightDeltaState | null,
): FlightDeltaDecision {
  const depart =
    flight.estimatedDeparture ?? flight.scheduledDeparture ?? null;
  if (!depart) return { action: 'noop', reason: 'no_depart' };

  const delayMin = flight.delayMin ?? 0;
  const gate = flight.departureGate ?? null;
  const terminal = flight.departureTerminal ?? null;

  if (!prev) {
    return { action: 'full_resync', reason: 'first_seen' };
  }

  const delayDelta = Math.abs(delayMin - (prev.delayMin ?? 0));
  const departDeltaMin = Math.abs(depart.getTime() - prev.departureMs) / 60_000;
  const gateChanged =
    (gate ?? '') !== (prev.gate ?? '') ||
    (terminal ?? '') !== (prev.terminal ?? '');

  // Rauschen ±2 Min
  if (
    delayDelta <= NOISE_DELAY_MIN &&
    departDeltaMin <= NOISE_DELAY_MIN &&
    !gateChanged
  ) {
    return { action: 'noop', reason: 'noise_±2min' };
  }

  // Signifikant: ≥5 Min oder Gate
  if (delayDelta >= SIGNIFICANT_DELAY_DELTA_MIN || gateChanged) {
    return {
      action: 'patch',
      reason: gateChanged ? 'gate_change' : `delay_delta_${delayDelta}`,
      significant: true,
    };
  }

  // 2–5 Min: still patchen ohne Speech
  return {
    action: 'patch',
    reason: `small_delta_${delayDelta.toFixed(1)}`,
    significant: false,
  };
}

/**
 * Leichtgewichtiger Timeline-Patch (Flug + Flughafen-Puffer).
 * Kein buildReverseScheduleFromDeadlineAsync.
 */
export function patchFlightIntoDayPlan(opts: {
  flight: FlightStatus;
  dateKey?: string;
  speak?: boolean;
}): { patched: boolean; summary: string | null } {
  const flight = opts.flight;
  const depart =
    flight.estimatedDeparture ?? flight.scheduledDeparture ?? null;
  if (!depart) return { patched: false, summary: null };

  const dateKey = opts.dateKey ?? todayDateKey();
  const store = useDayPlanStore.getState();
  const day = store.getDay(dateKey);
  const departureMs = depart.getTime();
  const delayMin = flight.delayMin ?? null;
  const gate = flight.departureGate ?? null;
  const terminal = flight.departureTerminal ?? null;

  const prev = getLastFlightDelta(flight.ident);
  const decision = decideFlightDelta(flight, prev);

  rememberFlightDelta({
    ident: flight.ident,
    departureMs,
    delayMin,
    gate,
    terminal,
    updatedAtMs: Date.now(),
  });

  if (decision.action === 'noop') {
    return { patched: false, summary: null };
  }

  const delayNote =
    delayMin != null && delayMin >= 5
      ? ` · +${delayMin} Min Verspätung (Live)`
      : '';
  const gateNote =
    gate || terminal
      ? ` · Gate/Terminal ${gate ?? '—'} / ${terminal ?? '—'}`
      : '';

  const existing = day.items.find(
    (i) =>
      i.kind === 'flight' &&
      (i.meta?.ident === flight.ident ||
        i.title.toUpperCase().includes(flight.ident)),
  );

  const bufferMin = bufferMinutesForKind('flight_commercial');
  const arriveAirportMs = arriveByFromDeadline(departureMs, bufferMin);

  store.upsertItem(dateKey, {
    id: existing?.id ?? uid('flight'),
    kind: 'flight',
    title: `Flug ${flight.ident} ${clockLabel(departureMs)}${delayNote}`,
    startMs: departureMs,
    endMs: departureMs + 10 * 60_000,
    timed: true,
    status: flight.cancelled ? 'skipped' : 'planned',
    hardDeadline: true,
    placeName: flight.originName ?? flight.originCode,
    source: 'module5',
    sortOrder: existing?.sortOrder ?? 200,
    notes: `${flight.status ?? ''}${gateNote}`.trim() || undefined,
    meta: {
      ident: flight.ident,
      delayMin,
      gate,
      terminal,
      type: 'flight_live',
    },
  });

  // Puffer-Fenster mitziehen
  const bufferItem = day.items.find(
    (i) =>
      i.kind === 'buffer' &&
      /flughafen/i.test(i.title) &&
      (i.meta?.ident === flight.ident || !i.meta?.ident),
  );
  if (bufferItem) {
    store.upsertItem(dateKey, {
      ...bufferItem,
      startMs: arriveAirportMs,
      endMs: departureMs,
      meta: { ...(bufferItem.meta ?? {}), ident: flight.ident },
    });
  }

  const summary = `Flug ${flight.ident}: ${clockLabel(departureMs)}${delayNote}${gateNote}`;

  if (decision.action === 'patch' && decision.significant) {
    store.addChange(dateKey, {
      summary,
      reason: `flightaware_delta:${decision.reason}`,
      significant: true,
    });
    if (opts.speak !== false) {
      enqueueProactiveSpeech({
        kind: 'flight',
        speech: summary,
        id: `flight:${flight.ident}`,
      });
    }
  }

  return { patched: true, summary };
}
