/**
 * Abfahrt zum Essen: Leave-by aus GPS + Modus, Nav-Trigger + Erinnerungen.
 * Anreise = Gap-Fill (Fuß/Rad/ÖPNV) + Journey-Refine — keine Ein-Zeilen-Schätzung.
 */

import { haversineMeters } from '../../db/database';
import {
  getPlanBikeMPerMin,
  getPlanWalkMPerMin,
} from '../../services/mobility/paceProfile';
import { useFinnusStore } from '../../store/useFinnusStore';
import { registerDepartureWatch } from '../../services/logistics/logisticsTriggerEngine';
import type { Module2ActionButton } from '../types';
import { shortenActionLabel } from '../../services/concierge/actionLabelShorten';
import {
  useFuturePlanStore,
  type FuturePlanStop,
  type FuturePlanTransport,
} from './futurePlanState';
import { markFresh } from './planLiveEdits';
import { applyGapFillTravelLegs } from './gapFillTravel';
import { isLiveNavLegId } from './syncLiveNavToPlan';

const DINING_ARRIVE_EARLY_MIN = 5;

export type DepartureModeOption = {
  transport: FuturePlanTransport;
  travelMin: number;
  leaveByMs: number;
  label: string;
  emoji: string;
};

function ceilTravelMin(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mPerMin: number,
): number {
  const dist = haversineMeters(from.lat, from.lng, to.lat, to.lng);
  return Math.max(3, Math.ceil(dist / Math.max(1, mPerMin)));
}

function snapDown5(ms: number): number {
  const d = new Date(ms);
  const m = d.getMinutes();
  d.setMinutes(m - (m % 5), 0, 0);
  return d.getTime();
}

function formatHm(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Bis zu 2 realistische Modi (Fuß / Rad / ggf. ÖPNV). */
export function computeDiningDepartureOptions(opts: {
  destLat: number;
  destLng: number;
  appointmentMs: number;
  originLat?: number | null;
  originLng?: number | null;
}): DepartureModeOption[] {
  const store = useFinnusStore.getState();
  const originLat = opts.originLat ?? store.lastGpsLat;
  const originLng = opts.originLng ?? store.lastGpsLng;
  if (
    originLat == null ||
    originLng == null ||
    !Number.isFinite(originLat) ||
    !Number.isFinite(originLng)
  ) {
    return [];
  }
  const from = { lat: originLat, lng: originLng };
  const to = { lat: opts.destLat, lng: opts.destLng };
  const arriveBy = opts.appointmentMs - DINING_ARRIVE_EARLY_MIN * 60_000;

  const walkMin = ceilTravelMin(from, to, getPlanWalkMPerMin());
  const bikeMin = ceilTravelMin(from, to, getPlanBikeMPerMin());
  const distM = haversineMeters(from.lat, from.lng, to.lat, to.lng);

  const candidates: DepartureModeOption[] = [
    {
      transport: 'walk',
      travelMin: walkMin,
      leaveByMs: snapDown5(arriveBy - walkMin * 60_000),
      label: 'zu Fuß',
      emoji: '🚶',
    },
    {
      transport: 'bike',
      travelMin: bikeMin,
      leaveByMs: snapDown5(arriveBy - bikeMin * 60_000),
      label: 'Fahrrad',
      emoji: '🚲',
    },
  ];

  // ÖPNV nur wenn Fuß weit (> ~35 Min) und Distanz > 2,5 km
  if (walkMin >= 35 && distM >= 2500) {
    const transitMin = Math.max(12, Math.ceil(walkMin * 0.45));
    candidates.push({
      transport: 'transit',
      travelMin: transitMin,
      leaveByMs: snapDown5(arriveBy - transitMin * 60_000),
      label: 'ÖPNV',
      emoji: '🚌',
    });
  }

  const ranked = [...candidates].sort((a, b) => {
    const score = (o: DepartureModeOption) => {
      let s = o.travelMin;
      if (o.transport === 'walk' && o.travelMin <= 25) s -= 4;
      if (o.transport === 'bike' && o.travelMin <= 20) s -= 2;
      if (o.leaveByMs < Date.now() + 2 * 60_000) s += 40;
      return s;
    };
    return score(a) - score(b);
  });

  return ranked.slice(0, 2);
}

function findApproachLegForStop(stopId: string): FuturePlanStop | null {
  const stops = useFuturePlanStore.getState().plan.stops;
  const direct =
    stops.find((s) => s.id === `nav_here_${stopId}`) ||
    stops.find(
      (s) =>
        s.kind === 'nav_leg' &&
        !isLiveNavLegId(s.id) &&
        (s.id === `leave_${stopId}_walk` ||
          s.id === `leave_${stopId}_bike` ||
          s.id === `leave_${stopId}_transit` ||
          s.id.endsWith(`_${stopId}`)),
    );
  if (direct) return direct;
  const group = stops.find(
    (s) =>
      s.kind === 'nav_leg' &&
      (s.groupId === `nav_here_${stopId}` ||
        s.groupId?.endsWith(`_${stopId}`)),
  );
  if (!group?.groupId) return null;
  const members = stops
    .filter((s) => s.groupId === group.groupId && s.kind === 'nav_leg')
    .sort(
      (a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0),
    );
  return members[0] ?? group;
}

/**
 * Trägt Gap-Fill-Anreise + Departure-Watch ein.
 * ÖPNV → Bein-Gruppe nach Refine; Fuß/Rad → geroutetes Nav-Leg.
 */
export function applyDiningDeparturePlan(opts: {
  stopId: string;
  venueTitle: string;
  destLat: number;
  destLng: number;
  appointmentMs: number;
  preferredTransport?: FuturePlanTransport | null;
}): {
  options: DepartureModeOption[];
  primary: DepartureModeOption | null;
  buttons: Module2ActionButton[];
  speechFacts: string[];
} {
  const options = computeDiningDepartureOptions({
    destLat: opts.destLat,
    destLng: opts.destLng,
    appointmentMs: opts.appointmentMs,
  });
  if (!options.length) {
    // Trotzdem Gap-Fill versuchen (GPS evtl. später)
    try {
      applyGapFillTravelLegs({
        preferredTransport: opts.preferredTransport ?? null,
      });
    } catch {
      /* soft */
    }
    return { options: [], primary: null, buttons: [], speechFacts: [] };
  }

  const preferred =
    (opts.preferredTransport &&
      options.find((o) => o.transport === opts.preferredTransport)) ||
    options[0]!;
  let primary = preferred;

  // Alte Schätz-Leave-Legs weg — Gap-Fill ist SSOT
  const store = useFuturePlanStore.getState();
  const cleaned = store.plan.stops.filter(
    (s) => !(s.kind === 'nav_leg' && s.id.startsWith(`leave_${opts.stopId}_`)),
  );
  if (cleaned.length !== store.plan.stops.length) {
    store.setPlan({ ...store.plan, stops: cleaned });
  }

  try {
    applyGapFillTravelLegs({
      preferredTransport: preferred.transport,
    });
  } catch {
    /* soft */
  }

  const approach = findApproachLegForStop(opts.stopId);
  if (approach?.plannedStartMs != null) {
    const travelMin = Math.max(
      1,
      Math.round(
        ((approach.plannedEndMs ?? approach.plannedStartMs) -
          approach.plannedStartMs) /
          60_000,
      ),
    );
    primary = {
      transport: approach.transport || preferred.transport,
      travelMin,
      leaveByMs: approach.plannedStartMs,
      label:
        approach.transport === 'transit'
          ? 'ÖPNV'
          : approach.transport === 'bike'
            ? 'Fahrrad'
            : 'zu Fuß',
      emoji:
        approach.emoji ||
        (approach.transport === 'transit'
          ? '🚌'
          : approach.transport === 'bike'
            ? '🚲'
            : '🚶'),
    };
  }

  markFresh([
    approach?.id,
    approach?.groupId,
    opts.stopId,
  ].filter(Boolean) as string[]);

  // Erinnerungen: Prio 1–2 → 30 Min Lead; Prio 3–4 → 5; Prio 5–6 → kein Push
  try {
    const venue = opts.venueTitle.replace(/^Essen:\s*/i, '').trim();
    const mode =
      primary.transport === 'walk'
        ? ('walk' as const)
        : primary.transport === 'bike'
          ? ('bike' as const)
          : primary.transport === 'transit'
            ? ('bus' as const)
            : primary.transport === 'car'
              ? ('car' as const)
              : primary.transport === 'taxi'
                ? ('taxi' as const)
                : ('generic' as const);
    const mealStop = useFuturePlanStore
      .getState()
      .plan.stops.find((s) => s.id === opts.stopId);
    const prio = (mealStop?.planPriority ?? 3) as number;
    if (prio <= 4) {
      const warnLeadMin = prio <= 2 ? 30 : 5;
      void registerDepartureWatch({
        eventId: `plan_${opts.stopId}`,
        title: venue,
        departureMs: opts.appointmentMs,
        walkEtaMin: primary.travelMin,
        mode,
        destLat: opts.destLat,
        destLng: opts.destLng,
        destName: venue,
        detail: `${primary.label} · Leave ${formatHm(primary.leaveByMs)}`,
        warnLeadMin,
        planPriority: prio,
        scheduleOsPush: true,
      });
    }
    try {
      const { useLogisticsTriggerStore } = require('../../store/useLogisticsTriggerStore') as {
        useLogisticsTriggerStore: {
          getState: () => { cancelEvent: (id: string) => void };
        };
      };
      useLogisticsTriggerStore.getState().cancelEvent(`dining_${opts.stopId}`);
    } catch {
      /* soft */
    }
  } catch {
    /* soft — Logistics optional */
  }

  const buttons: Module2ActionButton[] = options.map((o, i) => ({
    id: `leave_mode_${o.transport}`,
    label: shortenActionLabel(
      `${o.emoji} ${formatHm(o.leaveByMs)} ${o.label === 'zu Fuß' ? 'Fuß' : o.label === 'Fahrrad' ? 'Rad' : 'ÖPNV'}`,
    ),
    payload: {
      kind: 'ui',
      action: 'set_dining_leave_mode',
      data: {
        stopId: opts.stopId,
        transport: o.transport,
        venueTitle: opts.venueTitle,
        destLat: opts.destLat,
        destLng: opts.destLng,
        appointmentMs: opts.appointmentMs,
        pick: i === 0 ? 'A' : 'B',
      },
    },
  }));

  const speechFacts = [
    `Termin ${formatHm(opts.appointmentMs)} · Ankunft ~5 Min früher`,
    ...options.map(
      (o) =>
        `${o.emoji} ${o.label}: ~${o.travelMin} Min → Los ${formatHm(o.leaveByMs)}`,
    ),
    `Primär eingetragen: ${primary.emoji} ${primary.label} ab ${formatHm(primary.leaveByMs)} (Detail-Route folgt).`,
  ];

  return { options, primary, buttons, speechFacts };
}

/** Modus wechseln (Button Fuß/Rad). */
export function switchDiningLeaveMode(opts: {
  stopId: string;
  transport: FuturePlanTransport;
  venueTitle: string;
  destLat: number;
  destLng: number;
  appointmentMs: number;
}): boolean {
  const r = applyDiningDeparturePlan({
    ...opts,
    preferredTransport: opts.transport,
  });
  return r.primary != null;
}
