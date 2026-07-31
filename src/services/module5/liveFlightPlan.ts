/**
 * Live-Flug (FlightAware) → Modul-5 Timeline + Leave-by.
 */

import {
  fetchFlightByIdent,
  hasFlightAwareKey,
  type FlightStatus,
} from '../flights/FlightTrackingService';
import { useDayPlanStore } from '../../store/useDayPlanStore';
import { clockLabel, dateKeyFromMs, todayDateKey, uid } from '../../types/dayPlan';
import { bufferMinutesForKind, arriveByFromDeadline } from './bufferMath';
import { buildReverseScheduleFromDeadlineAsync } from './reverseScheduler';
import { scheduleModule5FollowUp } from './module5Priority';

const FLIGHT_CODE_RE = /\b([A-Z]{1,3}\s?\d{1,4}|LH\s?\d{2,4}|EW\s?\d{2,4}|FR\s?\d{2,4})\b/i;

export function extractFlightCode(text: string): string | null {
  const m = text.match(FLIGHT_CODE_RE);
  if (!m?.[1]) return null;
  return m[1].replace(/\s+/g, '').toUpperCase();
}

export async function syncLiveFlightIntoDayPlan(opts: {
  userText: string;
  dateKey?: string;
}): Promise<{ ok: boolean; summary: string | null }> {
  if (!hasFlightAwareKey()) {
    return {
      ok: false,
      summary:
        'FlightAware-Key fehlt (EXPO_PUBLIC_FLIGHTAWARE_API_KEY) — Flug live nicht abrufbar.',
    };
  }
  const code = extractFlightCode(opts.userText);
  if (!code && !/\b(flug|flieger|abflug)\b/iu.test(opts.userText)) {
    return { ok: false, summary: null };
  }

  let flight: FlightStatus | null = null;
  if (code) {
    flight = await fetchFlightByIdent(code);
  }
  if (!flight) {
    return {
      ok: false,
      summary: code
        ? `Flug ${code} gerade nicht gefunden.`
        : 'Keine Flugnummer erkannt.',
    };
  }

  const depart =
    flight.estimatedDeparture ??
    flight.scheduledDeparture ??
    null;
  if (!depart) {
    return { ok: false, summary: `Flug ${flight.ident}: keine Abflugzeit.` };
  }

  const flightIdent = flight.ident;
  const departureMs = depart.getTime();
  const delayMinSnap = flight.delayMin ?? null;
  const gateSnap = flight.departureGate ?? null;
  const terminalSnap = flight.departureTerminal ?? null;
  void import('./adaptiveFlightPoll').then(({ registerFlightWatch }) => {
    registerFlightWatch({
      ident: flightIdent,
      departureMs,
    });
  });
  void import('./flightDeltaPatch').then(({ rememberFlightDelta }) => {
    rememberFlightDelta({
      ident: flightIdent,
      departureMs,
      delayMin: delayMinSnap,
      gate: gateSnap,
      terminal: terminalSnap,
      updatedAtMs: Date.now(),
    });
  });

  const dateKey =
    opts.dateKey ?? dateKeyFromMs(departureMs) ?? todayDateKey();
  const store = useDayPlanStore.getState();
  const bufferMin = bufferMinutesForKind('flight_commercial');
  const arriveAirportMs = arriveByFromDeadline(departureMs, bufferMin);

  const delayNote =
    flight.delayMin != null && flight.delayMin >= 5
      ? ` · +${flight.delayMin} Min Verspätung (Live)`
      : '';
  const gate =
    flight.departureGate || flight.departureTerminal
      ? ` · Gate/Terminal ${flight.departureGate ?? '—'} / ${flight.departureTerminal ?? '—'}`
      : '';

  store.upsertItem(dateKey, {
    id: uid('flight'),
    kind: 'flight',
    title: `Flug ${flight.ident} ${clockLabel(departureMs)}${delayNote}`,
    startMs: departureMs,
    endMs: departureMs + 10 * 60_000,
    timed: true,
    status: flight.cancelled ? 'skipped' : 'planned',
    hardDeadline: true,
    placeName: flight.originName ?? flight.originCode,
    source: 'module5',
    sortOrder: 200,
    notes: [
      flight.status ? `Status: ${flight.status}` : null,
      flight.cancelled ? 'STORNIERT' : null,
      flight.diverted ? 'UMGELEITET' : null,
      gate.trim() || null,
      flight.destinationName
        ? `Ziel: ${flight.destinationName}`
        : null,
    ]
      .filter(Boolean)
      .join(' · '),
    meta: {
      ident: flight.ident,
      delayMin: flight.delayMin,
      gate: flight.departureGate,
      terminal: flight.departureTerminal,
    },
  });

  store.upsertItem(dateKey, {
    id: uid('fair'),
    kind: 'buffer',
    title: `Am Flughafen sein (${bufferMin} Min Puffer)`,
    startMs: arriveAirportMs,
    endMs: depart.getTime(),
    timed: true,
    status: 'planned',
    hardDeadline: true,
    source: 'module5',
    sortOrder: 190,
    bufferMin,
    notes: 'Security + Weg zum Gate — Findus plant rückwärts.',
  });

  // Volle Rückwärtskette Hotel → Flughafen
  try {
    const rev = await buildReverseScheduleFromDeadlineAsync({
      dateKey,
      deadlineMs: depart.getTime(),
      deadlineTitle: `Flug ${flight.ident}`,
      importance: 'flight',
      preferMode: 'auto',
      destName: flight.originName ?? 'Flughafen',
    });
    const cur = store.getDay(dateKey);
    const kept = cur.items.filter(
      (i) =>
        i.kind === 'flight' ||
        i.kind === 'parking' ||
        i.kind === 'weather' ||
        (i.kind === 'buffer' && i.title.includes('Flughafen')),
    );
    store.replaceItems(dateKey, [...kept, ...rev.items.filter((i) => !i.hardDeadline || i.kind === 'wake')]);
    // re-add flight deadline
    store.upsertItem(dateKey, {
      id: uid('flight'),
      kind: 'flight',
      title: `Flug ${flight.ident} ${clockLabel(depart.getTime())}${delayNote}`,
      startMs: depart.getTime(),
      endMs: depart.getTime() + 10 * 60_000,
      timed: true,
      status: 'planned',
      hardDeadline: true,
      source: 'module5',
      sortOrder: 200,
      notes: gate.trim() || undefined,
    });
    store.addChange(dateKey, {
      summary: `Live-Flug ${flight.ident} eingetragen`,
      reason: rev.speechSummary + delayNote,
      significant: true,
    });
    scheduleModule5FollowUp({
      speech:
        `Flug ${flight.ident} live: Abflug ${clockLabel(depart.getTime())}${delayNote}. ` +
        `Du solltest um ${clockLabel(arriveAirportMs)} am Flughafen sein. ${rev.speechSummary}`,
      actions: [
        {
          type: 'SET_WAKE_ALARM',
          label: `Wecker ${clockLabel(rev.wakeMs)}`,
          payload: {
            dateIso: rev.wakeMs
              ? new Date(rev.wakeMs).toISOString()
              : undefined,
            timeLabel: clockLabel(rev.wakeMs),
          },
        },
      ],
    });
  } catch {
    store.addChange(dateKey, {
      summary: `Flug ${flight.ident} live notiert`,
      reason: `Abflug ${clockLabel(depart.getTime())}${delayNote}${gate}`,
      significant: true,
    });
  }

  return {
    ok: true,
    summary: `Flug ${flight.ident} ${clockLabel(depart.getTime())}${delayNote}`,
  };
}
