/**
 * Flug-Reiseplan → Timeline. Stabile IDs, Live-Upsert bei Gate/Delay.
 * Stops liegen auf dem Kalendertag ihrer Uhrzeit — nie in der Vergangenheit.
 */

import { addPlanStop, removePlanStop, reschedulePlanStop } from '../../module2/timeline/planLiveEdits';
import { usePlanCalendarUiStore } from '../../module2/timeline/planCalendarUiStore';
import { useFuturePlanStore, type FuturePlanTransport } from '../../module2/timeline/futurePlanState';
import { dateKeyFromMs, snapMsToQuarterHour } from '../../utils/dateKeys';
import type { AirportArrivalPlan } from './FlightTrackingService';
import type { JourneyItinerary, JourneyLeg } from '../transit/journeyPlanner';
import { formatDurationMinutesDe } from '../navigation/travelEta';
import {
  computeFlightPacing,
} from './flightPacing';
import { airportLageplanLink } from './airportIndoorMap';
import { compareAirportAccess } from './airportAccessCompare';
import { useFinnusStore } from '../../store/useFinnusStore';
import { flightTimelineTitle } from './flightIdent';
import { planJourney } from '../transit/journeyPlanner';
import { haversineMeters } from '../../db/database';
import {
  flightGroupLabel,
  gateLabel,
  planAccessLeg,
  checkinDeskLabel,
  securityWaitNote,
  terminalLabel,
  tidyTransitPlace,
  type AccessLegHint,
} from './flightTimelineCopy';

function clock(d: Date | number | null | undefined): string {
  if (d == null) return '—';
  const dt = typeof d === 'number' ? new Date(d) : d;
  if (!Number.isFinite(dt.getTime())) return '—';
  return `${dt.getHours().toString().padStart(2, '0')}:${dt
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

export function flightTripStopPrefix(ident: string): string {
  return `ft:${ident.replace(/\s+/g, '').toUpperCase()}:`;
}

export function clearFlightTripStops(ident: string): void {
  const prefix = flightTripStopPrefix(ident);
  const store = useFuturePlanStore.getState();
  const ids = store.plan.stops
    .filter((s) => s.id.startsWith(prefix))
    .map((s) => s.id);
  for (const day of Object.values(store.plansByDay)) {
    for (const s of day.stops) {
      if (s.id.startsWith(prefix) && !ids.includes(s.id)) ids.push(s.id);
    }
  }
  for (const id of ids) removePlanStop(id, { gapFill: false });
}

/** Alle ft:-Stops + Flug-Wecker — bei neuem Ziel/Tag. */
export function clearAllFlightTripStops(): void {
  const store = useFuturePlanStore.getState();
  const seen = new Set<string>();
  const consider = (id: string, title: string) => {
    if (
      id.startsWith('ft:') ||
      id.includes('ft:') ||
      (id.startsWith('wake_') && /flug/i.test(title)) ||
      (/^Wecker\b/i.test(title) && /flug/i.test(title))
    ) {
      seen.add(id);
    }
  };
  for (const s of store.plan.stops) consider(s.id, s.title);
  for (const day of Object.values(store.plansByDay)) {
    for (const s of day.stops) consider(s.id, s.title);
  }
  for (const id of seen) removePlanStop(id, { gapFill: false });
}

function asAccessHint(leg: JourneyLeg): AccessLegHint {
  return {
    mode: leg.mode,
    line: leg.line,
    headsign: leg.headsign,
    fromName: leg.fromName,
    toName: leg.toName,
    durationSec: leg.durationSec,
    distanceM: leg.distanceM,
    stationCount: leg.stationCount,
    delaySec: leg.delaySec,
    startMs: leg.startTime.getTime(),
    endMs: leg.endTime.getTime(),
  };
}

function originLabelFromLegs(legs: JourneyLeg[]): string | null {
  const first = legs[0];
  if (!first) return null;
  return tidyTransitPlace(first.fromName);
}

function writeTransitAccessLegs(opts: {
  prefix: string;
  groupId: string;
  groupLabel: string;
  legs: JourneyLeg[];
  airportLabel: string;
  airportMs: number;
}): { lastWalkPadded: boolean; titles: string[] } {
  const hints = opts.legs.map(asAccessHint);
  const originLabel = originLabelFromLegs(opts.legs);
  const titles: string[] = [];
  let lastWalkPadded = false;
  const ft = (input: Parameters<typeof addPlanStop>[0]): void => {
    addPlanStop({
      ...input,
      bufferMin: 0,
      openCalendar: input.openCalendar ?? false,
    });
  };
  for (let i = 0; i < opts.legs.length; i++) {
    const planned = planAccessLeg({
      legs: hints,
      index: i,
      airportLabel: opts.airportLabel,
      airportMs: opts.airportMs,
      originLabel,
    });
    titles.push(planned.title);
    if (planned.walk && i === opts.legs.length - 1) {
      lastWalkPadded = planned.padded;
    }
    const from = opts.legs[i]!;
    ft({
      id: `${opts.prefix}leg${i}`,
      title: planned.title,
      plannedStartMs: planned.startMs,
      plannedEndMs: planned.endMs,
      kind: 'nav_leg',
      transport: planned.walk ? 'walk' : 'transit',
      hardAnchor: true,
      userFixedTime: true,
      planPriority: 1,
      emoji: planned.emoji,
      notes: planned.notes,
      lat: from.fromLat ?? undefined,
      lng: from.fromLng ?? undefined,
      groupId: opts.groupId,
      groupLabel: opts.groupLabel,
    });
  }
  return { lastWalkPadded, titles };
}

/**
 * Taxi / ÖPNV / Transfer als Choice-Chips unter „Fahrt zum Flughafen“.
 * `omit` = bereits aktive Variante (als leave/legs) — Chip dafür weglassen, Alternativen behalten.
 */
function writeFlightAccessChoiceChips(opts: {
  prefix: string;
  groupId: string;
  groupLabel: string;
  airportName: string;
  airportLat: number;
  airportLng: number;
  taxiLeaveMs: number;
  taxiMin: number;
  taxiPrice?: string | null;
  transitLeaveMs?: number | null;
  transitMin?: number | null;
  omit?: 'taxi' | 'transit' | null;
}): void {
  const ft = (input: Parameters<typeof addPlanStop>[0]): void => {
    addPlanStop({
      ...input,
      bufferMin: 0,
      openCalendar: input.openCalendar ?? false,
    });
  };
  const omit = opts.omit ?? null;

  if (omit !== 'taxi') {
    ft({
      id: `${opts.prefix}taxiopt`,
      title: `Taxi · Los ${clock(opts.taxiLeaveMs)}`,
      plannedStartMs: opts.taxiLeaveMs,
      plannedEndMs: opts.taxiLeaveMs + 12 * 60_000,
      kind: 'wish',
      transport: 'taxi',
      hardAnchor: false,
      userFixedTime: false,
      planPriority: 3,
      emoji: '🚕',
      notes: `${formatDurationMinutesDe(opts.taxiMin, 'short')}${
        opts.taxiPrice ? ` · ${opts.taxiPrice}` : ''
      } · Tippen = wählen`,
      lat: opts.airportLat,
      lng: opts.airportLng,
      groupId: opts.groupId,
      groupLabel: opts.groupLabel,
      openCalendar: false,
    });
  }

  if (omit !== 'transit' && opts.transitLeaveMs != null) {
    ft({
      id: `${opts.prefix}oepnvopt`,
      title: `ÖPNV · Los ${clock(opts.transitLeaveMs)}`,
      plannedStartMs: opts.transitLeaveMs,
      plannedEndMs: opts.transitLeaveMs + 12 * 60_000,
      kind: 'wish',
      transport: 'transit',
      hardAnchor: false,
      userFixedTime: false,
      planPriority: 3,
      emoji: '🚌',
      notes: opts.transitMin
        ? `${formatDurationMinutesDe(opts.transitMin, 'short')} · Tippen für die Kette`
        : 'Tippen für die Verbindung',
      lat: opts.airportLat,
      lng: opts.airportLng,
      groupId: opts.groupId,
      groupLabel: opts.groupLabel,
      openCalendar: false,
    });
  }

  try {
    const { buildWelcomePickupsTransferUrl } = require('../affiliate/partnerTpxDeepLink') as {
      buildWelcomePickupsTransferUrl: (o: {
        citySlug: string;
        dateIso?: string | null;
        timeHm?: string | null;
        toName?: string | null;
        toLat?: number | null;
        toLng?: number | null;
        toType?: 'airport' | null;
      }) => string;
    };
    const citySlug =
      opts.airportName
        .replace(/\b(airport|flughafen|international)\b/gi, '')
        .trim()
        .split(/\s+/)[0] || 'city';
    const wp = buildWelcomePickupsTransferUrl({
      citySlug,
      dateIso: dateKeyFromMs(opts.taxiLeaveMs),
      timeHm: clock(opts.taxiLeaveMs),
      toName: opts.airportName,
      toLat: opts.airportLat,
      toLng: opts.airportLng,
      toType: 'airport',
    });
    if (wp && /welcomepickups\.com\/.+\/transfer/i.test(wp)) {
      ft({
        id: `${opts.prefix}xferwp`,
        title: `Transfer · Abholung ${clock(opts.taxiLeaveMs)}`,
        plannedStartMs: opts.taxiLeaveMs,
        plannedEndMs: opts.taxiLeaveMs + 10 * 60_000,
        kind: 'wish',
        transport: 'taxi',
        hardAnchor: false,
        userFixedTime: false,
        planPriority: 4,
        emoji: '🚐',
        notes: `Welcome Pickups · festes Auto zum ${opts.airportName}`,
        mapsUrl: wp,
        groupId: opts.groupId,
        groupLabel: opts.groupLabel,
        openCalendar: false,
      });
    }
  } catch {
    /* soft — kein Hollow-Homepage-Button */
  }
}

export type FlightTimelineHotel = {
  name: string;
  lat?: number;
  lng?: number;
} | null;

export function upsertFlightTripTimeline(opts: {
  ident: string;
  destLabel: string;
  airportName: string;
  airportLat: number;
  airportLng: number;
  plan: AirportArrivalPlan;
  access: {
    transitLeaveMs: number | null;
    transitMin: number | null;
    taxiMin: number;
    taxiPrice?: string | null;
    journeyDetail: string | null;
    recommend: 'transit' | 'taxi' | 'either';
    transit: JourneyItinerary | null;
  };
  luggage: 'carry' | 'checked' | 'unknown';
  previousIdent?: string | null;
  destAirportName?: string | null;
  destAirportLat?: number | null;
  destAirportLng?: number | null;
  hotel?: FlightTimelineHotel;
  originIata?: string | null;
  gateBufferMin?: number;
  checkinMin?: number;
  arriveToDeskMin?: number;
}): void {
  const ident = opts.ident.replace(/\s+/g, '').toUpperCase();
  if (opts.previousIdent && opts.previousIdent.toUpperCase() !== ident) {
    clearFlightTripStops(opts.previousIdent);
  }

  const flight = opts.plan.flight;
  const dep =
    flight.scheduledDeparture ?? flight.estimatedDeparture ?? null;
  if (!dep) return;

  const pacing = computeFlightPacing({
    depMs: dep.getTime(),
    boardingWindowMin: opts.plan.boardingWindowMin,
    securityWaitMin: opts.plan.securityWaitMin,
    luggage: opts.luggage,
    gateBufferMin: opts.gateBufferMin,
    checkinMin: opts.checkinMin,
    arriveToDeskMin: opts.arriveToDeskMin,
  });
  const { boardMs, bufferMs, securityMs, checkinMs, airportMs, gateBufferMin } = pacing;
  const p = flightTripStopPrefix(ident);
  const flightGroup = `${p}trip`;
  const term = terminalLabel(flight.departureTerminal);
  const gate = gateLabel(flight.departureGate);
  const checkin = checkinDeskLabel(flight.checkinDesk);
  const delay =
    flight.delayMin != null && flight.delayMin > 0
      ? ` · +${flight.delayMin} Min`
      : '';

  const flightLabel = flightGroupLabel(opts.destLabel);
  const accessGroup = `${p}access`;
  const accessLabel = 'Fahrt zum Flughafen';
  const taxiLeaveMs = snapMsToQuarterHour(
    airportMs - Math.max(5, opts.access.taxiMin) * 60_000,
    'nearest',
  );
  const selectedAccess = detectSelectedFlightAccess(p);

  const ft = (
    input: Parameters<typeof addPlanStop>[0],
  ): void => {
    addPlanStop({
      ...input,
      bufferMin: 0,
      openCalendar: input.openCalendar ?? false,
    });
  };

  removePlanStop(`${p}transit`, { gapFill: false });
  for (let i = 0; i < 24; i++) {
    removePlanStop(`${p}leg${i}`, { gapFill: false });
  }
  removePlanStop(`${p}leave`, { gapFill: false });
  removePlanStop(`${p}taxiopt`, { gapFill: false });
  removePlanStop(`${p}oepnvopt`, { gapFill: false });
  removePlanStop(`${p}xferwp`, { gapFill: false });
  removePlanStop(`${p}xfergt`, { gapFill: false });

  const choiceBase = {
    prefix: p,
    groupId: accessGroup,
    groupLabel: accessLabel,
    airportName: opts.airportName,
    airportLat: opts.airportLat,
    airportLng: opts.airportLng,
    taxiLeaveMs,
    taxiMin: opts.access.taxiMin,
    taxiPrice: opts.access.taxiPrice,
    transitLeaveMs: opts.access.transitLeaveMs,
    transitMin: opts.access.transitMin,
  };

  if (selectedAccess === 'transit' && (opts.access.transit?.legs?.length ?? 0) >= 1) {
    writeTransitAccessLegs({
      prefix: p,
      groupId: accessGroup,
      groupLabel: accessLabel,
      legs: opts.access.transit!.legs,
      airportLabel: opts.airportName,
      airportMs,
    });
    // Aktive ÖPNV-Kette + Taxi/Transfer bleiben umwählbar
    writeFlightAccessChoiceChips({ ...choiceBase, omit: 'transit' });
  } else if (selectedAccess === 'taxi') {
    ft({
      id: `${p}leave`,
      title: `Taxi · Los ${clock(taxiLeaveMs)}`,
      plannedStartMs: taxiLeaveMs,
      plannedEndMs: airportMs,
      kind: 'nav_leg',
      transport: 'taxi',
      hardAnchor: true,
      userFixedTime: true,
      planPriority: 1,
      emoji: '🚕',
      notes: `${formatDurationMinutesDe(opts.access.taxiMin, 'short')}${
        opts.access.taxiPrice ? ` · ${opts.access.taxiPrice}` : ''
      } · Uber vorbestellen`,
      lat: opts.airportLat,
      lng: opts.airportLng,
      groupId: accessGroup,
      groupLabel: accessLabel,
      openCalendar: false,
    });
    // Aktives Taxi + ÖPNV/Transfer bleiben umwählbar
    writeFlightAccessChoiceChips({ ...choiceBase, omit: 'taxi' });
  } else {
    // Noch keine Wahl: Taxi | ÖPNV | Transfer als Chips
    writeFlightAccessChoiceChips({ ...choiceBase, omit: null });
  }

  addPlanStop({
    id: `${p}airport`,
    title: term
      ? `Ankunft ${opts.airportName} · ${term}`
      : `Ankunft ${opts.airportName}`,
    lat: opts.airportLat,
    lng: opts.airportLng,
    plannedStartMs: airportMs,
    plannedEndMs: checkinMs,
    kind: 'stop',
    transport: 'walk',
    hardAnchor: true,
    userFixedTime: true,
    planPriority: 1,
    emoji: '🛬',
    notes: `Spätestens ${clock(airportMs)}.`,
    groupId: flightGroup,
    groupLabel: flightLabel,
    openCalendar: true,
  });

  const checkinTitle = checkin
    ? checkin
    : opts.luggage === 'checked'
      ? 'Check-in · wird nachgereicht'
      : 'Check-in / Boarding-Pass';
  addPlanStop({
    id: `${p}checkin`,
    title: checkinTitle,
    lat: opts.airportLat,
    lng: opts.airportLng,
    plannedStartMs: checkinMs,
    plannedEndMs: securityMs,
    kind: 'stop',
    transport: 'walk',
    hardAnchor: true,
    userFixedTime: true,
    planPriority: 1,
    emoji: '🧳',
    notes: checkin
      ? `${checkin} — vor der Security.`
      : opts.luggage === 'checked'
        ? 'Aufgabegepäck-Schalter wird nachgereicht.'
        : 'Boarding-Pass / Check-in vor der Security.',
    groupId: flightGroup,
    groupLabel: flightLabel,
    openCalendar: false,
  });

  addPlanStop({
    id: `${p}security`,
    title: 'Sicherheitskontrolle',
    lat: opts.airportLat,
    lng: opts.airportLng,
    plannedStartMs: securityMs,
    plannedEndMs: bufferMs,
    kind: 'stop',
    transport: 'walk',
    hardAnchor: true,
    userFixedTime: true,
    planPriority: 1,
    emoji: '🛂',
    notes: securityWaitNote(opts.plan.securityWaitMin, securityMs),
    groupId: flightGroup,
    groupLabel: flightLabel,
    openCalendar: false,
  });

  addPlanStop({
    id: `${p}buffer`,
    title: gate
      ? `Zum Gate ${gate.replace(/^Gate\s+/i, '')}`
      : 'Zum Gate · wird nachgereicht',
    lat: opts.airportLat,
    lng: opts.airportLng,
    plannedStartMs: bufferMs,
    plannedEndMs: boardMs,
    kind: 'stop',
    transport: 'walk',
    hardAnchor: true,
    userFixedTime: true,
    planPriority: 1,
    emoji: '⏳',
    notes: gate
      ? `${gate} — ${gateBufferMin} Min Puffer bis Boarding.`
      : `Gate wird nachgereicht · ${gateBufferMin} Min Puffer bis Boarding.`,
    groupId: flightGroup,
    groupLabel: flightLabel,
    openCalendar: false,
  });

  const mapLink = flight.departureGate
    ? airportLageplanLink({
        originIata: opts.originIata ?? '',
        gate: flight.departureGate,
      })
    : null;
  addPlanStop({
    id: `${p}board`,
    title: gate ? `Boarding · ${gate}` : 'Boarding · Gate wird nachgereicht',
    lat: opts.airportLat,
    lng: opts.airportLng,
    plannedStartMs: boardMs,
    plannedEndMs: dep.getTime(),
    kind: 'stop',
    transport: 'walk',
    hardAnchor: true,
    userFixedTime: true,
    planPriority: 1,
    emoji: '🎫',
    notes: gate
      ? `${gate}${delay}`
      : `Gate wird nachgereicht.${delay}`,
    mapsUrl: mapLink?.url,
    groupId: flightGroup,
    groupLabel: flightLabel,
    openCalendar: false,
  });

  const arr = flight.scheduledArrival ?? flight.estimatedArrival;
  const flightMin =
    arr && Number.isFinite(arr.getTime())
      ? Math.max(20, Math.round((arr.getTime() - dep.getTime()) / 60_000))
      : null;
  const flightDur = flightMin
    ? formatDurationMinutesDe(flightMin, 'short').replace(/^ca\.\s*/, '')
    : null;
  addPlanStop({
    id: `${p}dep`,
    title: flightTimelineTitle(ident, opts.destLabel, clock(dep)),
    lat: opts.airportLat,
    lng: opts.airportLng,
    plannedStartMs: dep.getTime(),
    plannedEndMs: arr?.getTime() ?? dep.getTime() + 90 * 60_000,
    kind: 'stop',
    transport: 'flight',
    hardAnchor: true,
    userFixedTime: true,
    planPriority: 1,
    emoji: '✈️',
    notes: arr
      ? `${clock(dep)}–${clock(arr)}${flightDur ? ` · ${flightDur}` : ''}${delay}${gate ? ` · ${gate}` : ''}`
      : `${clock(dep)} Uhr${delay}${gate ? ` · ${gate}` : ''}`,
    groupId: flightGroup,
    groupLabel: flightLabel,
    openCalendar: false,
  });

  if (arr) {
    addPlanStop({
      id: `${p}land`,
      title: `Ankunft in ${opts.destLabel}`,
      lat: opts.destAirportLat ?? undefined,
      lng: opts.destAirportLng ?? undefined,
      plannedStartMs: arr.getTime(),
      plannedEndMs: arr.getTime(),
      kind: 'stop',
      transport: 'flight',
      hardAnchor: true,
      userFixedTime: true,
      planPriority: 1,
      emoji: '🛬',
      notes: `Landung ${clock(arr)} Uhr.`,
      groupId: flightGroup,
      groupLabel: flightLabel,
      openCalendar: false,
    });
  }

  if (opts.luggage === 'checked' && arr) {
    const bag = flight.baggageClaim
      ? `Gepäckband ${flight.baggageClaim}`
      : 'Gepäckband wird nachgereicht';
    addPlanStop({
      id: `${p}bag`,
      title: bag,
      lat: opts.destAirportLat ?? undefined,
      lng: opts.destAirportLng ?? undefined,
      plannedStartMs: arr.getTime() + 20 * 60_000,
      plannedEndMs: arr.getTime() + 40 * 60_000,
      kind: 'stop',
      transport: 'walk',
      hardAnchor: true,
      userFixedTime: true,
      planPriority: 1,
      emoji: '🧳',
      notes: flight.baggageClaim
        ? `Band ${flight.baggageClaim}`
        : 'Band wird nachgereicht.',
      groupId: flightGroup,
      groupLabel: flightLabel,
      openCalendar: false,
    });
  } else {
    removePlanStop(`${p}bag`, { gapFill: false });
  }

  // Hotel / Mietwagen: offene Pläne ohne Uhrzeit (unten im Band, Ankunftstag)
  if (arr) {
    const arrDay = dateKeyFromMs(arr.getTime());
    const store = useFuturePlanStore.getState();
    store.ensureDay(arrDay);
    if (opts.hotel) {
      store.upsertStopOnDay(arrDay, {
        id: `${p}hotel`,
        title: `Weiter zum ${opts.hotel.name}`,
        lat: opts.hotel.lat,
        lng: opts.hotel.lng,
        plannedStartMs: null,
        plannedEndMs: null,
        bufferMin: 0,
        kind: 'wish',
        transport: 'unknown',
        hardAnchor: false,
        userFixedTime: false,
        planPriority: 3,
        emoji: '🏨',
        notes: 'Abholservice, ÖPNV oder Taxi — noch offen.',
        status: 'pending_change',
      });
    } else {
      store.upsertStopOnDay(arrDay, {
        id: `${p}hotel`,
        title: 'Hotel?',
        plannedStartMs: null,
        plannedEndMs: null,
        bufferMin: 0,
        kind: 'wish',
        transport: 'unknown',
        hardAnchor: false,
        userFixedTime: false,
        planPriority: 3,
        emoji: '🏨',
        notes: `Noch offen — Hotel in ${opts.destLabel}.`,
        status: 'pending_change',
      });
    }
    store.upsertStopOnDay(arrDay, {
      id: `${p}car`,
      title: 'Mietwagen?',
      plannedStartMs: null,
      plannedEndMs: null,
      bufferMin: 0,
      kind: 'wish',
      transport: 'unknown',
      hardAnchor: false,
      userFixedTime: false,
      planPriority: 5,
      emoji: '🚗',
      notes: `Pickup ${opts.destAirportName || opts.destLabel} — noch offen.`,
      status: 'pending_change',
    });
  }

  const firstFuture = [taxiLeaveMs, airportMs, dep.getTime()].find(
    (ms) => ms > Date.now() + 30_000,
  );
  try {
    const ui = usePlanCalendarUiStore.getState();
    if (firstFuture != null) {
      ui.requestDayKey(dateKeyFromMs(firstFuture));
    }
    ui.setScrollTarget({ kind: 'stop', stopId: `${p}airport` });
  } catch {
    /* soft */
  }
}

function findFlightStop(id: string) {
  const store = useFuturePlanStore.getState();
  return (
    store.plan.stops.find((s) => s.id === id) ??
    Object.values(store.plansByDay)
      .flatMap((d) => d.stops)
      .find((s) => s.id === id) ??
    null
  );
}

/** Welche Anreise-Variante ist bereits gewählt (Legs/Leave)? */
export function detectSelectedFlightAccess(
  prefix: string,
): 'taxi' | 'transit' | null {
  const leave = findFlightStop(`${prefix}leave`);
  if (leave?.transport === 'taxi' || leave?.transport === 'car') return 'taxi';
  if (leave?.transport === 'transit') return 'transit';
  if (findFlightStop(`${prefix}leg0`)) return 'transit';
  return null;
}

function clearFlightAccessOptions(prefix: string): void {
  removePlanStop(`${prefix}taxiopt`, { gapFill: false });
  removePlanStop(`${prefix}oepnvopt`, { gapFill: false });
  removePlanStop(`${prefix}xferwp`, { gapFill: false });
  removePlanStop(`${prefix}xfergt`, { gapFill: false });
}

function shiftMealsBeforeLeave(leaveMs: number, prevLeaveMs: number | null): void {
  if (!Number.isFinite(leaveMs) || prevLeaveMs == null) return;
  const delta = leaveMs - prevLeaveMs;
  if (Math.abs(delta) < 4 * 60_000) return;
  const store = useFuturePlanStore.getState();
  for (const s of store.plan.stops) {
    if (s.id.startsWith('ft:')) continue;
    if (!/bäck|baeck|café|cafe|frühstück|fruehstueck|bäcker/i.test(s.title)) {
      continue;
    }
    if (s.plannedStartMs == null) continue;
    reschedulePlanStop(s.id, {
      deltaMin: Math.round(delta / 60_000),
      allowHardMove: true,
    });
  }
  for (const s of useFuturePlanStore.getState().plan.stops) {
    if (!(s.id.startsWith('wake_') || /^Wecker\b/i.test(s.title))) continue;
    if (s.plannedStartMs == null) continue;
    if (s.plannedStartMs <= leaveMs - 15 * 60_000) continue;
    const wakeMs = leaveMs - 60 * 60_000;
    const dur = Math.max(
      5 * 60_000,
      (s.plannedEndMs ?? s.plannedStartMs) - s.plannedStartMs,
    );
    reschedulePlanStop(s.id, {
      plannedStartMs: wakeMs,
      plannedEndMs: wakeMs + dur,
      allowHardMove: true,
    });
  }
}

/** Taxi / ÖPNV / Fuß / Rad auf der Flug-Anreise umstellen und Zeiten neu rechnen. */
export async function retargetFlightAccess(
  leaveStopId: string,
  mode: FuturePlanTransport,
): Promise<void> {
  const m = /^ft:([^:]+):(leave|leg\d+)$/i.exec(leaveStopId);
  const identFromLeave = m?.[1];
  const ident =
    identFromLeave ??
    (/^ft:([^:]+):/i.exec(leaveStopId)?.[1] ?? '');
  if (!ident) return;
  const p = flightTripStopPrefix(ident);
  const airport = findFlightStop(`${p}airport`);
  const leave =
    findFlightStop(leaveStopId) ??
    findFlightStop(`${p}leave`) ??
    findFlightStop(`${p}leg0`);
  if (!airport) return;
  if (airport.lat == null || airport.lng == null || airport.plannedStartMs == null) {
    return;
  }

  const storeGps = useFinnusStore.getState();
  const from =
    storeGps.lastGpsLat != null && storeGps.lastGpsLng != null
      ? { lat: storeGps.lastGpsLat, lng: storeGps.lastGpsLng }
      : null;

  const groupId = `${p}access`;
  const groupLabel = 'Fahrt zum Flughafen';
  const dest = {
    lat: airport.lat,
    lng: airport.lng,
    name: airport.title.replace(/^Ankunft\s+/i, '').replace(/\s+·\s+.*$/, '').trim() ||
      airport.title,
  };
  const prevLeaveMs = leave?.plannedStartMs ?? null;
  const clearLegs = () => {
    for (let i = 0; i < 24; i++) {
      removePlanStop(`${p}leg${i}`, { gapFill: false });
    }
    removePlanStop(`${p}leave`, { gapFill: false });
  };

  if (mode === 'taxi' || mode === 'car') {
    let taxiMin = 25;
    let taxiPrice: string | null = null;
    let transitLeaveMs: number | null = null;
    let transitMin: number | null = null;
    const priorOepnv = findFlightStop(`${p}oepnvopt`);
    if (priorOepnv?.plannedStartMs != null) {
      transitLeaveMs = priorOepnv.plannedStartMs;
      if (airport.plannedStartMs != null) {
        transitMin = Math.max(
          8,
          Math.round((airport.plannedStartMs - priorOepnv.plannedStartMs) / 60_000),
        );
      }
    }
    if (from) {
      try {
        const cmp = await compareAirportAccess({
          from,
          airport: dest,
          arriveBy: new Date(airport.plannedStartMs),
        });
        taxiMin = cmp.taxiMin;
        taxiPrice = cmp.taxiPrice;
        if (cmp.transitLeaveMs != null) transitLeaveMs = cmp.transitLeaveMs;
        if (cmp.transitMin != null) transitMin = cmp.transitMin;
      } catch {
        /* fallback */
      }
    } else {
      const opt = findFlightStop(`${p}taxiopt`);
      if (opt?.plannedStartMs != null && airport.plannedStartMs != null) {
        taxiMin = Math.max(
          8,
          Math.round((airport.plannedStartMs - opt.plannedStartMs) / 60_000),
        );
      }
    }
    const leaveMs = snapMsToQuarterHour(
      airport.plannedStartMs - taxiMin * 60_000,
      'nearest',
    );
    clearLegs();
    clearFlightAccessOptions(p);
    addPlanStop({
      id: `${p}leave`,
      title: `Taxi · Los ${clock(leaveMs)}`,
      plannedStartMs: leaveMs,
      plannedEndMs: airport.plannedStartMs,
      kind: 'nav_leg',
      transport: 'taxi',
      hardAnchor: true,
      userFixedTime: true,
      planPriority: 1,
      emoji: '🚕',
      notes: `${formatDurationMinutesDe(taxiMin, 'short')}${
        taxiPrice ? ` · ${taxiPrice}` : ''
      } · Uber vorbestellen`,
      lat: dest.lat,
      lng: dest.lng,
      groupId,
      groupLabel,
      openCalendar: false,
    });
    // ÖPNV + Transfer bleiben als Umwahl unter derselben Gruppe
    writeFlightAccessChoiceChips({
      prefix: p,
      groupId,
      groupLabel,
      airportName: dest.name,
      airportLat: dest.lat,
      airportLng: dest.lng,
      taxiLeaveMs: leaveMs,
      taxiMin,
      taxiPrice,
      transitLeaveMs,
      transitMin,
      omit: 'taxi',
    });
    shiftMealsBeforeLeave(leaveMs, prevLeaveMs);
    return;
  }

  if (mode === 'transit') {
    if (!from) return;
    const cmp = await compareAirportAccess({
      from,
      airport: dest,
      arriveBy: new Date(airport.plannedStartMs),
    });
    clearLegs();
    clearFlightAccessOptions(p);
    const legs = cmp.transit?.legs ?? [];
    if (legs.length >= 1) {
      writeTransitAccessLegs({
        prefix: p,
        groupId,
        groupLabel,
        legs,
        airportLabel: dest.name,
        airportMs: airport.plannedStartMs,
      });
      const start = legs[0]!.startTime.getTime();
      writeFlightAccessChoiceChips({
        prefix: p,
        groupId,
        groupLabel,
        airportName: dest.name,
        airportLat: dest.lat,
        airportLng: dest.lng,
        taxiLeaveMs: snapMsToQuarterHour(
          airport.plannedStartMs - cmp.taxiMin * 60_000,
          'nearest',
        ),
        taxiMin: cmp.taxiMin,
        taxiPrice: cmp.taxiPrice,
        transitLeaveMs: cmp.transitLeaveMs,
        transitMin: cmp.transitMin,
        omit: 'transit',
      });
      shiftMealsBeforeLeave(snapMsToQuarterHour(start, 'nearest'), prevLeaveMs);
      return;
    }
    const leaveMs = snapMsToQuarterHour(
      cmp.transitLeaveMs ??
        airport.plannedStartMs - (cmp.transitMin ?? cmp.taxiMin) * 60_000,
      'nearest',
    );
    addPlanStop({
      id: `${p}leave`,
      title: `ÖPNV · Los ${clock(leaveMs)}`,
      plannedStartMs: leaveMs,
      plannedEndMs: airport.plannedStartMs,
      kind: 'nav_leg',
      transport: 'transit',
      hardAnchor: true,
      userFixedTime: true,
      planPriority: 1,
      emoji: '🚌',
      notes: cmp.transit
        ? `${formatDurationMinutesDe(cmp.transitMin ?? 0, 'short')}`
        : 'Keine Kette gefunden — Taxi bleibt Plan B.',
      lat: dest.lat,
      lng: dest.lng,
      journeyDetail: cmp.journeyDetail,
      groupId,
      groupLabel,
      openCalendar: false,
    });
    writeFlightAccessChoiceChips({
      prefix: p,
      groupId,
      groupLabel,
      airportName: dest.name,
      airportLat: dest.lat,
      airportLng: dest.lng,
      taxiLeaveMs: snapMsToQuarterHour(
        airport.plannedStartMs - cmp.taxiMin * 60_000,
        'nearest',
      ),
      taxiMin: cmp.taxiMin,
      taxiPrice: cmp.taxiPrice,
      transitLeaveMs: leaveMs,
      transitMin: cmp.transitMin,
      omit: 'transit',
    });
    shiftMealsBeforeLeave(leaveMs, prevLeaveMs);
    return;
  }

  if (!from) return;

  const travelMode = mode === 'bike' ? 'bike' : 'foot';
  let mins: number | null = null;
  try {
    const plan = await planJourney({
      from,
      to: dest,
      travelMode,
      arriveBy: new Date(airport.plannedStartMs),
    });
    const dur = plan.itineraries[0]?.durationSec;
    if (dur && dur > 0) mins = Math.max(8, Math.round(dur / 60));
  } catch {
    mins = null;
  }
  if (mins == null) {
    const distM = haversineMeters(from.lat, from.lng, dest.lat, dest.lng);
    const mPerMin = mode === 'bike' ? 220 : 80;
    mins = Math.max(8, Math.round((distM * 1.4) / mPerMin));
  }
  const leaveMs = snapMsToQuarterHour(
    airport.plannedStartMs - mins * 60_000,
    'nearest',
  );
  clearLegs();
  addPlanStop({
    id: `${p}leave`,
    title: mode === 'bike' ? 'Fahrrad zum Flughafen' : 'Zu Fuß zum Flughafen',
    plannedStartMs: leaveMs,
    plannedEndMs: airport.plannedStartMs,
    kind: 'nav_leg',
    transport: mode === 'bike' ? 'bike' : 'walk',
    hardAnchor: true,
    userFixedTime: true,
    planPriority: 1,
    emoji: mode === 'bike' ? '🚲' : '🚶',
    notes: `${formatDurationMinutesDe(mins, 'short')}`,
    lat: dest.lat,
    lng: dest.lng,
    openCalendar: false,
  });
  shiftMealsBeforeLeave(leaveMs, prevLeaveMs);
}

export function readFlightTripClocks(ident: string): {
  leaveMs: number | null;
  airportMs: number | null;
  boardMs: number | null;
  depMs: number | null;
} | null {
  const p = flightTripStopPrefix(ident);
  const leave =
    findFlightStop(`${p}leave`) ??
    findFlightStop(`${p}leg0`) ??
    findFlightStop(`${p}taxiopt`) ??
    findFlightStop(`${p}oepnvopt`);
  const airport = findFlightStop(`${p}airport`);
  const board = findFlightStop(`${p}board`);
  const dep = findFlightStop(`${p}dep`);
  if (!airport && !dep) return null;
  return {
    leaveMs: leave?.plannedStartMs ?? null,
    airportMs: airport?.plannedStartMs ?? null,
    boardMs: board?.plannedStartMs ?? null,
    depMs: dep?.plannedStartMs ?? null,
  };
}

/** Offene Taxi-/ÖPNV-/Transfer-Option → Anreise wählen, Flug-Trip bleibt. */
export async function resumeFlightAccessWish(stopId: string): Promise<boolean> {
  const m = /^ft:([^:]+):(taxiopt|oepnvopt|xferwp|xfergt)$/i.exec(stopId);
  if (!m) return false;
  const ident = m[1]!;
  const kind = m[2]!.toLowerCase();
  const p = flightTripStopPrefix(ident);
  const stop = findFlightStop(stopId);
  const airport = findFlightStop(`${p}airport`);

  if (kind === 'taxiopt') {
    await retargetFlightAccess(`${p}leave`, 'taxi');
    const leave = findFlightStop(`${p}leave`);
    const leaveClock =
      leave?.plannedStartMs != null ? clock(leave.plannedStartMs) : null;
    const airportName =
      airport?.title.replace(/^Ankunft\s+/i, '').replace(/\s+·\s+.*$/, '').trim() ||
      'Flughafen';
    const speech = leaveClock
      ? `Alles klar, fahren wir mit Taxi hin — Los um ${leaveClock}. Möchtest du das Taxi direkt vorbestellen?`
      : `Alles klar, fahren wir mit Taxi hin. Möchtest du das Taxi direkt vorbestellen?`;
    const bullets = [
      leaveClock ? `Los um ${leaveClock}` : null,
      airport?.plannedStartMs != null
        ? `Ankunft Flughafen ${clock(airport.plannedStartMs)}`
        : null,
    ].filter(Boolean) as string[];
    try {
      const { buildUberRideAction } = require('../affiliate/affiliateService') as {
        buildUberRideAction: (
          lat: number,
          lng: number,
          name: string,
          addr?: string,
          extra?: { pickupTimeLabel?: string },
        ) => {
          type: string;
          label: string;
          payload: Record<string, unknown>;
        };
      };
      const { presentConciergeResponse } = require('../concierge/presentConcierge') as {
        presentConciergeResponse: (
          r: {
            speechText: string;
            cardTitle?: string;
            visualBullets?: string[];
            quickActions?: Array<{
              type: string;
              label: string;
              payload: Record<string, unknown>;
            }>;
          },
          o?: { skipAutoNav?: boolean; alreadyGuarded?: boolean },
        ) => Promise<void>;
      };
      const actions =
        airport?.lat != null && airport.lng != null
          ? [
              buildUberRideAction(
                airport.lat,
                airport.lng,
                airportName,
                undefined,
                { pickupTimeLabel: leaveClock ?? undefined },
              ),
            ]
          : [];
      await presentConciergeResponse(
        {
          speechText: speech,
          cardTitle: 'Taxi zum Flughafen',
          visualBullets: bullets.slice(0, 3),
          quickActions: actions,
        },
        { skipAutoNav: true, alreadyGuarded: true },
      );
      try {
        const { usePlanCalendarUiStore } = require('../../module2/timeline/planCalendarUiStore') as {
          usePlanCalendarUiStore: {
            getState: () => {
              setMirroredActions: (a: typeof actions) => void;
            };
          };
        };
        if (actions.length) {
          usePlanCalendarUiStore.getState().setMirroredActions(actions);
        }
      } catch {
        /* soft */
      }
    } catch {
      try {
        const { enqueueSpeech } = require('../../module2/speech/speechQueue') as {
          enqueueSpeech: (o: { kind: string; text: string; turnId: string }) => void;
        };
        enqueueSpeech({
          kind: 'main',
          text: speech,
          turnId: `ft_taxi_${Date.now()}`,
        });
      } catch {
        /* soft */
      }
    }
    return true;
  }

  if (kind === 'oepnvopt') {
    await retargetFlightAccess(`${p}leave`, 'transit');
    const leave = findFlightStop(`${p}leave`) ?? findFlightStop(`${p}leg0`);
    const leaveClock =
      leave?.plannedStartMs != null ? clock(leave.plannedStartMs) : null;
    const speech = leaveClock
      ? `Alles klar — ÖPNV zum Flughafen, Los um ${leaveClock}. Die Verbindung steht in der Timeline.`
      : `Alles klar — ÖPNV zum Flughafen. Die Verbindung steht in der Timeline.`;
    try {
      const { enqueueSpeech } = require('../../module2/speech/speechQueue') as {
        enqueueSpeech: (o: { kind: string; text: string; turnId: string }) => void;
      };
      enqueueSpeech({
        kind: 'main',
        text: speech,
        turnId: `ft_oepnv_${Date.now()}`,
      });
    } catch {
      /* soft */
    }
    return true;
  }

  // Transfer: nur echte Deep-URL (kein Hollow-Homepage)
  const url = stop?.mapsUrl?.trim();
  if (url && /welcomepickups\.com\/.+\/transfer/i.test(url)) {
    try {
      const { handleQuickAction } = require('../actionHandlerService') as {
        handleQuickAction: (a: {
          type: string;
          label: string;
          payload: { url: string };
        }) => Promise<unknown>;
      };
      await handleQuickAction({
        type: 'OPEN_URL',
        label: stop?.title || 'Transfer buchen',
        payload: { url },
      });
    } catch {
      /* soft */
    }
    return true;
  }
  try {
    const { enqueueSpeech } = require('../../module2/speech/speechQueue') as {
      enqueueSpeech: (o: { kind: string; text: string; turnId: string }) => void;
    };
    enqueueSpeech({
      kind: 'main',
      text: 'Für den Transfer habe ich gerade keinen sauberen Buchungslink — Taxi mit Uber oder ÖPNV gehen aber.',
      turnId: `ft_xfer_${Date.now()}`,
    });
  } catch {
    /* soft */
  }
  return true;
}
