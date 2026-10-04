/**
 * Linienflug-Concierge: Slots mergen, Trip finden, eine Lücke fragen.
 * Phase 2: Leave-by + Timeline sobald der Trip steht (commitFlight).
 */

import type { QuickAction } from '../../types/concierge';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import {
  dateKeyFromMs,
  formatDateKeySpokenDe,
  nextWeekdayDateKey,
  offsetDateKey,
  snapMsToQuarterHour,
} from '../../utils/dateKeys';
import {
  isAirportRideFollowUp,
  isFlightBufferFollowUp,
  isFlightPlanAck,
  isFlightThanks,
  isFlightIdentAsk,
  isFlightTripFollowUp,
  isShortReplyToLastAsk,
  luggageFromLastAskReply,
  parseFlightTripSlots,
  extractFlightRegionHint,
  type FlightRegionHint,
  wantsFlightTaxiAccess,
} from './flightTripIntent';
import {
  largestTripGap,
  mergeTripSlots,
  monthDateKey,
  type TripSlotState,
} from '../travel/tripSlotMerge';
import {
  airportByIata,
  airportByCode,
  airportCodeMatches,
  findAirportByCityHint,
  findAirportMentionedInText,
  nearestCommercialAirport,
  airportTimeZone,
  type CommercialAirport,
} from './airportIata';
import { identsMatch, preferredIataIdent, publicFlightIdent, flightTimelineTitle } from './flightIdent';
import {
  buildAirportArrivalPlan,
  fetchFlightByIdent,
  hasFlightAwareKey,
  searchRouteSchedule,
  type AirportArrivalPlan,
  type FlightStatus,
  type RouteScheduleHit,
} from './FlightTrackingService';
import { compareAirportAccess } from './airportAccessCompare';
import { computeFlightPacing } from './flightPacing';
import {
  getFlightBufferStyle,
  hydrateFlightBufferStyle,
  pacingMinsForStyle,
  stepFlightBufferStyle,
} from './flightBufferProfile';
import { buildLeaveBySpeech, clockFromMs } from './flightLeaveBySpeech';
import { upsertFlightTripTimeline, retargetFlightAccess, readFlightTripClocks, clearAllFlightTripStops, completePendingAirportTransfer, getPendingAirportTransfer } from './flightTimeline';
import { requestPlanScroll } from '../../module2/timeline/planCalendarUiStore';
import {
  hasCommittedFlightWatches,
  hydrateFlightWatches,
  registerFlightWatch,
  resolveIdentFromSchedule,
} from './flightWatchService';
import { pickBestHitByClock, clockHmInZone, CLOCK_SNAP_MIN } from './flightScheduleMatch';
import { hasJsonOriginBoard } from './airportBoardCatalog';
import { airportLageplanLink } from './airportIndoorMap';
import {
  buildWakeProposalFromLeaveBy,
  formatClockDe,
} from '../alarms/wakeAlarmAdvisor';
import { registerDepartureWatch } from '../logistics/logisticsTriggerEngine';
import {
  getFlightTripSession,
  getLastFlightCommit,
  hydrateFlightTripSession,
  setFlightTripSession,
  setLastFlightCommit,
  type FlightCommitSnapshot,
} from './flightTripSession';
import {
  flightOriginNeedsClarify,
  pickPlausibleFlightOrigin,
} from './flightOriginMismatch';

export type FlightTripFollowUp = {
  speech: string;
  bullets: string[];
  quickActions: QuickAction[];
  cardTitle: string;
  /** Nach TTS Mikro öffnen — nur offene Rückfrage, keine Zweier-Chips. */
  reopenMic?: boolean;
};

type TripSession = TripSlotState & {
  destCity: string;
  destIata: string;
  originIata: string;
  originName: string;
  originLat: number;
  originLng: number;
  dateKey: string;
  options: RouteScheduleHit[];
};

let routeOptions: RouteScheduleHit[] = [];
let bufferHydrated = false;

function slotsNow(): TripSlotState | null {
  return getFlightTripSession();
}

function saveSlots(next: TripSlotState): TripSlotState {
  setFlightTripSession(next);
  try {
    const dest = (next.destCity || '').trim();
    if (dest) {
      const { noteMentionedCity } = require('../../module2/context/shortTermContext') as {
        noteMentionedCity: (c: string) => void;
      };
      noteMentionedCity(dest);
    }
  } catch {
    /* soft */
  }
  return next;
}

function isSameCommittedTrip(
  prev: { ident: string; originIata: string; destIata: string; dateKey: string },
  next: { ident: string; originIata: string; destIata: string; dateKey: string },
): boolean {
  if (
    !prev.ident.startsWith('CLK') &&
    !next.ident.startsWith('CLK') &&
    identsMatch(prev.ident, next.ident)
  ) {
    return true;
  }
  return (
    prev.originIata === next.originIata &&
    prev.destIata === next.destIata &&
    prev.dateKey === next.dateKey
  );
}

function snapshotFromSession(
  ident: string,
  session: TripSession,
  userText: string,
): FlightCommitSnapshot {
  return {
    ident,
    userText,
    destCity: session.destCity,
    destIata: session.destIata,
    originIata: session.originIata,
    originName: session.originName,
    originLat: session.originLat,
    originLng: session.originLng,
    dateKey: session.dateKey,
    clockHm: session.clockHm,
    luggage: session.luggage,
    leaveByAsk: session.leaveByAsk,
  };
}

function sessionFromSnapshot(c: FlightCommitSnapshot): TripSession {
  return {
    mode: 'flight',
    destCity: c.destCity,
    destIata: c.destIata,
    originIata: c.originIata,
    originName: c.originName,
    originCity: null,
    originLat: c.originLat,
    originLng: c.originLng,
    dateKey: c.dateKey,
    dateLocked: true,
    dateFromUserHint: true,
    dateFlex: null,
    monthIndex: null,
    clockHm: c.clockHm,
    stance: 'booked',
    selectedIdent: c.ident,
    luggage: c.luggage,
    leaveByAsk: c.leaveByAsk,
    pendingAsk: 'ride',
    updatedAtMs: Date.now(),
    options: routeOptions,
  };
}

function asCommitSession(s: TripSlotState): TripSession | null {
  if (
    !s.destCity ||
    !s.destIata ||
    !s.originIata ||
    !s.originName ||
    s.originLat == null ||
    s.originLng == null ||
    !s.dateKey
  ) {
    return null;
  }
  return {
    ...s,
    destCity: s.destCity,
    destIata: s.destIata,
    originIata: s.originIata,
    originName: s.originName,
    originLat: s.originLat,
    originLng: s.originLng,
    dateKey: s.dateKey,
    options: routeOptions,
  };
}

function depFromClock(dateKey: string, clockHm: string): Date {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const [h, mi] = clockHm.split(':').map(Number);
  return new Date(y!, (mo ?? 1) - 1, d!, h ?? 0, mi ?? 0, 0, 0);
}

function stubFlight(partial: Partial<FlightStatus> & { ident: string }): FlightStatus {
  return {
    faFlightId: null,
    status: null,
    originCode: null,
    originName: null,
    destinationCode: null,
    destinationName: null,
    scheduledDeparture: null,
    estimatedDeparture: null,
    actualDeparture: null,
    scheduledArrival: null,
    estimatedArrival: null,
    actualArrival: null,
    delayMin: null,
    departureTerminal: null,
    departureGate: null,
    checkinDesk: null,
    arrivalTerminal: null,
    arrivalGate: null,
    baggageClaim: null,
    cancelled: false,
    diverted: false,
    inboundFaFlightId: null,
    ...partial,
  };
}

function leaveByChips(
  ident: string,
  originIata: string,
  gate?: string | null,
  extra?: QuickAction[],
  preferTaxi?: boolean,
  /** Task-2 Deep-Link schon da — keine zweite Anreise-Frage als Chip */
  skipModeAsk?: boolean,
): QuickAction[] {
  const mapLink = airportLageplanLink({ originIata, gate: gate ?? null });
  // preferTaxi nur Reihenfolge; skipModeAsk wenn Task 2 schon committed
  const modeChips: QuickAction[] = skipModeAsk
    ? []
    : preferTaxi
      ? [
          {
            type: 'SHOW_MORE',
            label: 'Taxi / Uber',
            payload: { textPrompt: 'Zum Flughafen mit dem Taxi' },
          },
          {
            type: 'SHOW_MORE',
            label: 'ÖPNV',
            payload: { textPrompt: 'Zum Flughafen mit ÖPNV' },
          },
        ]
      : [
          {
            type: 'SHOW_MORE',
            label: 'ÖPNV',
            payload: { textPrompt: 'Zum Flughafen mit ÖPNV' },
          },
          {
            type: 'SHOW_MORE',
            label: 'Taxi / Uber',
            payload: { textPrompt: 'Zum Flughafen mit dem Taxi' },
          },
        ];
  const bufferChips: QuickAction[] = [
    {
      type: 'SHOW_MORE',
      label: 'Mehr Puffer',
      payload: { textPrompt: 'Mehr Puffer' },
    },
    {
      type: 'SHOW_MORE',
      label: 'Weniger Puffer',
      payload: { textPrompt: 'Weniger Puffer' },
    },
    {
      type: 'SHOW_MORE',
      label: 'Puffer passt',
      payload: { textPrompt: 'Puffer passt so' },
    },
  ];
  // Task 2: Uber/Deep-Link zuerst; sonst Founder-Staging Puffer → Anreise
  const chips: QuickAction[] = skipModeAsk
    ? [...(extra ?? []).slice(0, 2), ...bufferChips]
    : [...(extra ?? []).slice(0, 1), ...bufferChips, ...modeChips];
  if (mapLink && chips.length < 5) {
    chips.push({
      type: 'OPEN_URL',
      label: mapLink.label,
      payload: { url: mapLink.url },
    });
  }
  const seen = new Set<string>();
  const uniq: QuickAction[] = [];
  for (const c of chips) {
    const k = `${c.type}:${c.label}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(c);
  }
  return uniq.slice(0, 5);
}

/** Sticky Task-2: Taxi war Root (Satz oder Follow-through), auch wenn Follow-up nur „18 Uhr“ ist. */
function stickyFlightTaxiWanted(userText: string): boolean {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  if (wantsFlightTaxiAccess(t) || /\b(taxi|uber)\b/iu.test(t)) return true;
  try {
    const { getFollowThroughGoals } = require('../../module2/router/missionFollowThrough') as {
      getFollowThroughGoals: () => Array<{ kind: string }>;
    };
    if (getFollowThroughGoals().some((g) => g.kind === 'taxi_airport')) return true;
  } catch {
    /* soft */
  }
  return false;
}

/** Task 1 fertig → Task 2 Deep-Link mit Leave-by-Abholzeit (Just-Do-It). */
function buildTask2TaxiDeepLink(
  session: {
    originLat: number | null;
    originLng: number | null;
    originName: string;
  },
  leaveMs: number,
): QuickAction | null {
  if (session.originLat == null || session.originLng == null) return null;
  try {
    const { buildUberRideAction } = require('../affiliate/affiliateService') as {
      buildUberRideAction: (
        lat: number,
        lng: number,
        name: string,
        targetPoiId?: string | number,
        extra?: {
          dropoffFormattedAddress?: string | null;
          pickupTimeLabel?: string;
          pickupDateIso?: string;
        },
      ) => QuickAction;
    };
    return buildUberRideAction(
      session.originLat,
      session.originLng,
      session.originName,
      undefined,
      {
        dropoffFormattedAddress: session.originName,
        pickupTimeLabel: clockFromMs(leaveMs),
        pickupDateIso: dateKeyFromMs(leaveMs),
      },
    );
  } catch {
    return null;
  }
}

function identMissing(ident: string | null | undefined): boolean {
  const s = (ident || '').trim().toUpperCase();
  return !s || s.startsWith('CLK');
}

function canSearchLiveRoute(originIata: string | null | undefined): boolean {
  return Boolean(originIata && (hasJsonOriginBoard(originIata) || hasFlightAwareKey()));
}
function clockOf(
  d: Date | number | null | undefined,
  originIata?: string | null,
): string {
  if (d == null) return '—';
  const dt = typeof d === 'number' ? new Date(d) : d;
  if (!Number.isFinite(dt.getTime())) return '—';
  return clockHmInZone(dt, airportTimeZone(originIata));
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function tripDateKey(
  slots: ReturnType<typeof parseFlightTripSlots>,
  fallback?: string | null,
  originIata?: string | null,
): string {
  const now = Date.now();
  const tz = airportTimeZone(originIata) || 'Europe/Berlin';
  if (slots.dateHint === 'tomorrow') {
    return offsetDateKey(1, now);
  }
  if (slots.dateHint === 'today' || slots.dateHint === 'evening') {
    return dateKeyFromMs(now, tz);
  }
  if (slots.weekdayDe) {
    return nextWeekdayDateKey(slots.weekdayDe, now) ?? dateKeyFromMs(now, tz);
  }
  if (fallback) return fallback;
  let key = dateKeyFromMs(now, tz);
  if (slots.clockHm) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(new Date(now))
        .map((p) => [p.type, p.value]),
    );
    const nowMin =
      Number(parts.hour ?? 0) * 60 + Number(parts.minute ?? 0);
    if (hmToMinutes(slots.clockHm) + 20 < nowMin && slots.dateHint !== 'today') {
      key = offsetDateKey(1, now);
    }
  }
  return key;
}

function dateIsExplicit(slots: ReturnType<typeof parseFlightTripSlots>): boolean {
  return Boolean(slots.dateHint || slots.weekdayDe);
}

function pickChip(hit: RouteScheduleHit): QuickAction {
  const t = hit.estimatedDeparture ?? hit.scheduledDeparture;
  const label = `${hit.ident} ${clockOf(t)}`.slice(0, 22);
  return {
    type: 'SHOW_MORE',
    label,
    payload: {
      textPrompt: `Nimm Flug ${hit.ident} um ${clockOf(t)}`,
    },
  };
}

function stampPendingAsk(
  sess: TripSlotState,
  ask: TripSlotState['pendingAsk'],
): void {
  saveSlots({ ...sess, pendingAsk: ask, updatedAtMs: Date.now() });
}

function luggageChips(): QuickAction[] {
  return [
    {
      type: 'SHOW_MORE',
      label: 'Aufgabegepäck',
      payload: { textPrompt: 'Mit Aufgabegepäck' },
    },
    {
      type: 'SHOW_MORE',
      label: 'Handgepäck',
      payload: { textPrompt: 'Nur Handgepäck' },
    },
  ];
}

function spokenDay(dateKey: string): string {
  return formatDateKeySpokenDe(dateKey);
}

function dateChips(): QuickAction[] {
  return [
    {
      type: 'SHOW_MORE',
      label: 'Heute',
      payload: { textPrompt: 'Flug ist heute' },
    },
    {
      type: 'SHOW_MORE',
      label: 'Morgen',
      payload: { textPrompt: 'Flug ist morgen' },
    },
  ];
}

function filterHits(
  hits: RouteScheduleHit[],
  clockHm: string | null,
  nowMs: number,
  dateKey: string,
  originIata?: string | null,
): RouteScheduleHit[] {
  const upcoming = hits
    .filter((h) => {
      const t = (h.estimatedDeparture ?? h.scheduledDeparture)?.getTime();
      if (t == null) return false;
      if (dateKeyFromMs(t) !== dateKey) return t > nowMs - 20 * 60_000;
      return t > nowMs - 20 * 60_000;
    })
    .sort((a, b) => {
      const ta = (a.estimatedDeparture ?? a.scheduledDeparture)?.getTime() ?? 0;
      const tb = (b.estimatedDeparture ?? b.scheduledDeparture)?.getTime() ?? 0;
      return ta - tb;
    });
  if (!clockHm) return upcoming;
  const near = pickBestHitByClock(
    upcoming,
    clockHm,
    CLOCK_SNAP_MIN,
    airportTimeZone(originIata),
  );
  return near ? [near] : upcoming;
}

function hitLabel(h: RouteScheduleHit): string {
  return `${h.ident} um ${clockOf(h.estimatedDeparture ?? h.scheduledDeparture)}`;
}

async function resolveDestAirport(hint: string): Promise<CommercialAirport | null> {
  const table = findAirportByCityHint(hint);
  if (table) return table;
  try {
    const { geocodePlaceNameOsmFirst } = await import(
      '../navigation/googleMapsNav'
    );
    const geo = await geocodePlaceNameOsmFirst(`${hint} Flughafen`, {
      cityHint: hint,
    });
    if (!geo) return null;
    return nearestCommercialAirport(geo.lat, geo.lng, 100);
  } catch {
    return null;
  }
}

function destHotel(destCity: string): { name: string; lat?: number; lng?: number } | null {
  try {
    const mem = useUserMemoryStore.getState();
    const n = destCity.toLowerCase();
    const structured = mem.travelItinerary?.structured;
    if (
      structured?.hotelName &&
      structured.city &&
      structured.city.toLowerCase().includes(n)
    ) {
      return { name: structured.hotelName };
    }
    const hotels = mem.findEntities({ type: 'hotel' });
    const hit = hotels.find((h) => {
      if (!h.isConfirmed) return false;
      const city = (h.cityId || '').toLowerCase();
      const notes = (h.notes || '').toLowerCase();
      return city.includes(n) || notes.includes(n);
    });
    if (hit) return { name: hit.name, lat: hit.lat, lng: hit.lng };
  } catch {
    /* soft */
  }
  return null;
}

function askLuggage(sess: TripSlotState, ident: string, depLabel: string): FlightTripFollowUp {
  const city = sess.destCity ?? 'dein Ziel';
  const pub = publicFlightIdent(ident);
  const time = depLabel && depLabel !== '—' ? ` um ${depLabel} Uhr` : '';
  const who = pub
    ? `Der Flug ${pub} nach ${city}${time}`
    : `Der Flieger nach ${city}${time}`;
  stampPendingAsk(sess, 'luggage');
  return {
    speech: `${who}, haben wir. Fliegst du mit Aufgabegepäck oder nur mit Handgepäck?`,
    bullets: [pub ? `${pub} · ${depLabel}`.trim() : depLabel || city].filter(
      (b) => b && b !== '—',
    ),
    quickActions: luggageChips(),
    cardTitle: 'Aufgabegepäck?',
    reopenMic: true,
  };
}

function routePairBullet(originIata?: string | null, destIata?: string | null): string | null {
  const from = (originIata || '').trim().toUpperCase();
  const to = (destIata || '').trim().toUpperCase();
  if (!from || !to || from === to) return null;
  return `${from} → ${to}`;
}

function askWhen(sess: TripSlotState): FlightTripFollowUp {
  const opts = routeOptions;
  const liveChips =
    opts.length >= 1 && opts.length <= 5
      ? opts.map((h) => {
          const t = clockOf(h.estimatedDeparture ?? h.scheduledDeparture);
          return {
            type: 'SHOW_MORE' as const,
            label: t,
            payload: { textPrompt: `Ich fliege um ${t}` },
          };
        })
      : [];
  const city = sess.destCity ?? 'dein Ziel';
  const day = sess.dateKey ? spokenDay(sess.dateKey) : '';
  stampPendingAsk(sess, 'when');
  return {
    speech: day
      ? `Für ${day} nach ${city}: um wie viel Uhr fliegst du — oder hast du die Flugnummer?`
      : `Um dir genau zu sagen, wann du am Flughafen sein sollst, brauche ich deine Abflugzeit oder die Flugnummer${city ? ` nach ${city}` : ''}.`,
    bullets: [
      routePairBullet(sess.originIata, sess.destIata) || city,
      day || null,
    ].filter(Boolean) as string[],
    quickActions: liveChips.slice(0, 5),
    cardTitle: 'Wann fliegst du?',
    reopenMic: true,
  };
}

function askWhichFlight(sess: TripSlotState): FlightTripFollowUp {
  stampPendingAsk(sess, 'which');
  const opts = routeOptions;
  const city = sess.destCity ?? 'dein Ziel';
  if (opts.length >= 2 && opts.length <= 3) {
    return {
      speech: `${city}: ${opts.map((h) => clockOf(h.estimatedDeparture ?? h.scheduledDeparture)).join(' oder ')}. Welchen nimmst du?`,
      bullets: opts.map(hitLabel),
      quickActions: opts.map((h) => {
        const t = clockOf(h.estimatedDeparture ?? h.scheduledDeparture);
        return {
          type: 'SHOW_MORE' as const,
          label: t,
          payload: { textPrompt: `Ich fliege um ${t}` },
        };
      }),
      cardTitle: 'Welcher Flieger?',
      reopenMic: true,
    };
  }
  if (opts.length >= 1) {
    return {
      speech: `${city} — ich hab ${opts
        .slice(0, 4)
        .map((h) => hitLabel(h))
        .join(', ')}. Welchen nimmst du, oder sag die Flugnummer?`,
      bullets: opts.slice(0, 4).map(hitLabel),
      quickActions: [
        ...opts.slice(0, 4).map(pickChip),
        {
          type: 'SHOW_MORE' as const,
          label: 'Flugnummer',
          payload: { textPrompt: 'Meine Flugnummer ist' },
        },
      ],
      cardTitle: 'Welcher Flieger?',
      reopenMic: true,
    };
  }
  return {
    speech: `${city} — welche Flugnummer steht auf deinem Ticket?`,
    bullets: [routePairBullet(sess.originIata, sess.destIata) || city],
    quickActions: [],
    cardTitle: 'Flugnummer?',
    reopenMic: true,
  };
}

/** Uhrzeit genannt, Tafel hat keinen Treffer im Snap-Fenster — nicht CLK erfinden. */
function askNoExactFlightMatch(
  sess: TripSlotState,
  clockHm: string,
): FlightTripFollowUp {
  const originTz = airportTimeZone(sess.originIata);
  const near = routeOptions
    .map((h) => {
      const t = h.estimatedDeparture ?? h.scheduledDeparture;
      if (!t) return null;
      const hm = clockHmInZone(t, originTz);
      const [th, tm] = clockHm.split(':').map(Number);
      const [ah, am] = hm.split(':').map(Number);
      const diff = Math.abs(th * 60 + tm - (ah * 60 + am));
      const wrap = Math.min(diff, 24 * 60 - diff);
      return wrap <= 150 ? { h, wrap } : null;
    })
    .filter((x): x is { h: RouteScheduleHit; wrap: number } => x != null)
    .sort((a, b) => a.wrap - b.wrap)
    .map((x) => x.h);
  const city = sess.destCity ?? 'dein Ziel';
  if (near.length >= 1) {
    routeOptions = near.slice(0, 5);
    stampPendingAsk(sess, 'which');
    return {
      speech: `Um ${clockHm} nach ${city} hab ich keinen exakten Treffer — nah dran: ${near
        .slice(0, 3)
        .map(hitLabel)
        .join(', ')}. Welchen nimmst du, oder sag die Flugnummer?`,
      bullets: near.slice(0, 4).map(hitLabel),
      quickActions: [
        ...near.slice(0, 4).map(pickChip),
        {
          type: 'SHOW_MORE' as const,
          label: 'Flugnummer',
          payload: { textPrompt: 'Meine Flugnummer ist' },
        },
      ],
      cardTitle: 'Welcher Flieger?',
      reopenMic: true,
    };
  }
  stampPendingAsk(sess, 'which');
  return {
    speech: `Um ${clockHm} nach ${city} steht auf der Abflugtafel gerade nichts Passendes. Welche Flugnummer hast du — oder eine andere Uhrzeit?`,
    bullets: [
      routePairBullet(sess.originIata, sess.destIata) || city,
      `Gesucht ${clockHm}`,
    ],
    quickActions: [
      {
        type: 'SHOW_MORE' as const,
        label: 'Flugnummer sagen',
        payload: { textPrompt: 'Meine Flugnummer ist' },
      },
      ...dateChips().slice(0, 2),
    ],
    cardTitle: 'Flug suchen',
    reopenMic: true,
  };
}

function askDate(sess: TripSlotState): FlightTripFollowUp {
  const city = sess.destCity ?? 'dein Ziel';
  return {
    speech: `${city} — welcher Tag? Heute oder morgen reicht.`,
    bullets: [
      routePairBullet(sess.originIata, sess.destIata) || city,
    ],
    quickActions: dateChips(),
    cardTitle: 'Welcher Tag?',
    reopenMic: true,
  };
}

function askDest(sess: TripSlotState): FlightTripFollowUp {
  const from = sess.originCity ? `Ab ${sess.originCity}. ` : '';
  return {
    speech: `${from}Wohin soll der Flieger? Stadt reicht.`,
    bullets: sess.originIata ? [`Ab ${sess.originIata}`] : ['Zielstadt'],
    quickActions: dateChips(),
    cardTitle: 'Wohin?',
    reopenMic: true,
  };
}

const REGION_DEST_OPTIONS: Record<
  FlightRegionHint,
  Array<{ city: string; iata: string }>
> = {
  south: [
    { city: 'Barcelona', iata: 'BCN' },
    { city: 'Palma', iata: 'PMI' },
    { city: 'Athen', iata: 'ATH' },
  ],
  north: [
    { city: 'Stockholm', iata: 'ARN' },
    { city: 'Oslo', iata: 'OSL' },
    { city: 'Kopenhagen', iata: 'CPH' },
  ],
  east: [
    { city: 'Wien', iata: 'VIE' },
    { city: 'Budapest', iata: 'BUD' },
    { city: 'Warschau', iata: 'WAW' },
  ],
  west: [
    { city: 'Lissabon', iata: 'LIS' },
    { city: 'Dublin', iata: 'DUB' },
    { city: 'Paris', iata: 'CDG' },
  ],
};

function regionSpeechLabel(region: FlightRegionHint): string {
  if (region === 'south') return 'Süden';
  if (region === 'north') return 'Norden';
  if (region === 'east') return 'Osten';
  return 'Westen';
}

/** Offene Richtungssuche: 2–3 Städte + Ticket-Buttons, kein „Wohin?“-Stuck. */
async function wishPitchRegion(
  sess: TripSlotState,
  region: FlightRegionHint,
): Promise<FlightTripFollowUp> {
  const from = sess.originCity || sess.originIata || 'hier';
  const when = sess.dateKey ? spokenDay(sess.dateKey) : '';
  const picks = REGION_DEST_OPTIONS[region].slice(0, 3);
  const pair =
    picks.length >= 2
      ? `${picks[0]!.city} und ${picks[1]!.city}`
      : picks[0]?.city || 'starke Ziele';
  const speech = `Ab ${from} Richtung ${regionSpeechLabel(region)}${when ? `, ${when}` : ''}: ${pair} sind starke Optionen — Tickets kannst du direkt prüfen. Welches Ziel?`;
  const bullets = [
    `Richtung ${regionSpeechLabel(region)}`,
    ...picks.map((p) => p.city),
  ].slice(0, 3);
  const chips: QuickAction[] = picks.map((p) => ({
    type: 'SHOW_MORE',
    label: p.city.slice(0, 22),
    payload: { textPrompt: `Flug nach ${p.city}` },
  }));
  const bookDate = seedWishDateKey(sess);
  const first = picks[0];
  if (sess.originIata && first && bookDate) {
    try {
      const { buildCheapFlightBookActions } = await import('./cheapFlightBook');
      const book = buildCheapFlightBookActions({
        originIata: sess.originIata,
        destIata: first.iata,
        dateKey: bookDate,
        userText: `Richtung ${regionSpeechLabel(region)}`,
      });
      for (const a of book) {
        if (a.type === 'OPEN_URL' || /flug|kiwi|buchen|ticket/i.test(a.label || '')) {
          chips.push(a);
        }
      }
    } catch {
      /* soft */
    }
  }
  if (!chips.some((a) => a.type === 'OPEN_URL') && sess.originIata && first) {
    chips.push({
      type: 'SHOW_MORE',
      label: 'Flug suchen',
      payload: { textPrompt: `Flug nach ${first.city}` },
    });
  }
  return {
    speech,
    bullets,
    quickActions: chips.slice(0, 5),
    cardTitle: `Richtung ${regionSpeechLabel(region)}`,
    reopenMic: true,
  };
}

function askDestHotel(sess: { destCity?: string | null }): FlightTripFollowUp {
  const city = (sess.destCity || '').trim() || 'am Ziel';
  stampPendingAsk(sess as TripSlotState, 'hotel');
  return {
    speech: `Alles klar — gern. Hast du in ${city} schon eine Unterkunft, oder sollen wir gemeinsam was raussuchen?`,
    bullets: [`Unterkunft in ${city}?`],
    quickActions: [
      {
        type: 'SHOW_MORE',
        label: 'Schon Hotel',
        payload: { textPrompt: `Ich habe schon ein Hotel in ${city}` },
      },
      {
        type: 'SHOW_MORE',
        label: 'Hotel suchen',
        payload: { textPrompt: `Such uns ein Hotel in ${city}` },
      },
    ],
    cardTitle: 'Unterkunft?',
    reopenMic: true,
  };
}

function seedWishDateKey(sess: TripSlotState, nowMs = Date.now()): string | null {
  if (sess.dateKey) return sess.dateKey;
  if (sess.monthIndex) return monthDateKey(sess.monthIndex, nowMs);
  if (sess.dateFlex === 'week') return offsetDateKey(1, nowMs);
  if (sess.dateFlex === 'cheapest') return offsetDateKey(14, nowMs);
  return null;
}

async function wishPitch(sess: TripSlotState, userText?: string | null): Promise<FlightTripFollowUp> {
  const from = sess.originCity || sess.originIata || 'hier';
  const to = sess.destCity || sess.destIata || 'dein Ziel';
  let outboundKey = sess.dateKey;
  let returnKey: string | null = null;
  try {
    const { parseEventDateWindow } = await import('../concierge/eventDateWindow');
    const win = parseEventDateWindow(userText || '');
    if (win?.fromIso) {
      outboundKey = outboundKey || win.fromIso;
      returnKey = win.toIso;
      if (!sess.dateKey && win.fromIso) {
        sess.dateKey = win.fromIso;
        saveSlots(sess);
      }
    }
  } catch {
    /* soft */
  }
  const when =
    outboundKey && returnKey
      ? `${spokenDay(outboundKey)} bis ${spokenDay(returnKey)}`
      : sess.dateFlex === 'month' && sess.monthIndex
        ? 'im Zeitraum'
        : sess.dateFlex === 'week'
          ? 'die Woche'
          : sess.dateFlex === 'cheapest'
            ? 'zum günstigsten Preis'
            : outboundKey || sess.dateKey
              ? spokenDay(outboundKey || sess.dateKey!)
              : '';

  const bookDate =
    outboundKey ||
    seedWishDateKey(sess) ||
    seedWishDateKey({ ...sess, dateFlex: 'cheapest' });

  let chips: import('../../types/concierge').QuickAction[] = [];
  let speech = `Ab ${from} nach ${to}${when ? `, ${when}` : ''} — unten die Preis-Links zu Kiwi und dem Vergleich, da siehst du die aktuellen Flieger.`;
  let bullets: string[] = [
    routePairBullet(sess.originIata, sess.destIata) || `Ab ${from} nach ${to}`,
    ...(when ? [when] : []),
    'Direkt oder 1 Stop bevorzugt',
  ].slice(0, 3);

  if (sess.originIata && sess.destIata) {
    try {
      const { runFlightWishTools } = await import('./tools/runFlightWishTools');
      const toolOut = await runFlightWishTools({
        originIata: sess.originIata,
        destIata: sess.destIata,
        outboundDateKey: bookDate,
        returnDateKey: returnKey,
        fromLabel: from,
        toLabel: to,
        whenLabel: when || null,
        userText: userText || 'günstig vergleichen',
      });
      if (toolOut) {
        if (toolOut.provisionActions.length) chips = toolOut.provisionActions;
        if (toolOut.speech?.trim()) speech = toolOut.speech.trim();
        if (toolOut.bullets.length) bullets = toolOut.bullets.slice(0, 3);
        if (toolOut.bestOutboundDateKey && !sess.dateKey) {
          sess.dateKey = toolOut.bestOutboundDateKey;
          saveSlots(sess);
        }
      }
    } catch {
      /* tool belt optional */
    }
    if (!chips.length) {
      try {
        const { buildCheapFlightBookActions } = await import('./cheapFlightBook');
        const dateForBook = bookDate || offsetDateKey(14);
        chips = buildCheapFlightBookActions({
          originIata: sess.originIata,
          destIata: sess.destIata,
          dateKey: dateForBook,
          returnDateKey: returnKey,
          userText: userText || 'günstig vergleichen',
        });
        if (!sess.dateKey && dateForBook) {
          sess.dateKey = dateForBook;
          saveSlots(sess);
        }
      } catch {
        /* soft */
      }
    }
  }

  // Optionale Live-Anreicherung — hartes Timeout, sonst bleiben Kiwi-Links
  if (sess.originIata && sess.destIata && sess.originIata.toUpperCase() !== sess.destIata.toUpperCase()) {
    try {
      const { researchCheapFlights } = await import('./cheapFlightResearch');
      const researched = await Promise.race([
        researchCheapFlights({
          originIata: sess.originIata,
          destIata: sess.destIata,
          destCity: sess.destCity,
          dateKey: outboundKey || sess.dateKey,
          returnDateKey: returnKey,
          monthHint: when || null,
          userText: userText || (sess.dateFlex === 'cheapest' ? 'das günstigste' : undefined),
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 6500)),
      ]);
      if (researched?.speech) {
        speech = researched.speech;
        if (researched.bullets.length) {
          bullets.splice(0, bullets.length, ...researched.bullets.slice(0, 3));
        }
        if (researched.actions?.length) {
          // Preis-Links behalten, Recherche-Chips davor mergen
          const urls = new Set(
            chips.filter((a) => a.type === 'OPEN_URL').map((a) => a.payload.url),
          );
          const extra = researched.actions.filter(
            (a) => a.type !== 'OPEN_URL' || !urls.has(a.payload.url),
          );
          chips = [...researched.actions.filter((a) => a.type === 'OPEN_URL'), ...extra, ...chips]
            .filter((a, i, arr) => {
              if (a.type !== 'OPEN_URL') return true;
              const u = a.payload.url;
              return arr.findIndex((x) => x.type === 'OPEN_URL' && x.payload.url === u) === i;
            })
            .slice(0, 5);
        }
        if (researched.dateKey && (sess.dateFlex || !sess.dateKey)) {
          sess.dateKey = researched.dateKey;
          saveSlots(sess);
        }
      }
    } catch {
      /* Search-Grounding optional — Kiwi-Links bleiben */
    }
  }

  if (!chips.some((a) => a.type === 'OPEN_URL') && sess.originIata && sess.destIata) {
    const fallbackDate = bookDate || seedWishDateKey({ ...sess, dateFlex: 'cheapest' });
    if (fallbackDate) {
      const { buildCheapFlightBookActions } = await import('./cheapFlightBook');
      const book = buildCheapFlightBookActions({
        originIata: sess.originIata,
        destIata: sess.destIata,
        dateKey: fallbackDate,
        returnDateKey: returnKey,
        userText: 'günstig vergleichen',
      });
      if (book.length) chips = [...book, ...chips].slice(0, 5);
    }
  }

  if (chips.some((a) => a.type === 'OPEN_URL')) {
    chips.push({
      type: 'SHOW_MORE',
      label: 'Hotel auch?',
      payload: { textPrompt: 'Such mir auch noch ein gutes Hotel dazu' },
    });
  }

  return {
    speech,
    bullets: bullets.slice(0, 3),
    quickActions: chips.slice(0, 5),
    cardTitle: 'Günstige Flieger',
  };
}

function withChips(follow: FlightTripFollowUp, gap: ReturnType<typeof largestTripGap>): FlightTripFollowUp {
  if (follow.quickActions.length > 0) return follow;
  const fallback =
    gap === 'date'
      ? dateChips()
      : gap === 'luggage'
        ? luggageChips()
        : gap === 'search'
          ? luggageChips()
          : [];
  return { ...follow, quickActions: fallback };
}

/** Nummer ist SSOT — Ziel/Tag aus Live-Flug, nicht aus alter Session. */
async function followIdent(opts: {
  ident: string;
  slots: ReturnType<typeof parseFlightTripSlots>;
  userText: string;
  dateKeyExplicit?: string | null;
}): Promise<FlightTripFollowUp> {
  const ident = preferredIataIdent(opts.ident);
  const store = useFinnusStore.getState();
  const gps =
    store.lastGpsLat != null && store.lastGpsLng != null
      ? { lat: store.lastGpsLat, lng: store.lastGpsLng }
      : null;
  const originFromGps = gps
    ? nearestCommercialAirport(gps.lat, gps.lng)
    : airportByIata('HAM');
  const prev = slotsNow();
  const destHint = opts.slots.destHint
    ? await resolveDestAirport(opts.slots.destHint)
    : findAirportMentionedInText(opts.userText);
  const call1Day =
    typeof opts.dateKeyExplicit === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(opts.dateKeyExplicit)
      ? opts.dateKeyExplicit
      : null;
  const dateKey =
    call1Day ??
    (dateIsExplicit(opts.slots)
      ? tripDateKey(opts.slots, prev?.dateKey)
      : undefined);

  let live = null;
  if (hasFlightAwareKey()) {
    try {
      live = await fetchFlightByIdent(ident, {
        dateKey,
        destIata: destHint?.iata,
      });
    } catch {
      live = null;
    }
  }

  const dest =
    (live?.destinationCode ? airportByCode(live.destinationCode) : null) ??
    destHint ??
    (prev?.destIata ? airportByIata(prev.destIata) : null);
  const origin =
    (live?.originCode ? airportByCode(live.originCode) : null) ??
    originFromGps ??
    (prev?.originIata ? airportByIata(prev.originIata) : null);

  const liveDep = live?.estimatedDeparture ?? live?.scheduledDeparture ?? null;
  const lockedDate =
    call1Day ??
    dateKey ??
    (liveDep ? dateKeyFromMs(liveDep.getTime()) : prev?.dateKey) ??
    tripDateKey(opts.slots, prev?.dateKey);

  if (!origin) {
    return {
      speech: 'Vom nächsten Linienflughafen komme ich nicht ran. GPS kurz an.',
      bullets: ['Abflughafen'],
      quickActions: dateChips(),
      cardTitle: 'Flug',
    };
  }
  if (!dest) {
    return {
      speech: 'Wohin soll der Flieger? Stadt reicht.',
      bullets: [ident],
      quickActions: dateChips(),
      cardTitle: 'Flug',
    };
  }

  const luggage =
    opts.slots.luggage !== 'unknown'
      ? opts.slots.luggage
      : prev?.luggage ?? 'unknown';

  const merged = saveSlots(
    mergeTripSlots(prev, {
      nowMs: Date.now(),
      destCity: dest.city,
      destIata: dest.iata,
      originIata: origin.iata,
      originName: origin.name,
      originCity: origin.city,
      originLat: origin.lat,
      originLng: origin.lng,
      clockHm: liveDep ? clockOf(liveDep) : opts.slots.clockHm,
      dateHint: opts.slots.dateHint,
      dateKeyExplicit: call1Day,
      weekdayDe: opts.slots.weekdayDe,
      flightCode: ident,
      luggage,
      stance: 'booked',
      alreadyBookedExplicit: true,
      leaveByAsk: opts.slots.leaveByAsk,
    }),
  );
  merged.dateKey = lockedDate;
  merged.dateLocked = true;
  if (call1Day) merged.dateFromUserHint = true;
  merged.selectedIdent = ident;
  saveSlots(merged);

  // Leave-by: Gepäck immer erst fragen — sonst falscher Check-in-Puffer.
  if (luggage === 'unknown') {
    return askLuggage(merged, ident, liveDep ? clockOf(liveDep) : '—');
  }
  const commit = asCommitSession(merged);
  if (!commit) {
    return askLuggage(merged, ident, liveDep ? clockOf(liveDep) : '—');
  }
  return commitFlight({ ident, session: commit, userText: opts.userText });
}

async function commitFlight(opts: {
  ident: string;
  session: TripSession;
  userText: string;
  planAck?: boolean;
}): Promise<FlightTripFollowUp> {
  let ident = opts.ident.replace(/\s+/g, '').toUpperCase();
  const originTz = airportTimeZone(opts.session.originIata);
  if (ident.startsWith('CLK') && opts.session.clockHm) {
    const hit =
      pickBestHitByClock(
        opts.session.options,
        opts.session.clockHm,
        CLOCK_SNAP_MIN,
        originTz,
      ) ??
      (await resolveIdentFromSchedule({
        originIata: opts.session.originIata,
        destIata: opts.session.destIata,
        dateKey: opts.session.dateKey,
        clockHm: opts.session.clockHm,
      }));
    if (hit) {
      ident = preferredIataIdent(hit.ident);
      opts.session.selectedIdent = ident;
      if (hit.destinationCode && /^[A-Z]{3}$/i.test(hit.destinationCode)) {
        const destAp = airportByCode(hit.destinationCode);
        if (destAp) {
          opts.session.destIata = destAp.iata;
          opts.session.destCity = destAp.city;
        }
      }
      const liveClock = clockOf(
        hit.estimatedDeparture ?? hit.scheduledDeparture,
        opts.session.originIata,
      );
      if (liveClock && liveClock !== '—') opts.session.clockHm = liveClock;
      saveSlots(opts.session);
    }
  }
  if (ident.startsWith('CLK') && !opts.session.clockHm) {
    return askWhen(opts.session);
  }
  // Mit Abflugtafel: kein Fake-Plan ohne echte Flugnummer (Gate/Check-in wären erfunden).
  if (ident.startsWith('CLK') && canSearchLiveRoute(opts.session.originIata)) {
    const clock = opts.session.clockHm || '—';
    routeOptions = opts.session.options?.length
      ? opts.session.options
      : routeOptions;
    return askNoExactFlightMatch(opts.session, clock);
  }
  const store = useFinnusStore.getState();
  const from =
    store.lastGpsLat != null && store.lastGpsLng != null
      ? { lat: store.lastGpsLat, lng: store.lastGpsLng }
      : null;

  const parsedLuggage = parseFlightTripSlots(opts.userText).luggage;
  const luggage =
    opts.session.luggage === 'checked' ||
    parsedLuggage === 'checked' ||
    /\b(koffer|aufgabegepäck|aufgabegepaeck)\b/iu.test(opts.userText)
      ? 'checked'
      : opts.session.luggage === 'carry' ||
          parsedLuggage === 'carry' ||
          /\b(handgepäck|handgepaeck|nur\s+handgepäck|nur\s+handgepaeck|nur\s+cabin|cabin\s*bag|ohne\s+koffer|ohne\s+aufgabe)\b/iu.test(
            opts.userText,
          )
        ? 'carry'
        : opts.session.leaveByAsk
          ? 'carry'
          : 'unknown';
  if (luggage === 'unknown') {
    const hit =
      opts.session.options.find((o) => identsMatch(o.ident, ident)) ?? null;
    const dep = hit
      ? clockOf(hit.estimatedDeparture ?? hit.scheduledDeparture)
      : '';
    opts.session.selectedIdent = ident;
    return askLuggage(opts.session, ident, dep || '—');
  }
  opts.session.luggage = luggage;
  opts.session.selectedIdent = ident;
  saveSlots(opts.session);

  const prevSnap = getLastFlightCommit();
  const previousIdent =
    prevSnap &&
    prevSnap.ident !== ident &&
    isSameCommittedTrip(prevSnap, {
      ident,
      originIata: opts.session.originIata,
      destIata: opts.session.destIata,
      dateKey: opts.session.dateKey,
    })
      ? prevSnap.ident
      : null;
  setLastFlightCommit(snapshotFromSession(ident, opts.session, opts.userText));

  if (!bufferHydrated) {
    bufferHydrated = true;
    await hydrateFlightBufferStyle();
  }
  let mins = pacingMinsForStyle(getFlightBufferStyle());

  let plan: AirportArrivalPlan | null = null;
  const liveIdent = ident.startsWith('CLK') ? null : ident;
  if (liveIdent && hasFlightAwareKey()) {
    try {
      plan = await buildAirportArrivalPlan({
        flightCode: liveIdent,
        from,
        airportCoords: {
          lat: opts.session.originLat,
          lng: opts.session.originLng,
        },
        securityWaitMin: mins.securityWaitMin,
        boardingWindowMin: mins.boardingWindowMin,
        dateKey: opts.session.dateKey,
        destIata: opts.session.destIata,
      });
    } catch {
      plan = null;
    }
  }

  if (
    plan?.flight.destinationCode &&
    !airportCodeMatches(plan.flight.destinationCode, opts.session.destIata)
  ) {
    return {
      speech: `${ident} landet in ${plan.flight.destinationName || plan.flight.destinationCode}, nicht ${opts.session.destCity}. Welche Nummer fliegst du?`,
      bullets: [ident, plan.flight.destinationCode],
      quickActions: opts.session.options.slice(0, 4).map(pickChip),
      cardTitle: 'Anderer Flieger?',
    };
  }

  const clockDep =
    opts.session.clockHm
      ? depFromClock(opts.session.dateKey, opts.session.clockHm)
      : null;
  const liveDep =
    plan?.flight.estimatedDeparture ?? plan?.flight.scheduledDeparture ?? null;
  let dep = liveDep ?? clockDep;
  if (!dep) {
    return {
      speech: `Zu ${opts.session.destCity} fehlt die Abflugzeit noch — wann geht der Flieger?`,
      bullets: [ident.startsWith('CLK') ? opts.session.destCity : ident],
      quickActions: askWhen(opts.session).quickActions,
      cardTitle: 'Flug',
    };
  }
  if (!opts.session.clockHm) {
    opts.session.clockHm = clockOf(dep, opts.session.originIata);
    saveSlots(opts.session);
  }

  if (!plan) {
    plan = {
      flight: stubFlight({
        ident,
        originCode: opts.session.originIata,
        originName: opts.session.originName,
        destinationCode: opts.session.destIata,
        destinationName: opts.session.destCity,
        scheduledDeparture: dep,
        estimatedDeparture: dep,
      }),
      boardingWindowMin: mins.boardingWindowMin,
      securityWaitMin: mins.securityWaitMin,
      terminalWalkMin: 10,
      airportArrivalTarget: dep,
      suggestedTransitLeave: null,
      transitItinerary: null,
      speechPreFlight: '',
      speechPostLanding: null,
    };
  }

  {
    const { enrichFlightFromOriginBoard } = await import('./originAirportBoard');
    plan.flight = await enrichFlightFromOriginBoard(plan.flight, {
      originIata: opts.session.originIata,
      dateKey: opts.session.dateKey,
      destIata: opts.session.destIata,
    });
    const boardIdent = preferredIataIdent(plan.flight.ident);
    if (ident.startsWith('CLK') && boardIdent && !boardIdent.startsWith('CLK')) {
      ident = boardIdent;
      opts.session.selectedIdent = ident;
    }
    const boardDep =
      plan.flight.estimatedDeparture ?? plan.flight.scheduledDeparture ?? null;
    if (boardDep) {
      dep = boardDep;
      const liveClock = clockOf(boardDep, opts.session.originIata);
      if (liveClock && liveClock !== '—') opts.session.clockHm = liveClock;
    }
    saveSlots(opts.session);
    setLastFlightCommit(snapshotFromSession(ident, opts.session, opts.userText));
  }

  // Grobe Security-Zeit für Live-Wait-Fenster (vor finalem Pacing)
  const roughSecurityMs = computeFlightPacing({
    depMs: dep.getTime(),
    boardingWindowMin: mins.boardingWindowMin,
    securityWaitMin: mins.securityWaitMin,
    luggage,
    gateBufferMin: mins.gateBufferMin,
    checkinMin: mins.checkinMin,
    arriveToDeskMin: mins.arriveToDeskMin,
  }).securityMs;
  if (/^HAM$/i.test(opts.session.originIata)) {
    try {
      const { fetchHamSecurityWaitMin } = await import('./originAirportBoard');
      const live = await fetchHamSecurityWaitMin();
      // Nur Live-Wert nah an Security — nächtliche <1 Min nicht auf Abendflug umlegen.
      const nearSecurity =
        Date.now() >= roughSecurityMs - 3 * 60 * 60_000 &&
        Date.now() <= roughSecurityMs + 30 * 60_000;
      if (nearSecurity && live != null && live >= 1) {
        mins = { ...mins, securityWaitMin: live };
        plan.securityWaitMin = live;
      }
    } catch {
      /* soft */
    }
  }

  const pacing = computeFlightPacing({
    depMs: dep.getTime(),
    boardingWindowMin: mins.boardingWindowMin,
    securityWaitMin: mins.securityWaitMin,
    luggage,
    gateBufferMin: mins.gateBufferMin,
    checkinMin: mins.checkinMin,
    arriveToDeskMin: mins.arriveToDeskMin,
  });
  if (pacing.airportMs <= Date.now() + 30_000) {
    const shown = ident.startsWith('CLK') ? clockOf(dep) : ident;
    return {
      speech: `${shown} um ${clockOf(dep)} liegt nicht mehr in der Zukunft — welcher Flieger ist es?`,
      bullets: [clockOf(dep), opts.session.destCity],
      quickActions: opts.session.options.slice(0, 4).map(pickChip),
      cardTitle: 'Welcher Flieger?',
    };
  }

  let access = await (from
    ? compareAirportAccess({
        from,
        airport: {
          lat: opts.session.originLat,
          lng: opts.session.originLng,
          name: opts.session.originName,
        },
        arriveBy: new Date(pacing.airportMs),
      })
    : Promise.resolve(null));

  const destAp = airportByIata(opts.session.destIata);
  const hotel = destHotel(opts.session.destCity);

  upsertFlightTripTimeline({
    ident,
    destLabel: opts.session.destCity,
    airportName: opts.session.originName,
    airportLat: opts.session.originLat,
    airportLng: opts.session.originLng,
    plan,
    access: access
      ? {
          transitLeaveMs: access.transitLeaveMs,
          transitMin: access.transitMin,
          taxiMin: access.taxiMin,
          taxiPrice: access.taxiPrice,
          journeyDetail: access.journeyDetail,
          recommend: access.recommend,
          transit: access.transit,
        }
      : {
          transitLeaveMs: plan.suggestedTransitLeave?.getTime() ?? null,
          transitMin: plan.transitItinerary
            ? Math.round(plan.transitItinerary.durationSec / 60)
            : null,
          taxiMin: 25,
          taxiPrice: null,
          journeyDetail: null,
          recommend: 'either',
          transit: plan.transitItinerary,
        },
    luggage,
    previousIdent,
    destAirportName: destAp?.name ?? null,
    destAirportLat: destAp?.lat ?? null,
    destAirportLng: destAp?.lng ?? null,
    hotel,
    originIata: opts.session.originIata,
    gateBufferMin: mins.gateBufferMin,
    checkinMin: mins.checkinMin,
    arriveToDeskMin: mins.arriveToDeskMin,
  });

  registerFlightWatch({
    ident,
    destLabel: opts.session.destCity,
    airportName: opts.session.originName,
    airportLat: opts.session.originLat,
    airportLng: opts.session.originLng,
    luggage,
    flight: plan.flight,
    originIata: opts.session.originIata,
    destIata: opts.session.destIata,
    dateKey: opts.session.dateKey,
    clockHm: opts.session.clockHm,
    previousIdent,
  });

  const clocks = readFlightTripClocks(ident);
  const leaveRaw =
    clocks?.leaveMs ??
    access?.transitLeaveMs ??
    pacing.airportMs - (access?.taxiMin ?? 25) * 60_000;
  const leaveMs = snapMsToQuarterHour(leaveRaw, 'nearest');
  const airportMs = clocks?.airportMs ?? pacing.airportMs;
  const depMs = clocks?.depMs ?? dep.getTime();

  try {
    registerDepartureWatch({
      eventId: `flight:${ident}`,
      title: ident.startsWith('CLK')
        ? `Flug ${clockFromMs(depMs)} ${opts.session.destCity}`
        : `Flug ${ident}`,
      departureMs: depMs,
      walkEtaMin: access?.transitMin ?? access?.taxiMin ?? 35,
      mode: 'flight',
      destName: opts.session.originName,
      destLat: opts.session.originLat,
      destLng: opts.session.originLng,
      scheduleOsPush: true,
    });
  } catch {
    /* soft */
  }

  const now = Date.now();
  // Abendflug: kein Aufsteh-Wecker (wäre Unsinn). Nur Morgen-Wecker vorschlagen.
  const rawWake =
    leaveMs > now + 90 * 60_000
      ? buildWakeProposalFromLeaveBy({
          leaveByMs: leaveMs,
          departureMs: depMs,
          reasonLabel: ident.startsWith('CLK')
            ? `Flug ${clockFromMs(depMs)} ${opts.session.destCity}`
            : `Flug ${ident}`,
        })
      : null;
  const wakeHour =
    rawWake != null ? new Date(rawWake.wakeAtMs).getHours() : 99;
  const wakeProposal =
    rawWake &&
    wakeHour < 11 &&
    rawWake.wakeAtMs < leaveMs - 30 * 60_000 &&
    Math.abs(rawWake.wakeAtMs - depMs) > 90 * 60_000
      ? rawWake
      : null;
  const wakeClock = wakeProposal ? formatClockDe(wakeProposal.wakeAtMs) : null;
  const taxiWanted = stickyFlightTaxiWanted(opts.userText);

  let originMismatchAsk: {
    speechBit: string;
    chips: QuickAction[];
  } | null = null;
  try {
    const {
      detectOriginGpsMismatch,
      originAccessChips,
    } = require('./flightOriginMismatch') as {
      detectOriginGpsMismatch: (o: {
        gpsLat?: number | null;
        gpsLng?: number | null;
        originIata?: string | null;
        originHint?: string | null;
        userText?: string | null;
      }) => {
        mismatch: boolean;
        gpsAirport: { city: string } | null;
        statedAirport: { city: string; iata: string } | null;
      };
      originAccessChips: (city: string) => QuickAction[];
    };
    const storeGps = useFinnusStore.getState();
    const mm = detectOriginGpsMismatch({
      gpsLat: storeGps.lastGpsLat,
      gpsLng: storeGps.lastGpsLng,
      originIata: opts.session.originIata,
      originHint: opts.session.originCity,
      userText: opts.userText,
    });
    let accessDone = false;
    try {
      const { getFollowThroughGoal } = require('../../module2/router/missionFollowThrough') as {
        getFollowThroughGoal: () => {
          slots?: { accessLeg?: string | null };
        } | null;
      };
      const leg = getFollowThroughGoal()?.slots?.accessLeg;
      accessDone =
        leg === 'already_there' || leg === 'hotel' || leg === 'train';
    } catch {
      accessDone = false;
    }
    if (mm.mismatch && mm.statedAirport && !accessDone) {
      const stated = mm.statedAirport.city;
      const gpsCity = mm.gpsAirport?.city || 'deinem Ort';
      originMismatchAsk = {
        speechBit: ` Du fliegst von ${stated} — GPS wirkt eher nach ${gpsCity}. Schon vor Ort in ${stated}, oder Bahn/Hotel dorthin?`,
        chips: originAccessChips(stated),
      };
    }
  } catch {
    /* soft */
  }

  const spoken = buildLeaveBySpeech({
    destCity: opts.session.destCity,
    ident,
    depMs,
    leaveMs,
    airportMs,
    luggage,
    leaveByAsk: opts.session.leaveByAsk,
    bufferConfirm: isFlightBufferFollowUp(opts.userText) && !opts.planAck,
    planAck: opts.planAck,
    transitLeaveMs: access?.transitLeaveMs ?? clocks?.leaveMs ?? null,
    accessRecommend: taxiWanted ? 'taxi' : access?.recommend ?? 'either',
    // Anreise-Task offen → noch kein Taxi-Commit in der Speech
    taxiCommitted: taxiWanted && !originMismatchAsk,
    taxiMin: access?.taxiMin ?? null,
    taxiPrice: access?.taxiPrice ?? null,
    wakeClock,
    daySpoken: opts.session.dateKey
      ? spokenDay(opts.session.dateKey)
      : null,
    checkinClock:
      luggage === 'checked' && pacing.checkinMs != null
        ? clockFromMs(pacing.checkinMs)
        : null,
  });

  stampPendingAsk(
    {
      ...opts.session,
      selectedIdent: ident,
      clockHm: clockFromMs(depMs),
      luggage,
    },
    originMismatchAsk
      ? 'origin_access'
      : taxiWanted
        ? wakeClock
          ? 'wake'
          : 'hotel'
        : 'ride',
  );

  const extra: QuickAction[] = [];
  if (originMismatchAsk) {
    extra.push(...originMismatchAsk.chips.slice(0, 3));
  } else if (taxiWanted) {
    const task2 = buildTask2TaxiDeepLink(opts.session, leaveMs);
    if (task2) extra.push(task2);
  }
  if (access?.actions?.length && !originMismatchAsk) {
    const uberFirst = [
      ...access.actions.filter((a) => a.type === 'BOOK_UBER'),
      ...access.actions.filter((a) => a.type !== 'BOOK_UBER'),
    ];
    for (const a of taxiWanted ? uberFirst.slice(0, 2) : access.actions.slice(0, 2)) {
      if (extra.some((e) => e.type === a.type && e.label === a.label)) continue;
      if (taxiWanted && a.type === 'BOOK_UBER' && extra.some((e) => e.type === 'BOOK_UBER')) {
        continue;
      }
      extra.push(a);
    }
  }
  if (wakeProposal && wakeClock && !originMismatchAsk) {
    extra.push({
      type: 'SET_WAKE_ALARM',
      label: `Wecker ${wakeClock}?`,
      payload: {
        dateIso: new Date(wakeProposal.wakeAtMs).toISOString(),
        destName: wakeProposal.reasonLabel,
        wakeMode: 'add',
      },
    });
  }
  try {
    const { revealPlanCalendarNow } = require('../../module2/timeline/planCalendarUiStore') as {
      revealPlanCalendarNow: (day?: string | null) => Promise<void>;
    };
    void revealPlanCalendarNow(opts.session.dateKey).then(() => {
      requestPlanScroll({
        kind: 'stop',
        stopId: `ft:${ident.replace(/\s+/g, '').toUpperCase()}:airport`,
      });
    });
  } catch {
    /* soft */
  }
  if (taxiWanted || originMismatchAsk) {
    try {
      const {
        markTaxiAirportFlightResolved,
        markTaxiAirportDeepLinkReady,
      } = require('../../module2/router/missionFollowThrough') as {
        markTaxiAirportFlightResolved: (o: {
          flightTimeLabel: string;
          originCity?: string | null;
          gpsCity?: string | null;
        }) => void;
        markTaxiAirportDeepLinkReady: () => void;
      };
      const storeGps2 = useFinnusStore.getState();
      let gpsCityLabel: string | null = null;
      try {
        const { nearestCommercialAirport } = require('./airportIata') as {
          nearestCommercialAirport: (
            lat: number,
            lng: number,
          ) => { city: string } | null;
        };
        if (storeGps2.lastGpsLat != null && storeGps2.lastGpsLng != null) {
          gpsCityLabel =
            nearestCommercialAirport(
              storeGps2.lastGpsLat,
              storeGps2.lastGpsLng,
            )?.city ?? null;
        }
      } catch {
        /* soft */
      }
      markTaxiAirportFlightResolved({
        flightTimeLabel: clockFromMs(depMs),
        originCity: opts.session.originCity,
        gpsCity: gpsCityLabel,
      });
      if (
        !originMismatchAsk &&
        extra.some((a) => a.type === 'BOOK_UBER')
      ) {
        markTaxiAirportDeepLinkReady();
      }
    } catch {
      /* soft */
    }
  }
  const speechOut = originMismatchAsk
    ? `${spoken.speech}${originMismatchAsk.speechBit}`
    : spoken.speech;
  const bulletsOut = originMismatchAsk
    ? [
        `Anreise nach ${opts.session.originCity || 'Abflugort'}`,
        ...spoken.bullets,
      ].slice(0, 4)
    : spoken.bullets;
  return {
    speech: speechOut,
    bullets: bulletsOut,
    quickActions: leaveByChips(
      ident,
      opts.session.originIata,
      plan.flight.departureGate,
      extra,
      taxiWanted,
      Boolean(
        taxiWanted &&
          !originMismatchAsk &&
          extra.some((a) => a.type === 'BOOK_UBER'),
      ),
    ),
    cardTitle: originMismatchAsk
      ? 'Anreise zum Abflug'
      : publicFlightIdent(ident)
        ? `Flug ${publicFlightIdent(ident)}`
        : `Flug ${clockFromMs(depMs)}`,
    reopenMic: Boolean(originMismatchAsk),
  };
}

/** Beat-1 Bridge wenn Manager nichts Passendes liefert — Ziel würdigen + Zusage, Lücken fragt Call 2. */
export function peekFlightBeat1Bridge(text: string): string | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const slots = parseFlightTripSlots(t);
  const prev = getFlightTripSession();
  const dest = (prev?.destCity || slots.destHint || '').replace(/\s+/g, ' ').trim();
  if (!dest) return null;
  const clock = slots.clockHm || prev?.clockHm;
  if (clock) {
    return `${dest}, alles klar, ich schau Abflug und Leave-by nach.`;
  }
  // Ohne Uhr/Nummer: Zusage ohne Fake-Recherche-Versprechen — Call 2 fragt sofort die Zeit
  if (slots.leaveByAsk || slots.isFlightTrip) {
    return `${dest}, klar. Dafür brauche ich noch Abflugzeit oder Flugnummer.`;
  }
  return `${dest}, starke Wahl, ich hole Abflug und Leave-by für dich.`;
}

export type FlightTripCall1Hints = {
  /** Call-1 Kalendertag YYYY-MM-DD */
  dateKey?: string | null;
  /** Call-1 Uhr HH:mm */
  clockHm?: string | null;
};

export async function prepareFlightTripFollowUp(
  text: string,
  call1?: FlightTripCall1Hints | null,
): Promise<FlightTripFollowUp | null> {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;

  const slotsQuick = parseFlightTripSlots(t);
  const call1ClockQuick =
    typeof call1?.clockHm === 'string' &&
    /^\d{2}:\d{2}$/.test(call1.clockHm.trim())
      ? call1.clockHm.trim()
      : null;
  // Leave-by ohne Uhr/Nummer: sofort nachfragen — kein Board-/Cheap-Flight-Wait
  if (
    slotsQuick.leaveByAsk &&
    !slotsQuick.clockHm &&
    !call1ClockQuick &&
    !slotsQuick.flightCode &&
    (slotsQuick.destHint || slotsQuick.originHint)
  ) {
    await hydrateFlightTripSession();
    const prevQuick = getFlightTripSession();
    if (!prevQuick?.clockHm && !prevQuick?.selectedIdent) {
      const destHint = slotsQuick.destHint || prevQuick?.destCity || null;
      const destAp = destHint ? findAirportByCityHint(destHint) : null;
      const store = useFinnusStore.getState();
      const gps =
        store.lastGpsLat != null && store.lastGpsLng != null
          ? { lat: store.lastGpsLat, lng: store.lastGpsLng }
          : null;
      const originFromHint = slotsQuick.originHint
        ? findAirportByCityHint(slotsQuick.originHint)
        : null;
      const originFromGps = gps
        ? nearestCommercialAirport(gps.lat, gps.lng)
        : airportByIata('HAM');
      const destForPick = destAp;
      const origin = pickPlausibleFlightOrigin({
        originFromHint,
        originFromGps,
        prevOrigin: prevQuick?.originIata
          ? airportByIata(prevQuick.originIata)
          : null,
        dest: destForPick,
        userNamedOrigin: Boolean(slotsQuick.originHint),
      });
      const call1DateKey =
        typeof call1?.dateKey === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(call1.dateKey.trim())
          ? call1.dateKey.trim()
          : null;
      const merged = saveSlots(
        mergeTripSlots(prevQuick, {
          nowMs: Date.now(),
          destCity: destAp?.city ?? destHint ?? undefined,
          destIata: destAp?.iata ?? prevQuick?.destIata,
          originIata: origin?.iata,
          originName: origin?.name,
          originCity: origin?.city,
          originLat: origin?.lat,
          originLng: origin?.lng,
          dateHint: slotsQuick.dateHint,
          dateKeyExplicit: call1DateKey,
          stance: 'booked',
          leaveByAsk: true,
          luggage: slotsQuick.luggage,
        }),
      );
      stampPendingAsk(merged, 'when');
      return withChips(askWhen(merged), 'time');
    }
  }

  await hydrateFlightTripSession();
  await hydrateFlightWatches();

  const call1DateKey =
    typeof call1?.dateKey === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(call1.dateKey.trim())
      ? call1.dateKey.trim()
      : (() => {
          try {
            const { parseEventDateWindow } = require('../concierge/eventDateWindow') as {
              parseEventDateWindow: (s: string, n?: number) => { fromIso: string } | null;
            };
            return parseEventDateWindow(t)?.fromIso ?? null;
          } catch {
            return null;
          }
        })();
  const call1Clock =
    typeof call1?.clockHm === 'string' &&
    /^\d{2}:\d{2}$/.test(call1.clockHm.trim())
      ? call1.clockHm.trim()
      : null;

  const slots0 = parseFlightTripSlots(t);
  const prev = slotsNow();
  const boundLuggage = luggageFromLastAskReply(t, prev?.pendingAsk);
  let slots =
    boundLuggage && slots0.luggage === 'unknown'
      ? { ...slots0, luggage: boundLuggage }
      : slots0;
  // Call-1 Uhr ist SSOT (nach Heuristik-Merge) — Text-Parse nur Lückenfüller
  if (call1Clock) {
    slots = { ...slots, clockHm: call1Clock };
  }
  const committed = Boolean(getLastFlightCommit()) || hasCommittedFlightWatches();
  if (
    !slots.isFlightTrip &&
    !isFlightTripFollowUp(t, Boolean(prev) || committed) &&
    !(prev?.pendingAsk && isShortReplyToLastAsk(t))
  ) {
    return null;
  }

  if (/\binselflieger|wangerooge|flugplatz\s*harle|harlesiel\b/iu.test(t)) {
    try {
      const { prepareIslandAccessFollowUp } = await import('./islandAccessCompare');
      const island = await prepareIslandAccessFollowUp(t);
      if (island?.speech) {
        return {
          speech: island.speech,
          bullets: island.bullets,
          quickActions: island.quickActions,
          cardTitle: island.cardTitle,
        };
      }
    } catch {
      /* fall through */
    }
    return null;
  }

  const focus = getLastFlightCommit();
  // Welcome-Pickups Prefill: Personen + Adresse bevor Link öffnet
  if (
    (prev?.pendingAsk === 'transfer' || getPendingAirportTransfer()) &&
    (prev?.pendingAsk === 'transfer' || isShortReplyToLastAsk(t) || /\b\d+\s*personen?\b|\btransfer\s+für\b|\bvon\b/iu.test(t))
  ) {
    const paxM =
      t.match(/\b(?:für\s+)?(\d{1,2})\s*personen?\b/iu) ||
      t.match(/\btransfer\s+für\s+(\d{1,2})\b/iu) ||
      t.match(/\b(\d{1,2})\s*(?:leute|köpfe)\b/iu);
    const passengers = paxM ? Number(paxM[1]) : null;
    let fromAddress: string | null = null;
    const von = t.match(/\bvon\s+(.+)$/iu);
    if (von?.[1] && !/\bpersonen?\b/iu.test(von[1])) {
      fromAddress = von[1].replace(/[.?!]+$/, '').trim();
    } else if (
      !passengers &&
      t.length >= 6 &&
      !/\b(taxi|öpnv|oepnv|uber|transfer\s+für)\b/iu.test(t)
    ) {
      fromAddress = t.replace(/[.?!]+$/, '').trim();
    }
    const done = await completePendingAirportTransfer({
      passengers: passengers != null && passengers > 0 ? passengers : null,
      fromAddress,
    });
    if (done.speech) {
      if (done.opened && focus) {
        stampPendingAsk(sessionFromSnapshot(focus), 'hotel');
      } else if (prev) {
        stampPendingAsk(prev, 'transfer');
      }
      return {
        speech: done.speech,
        bullets: done.bullets,
        quickActions: done.opened
          ? []
          : [
              {
                type: 'SHOW_MORE',
                label: '1 Person',
                payload: { textPrompt: 'Transfer für 1 Person' },
              },
              {
                type: 'SHOW_MORE',
                label: '2 Personen',
                payload: { textPrompt: 'Transfer für 2 Personen' },
              },
              {
                type: 'SHOW_MORE',
                label: '3 Personen',
                payload: { textPrompt: 'Transfer für 3 Personen' },
              },
              {
                type: 'SHOW_MORE',
                label: '4 Personen',
                payload: { textPrompt: 'Transfer für 4 Personen' },
              },
            ],
        cardTitle: done.opened ? 'Transfer' : 'Transfer Prefill',
        reopenMic: !done.opened,
      };
    }
  }
  if (focus && isFlightIdentAsk(t)) {
    const pub = publicFlightIdent(focus.ident);
    if (pub) {
      const clock = focus.clockHm || '—';
      return {
        speech: `${pub} nach ${focus.destCity} um ${clock}.`,
        bullets: [pub, clock],
        quickActions: leaveByChips(focus.ident, focus.originIata),
        cardTitle: 'Flugnummer',
      };
    }
    return commitFlight({
      ident: focus.ident,
      session: sessionFromSnapshot(focus),
      userText: t,
    });
  }
  if (focus && (isFlightPlanAck(t) || isFlightThanks(t))) {
    return askDestHotel(sessionFromSnapshot(focus));
  }
  // Wake-Confirm darf keine nackte Flug-Uhrzeit sein („um 20 Uhr“ = Abflug, nicht Wecker).
  if (
    focus &&
    prev?.pendingAsk === 'wake' &&
    (isShortReplyToLastAsk(t) || /kein\s+wecker|ohne\s+wecker/iu.test(t)) &&
    !extractClockHm(t)
  ) {
    const no = /nein|nee|nö|nope|no|kein\s+wecker|ohne\s+wecker/iu.test(t);
    if (!no) {
      const clocks = readFlightTripClocks(focus.ident);
      const leaveMs = clocks?.leaveMs;
      const depMs = clocks?.depMs;
      if (leaveMs && depMs) {
        const proposal = buildWakeProposalFromLeaveBy({
          leaveByMs: leaveMs,
          departureMs: depMs,
          reasonLabel: `Flug ${focus.ident}`,
        });
        if (proposal) {
          try {
            const { setWakeAlarmWithBridge } = await import(
              '../alarms/nativeAlarmBridge'
            );
            await setWakeAlarmWithBridge({
              wakeAtMs: proposal.wakeAtMs,
              reasonLabel: proposal.reasonLabel,
              leaveByMs: leaveMs,
              reminderKey: `flight-wake:${focus.ident}`,
              preferNative: true,
              wakeMode: 'add',
            });
          } catch {
            /* native missing */
          }
        }
      }
    }
    stampPendingAsk(sessionFromSnapshot(focus), 'hotel');
    return askDestHotel(sessionFromSnapshot(focus));
  }
  if (focus && prev?.pendingAsk === 'origin_access') {
    try {
      const { parseOriginAccessReply } = require('./flightOriginMismatch') as {
        parseOriginAccessReply: (
          s: string,
        ) => 'already_there' | 'hotel' | 'train' | 'needed' | 'unknown' | null;
      };
      const {
        markTaxiAirportAccessLeg,
      } = require('../../module2/router/missionFollowThrough') as {
        markTaxiAirportAccessLeg: (
          leg: 'already_there' | 'hotel' | 'train' | 'needed' | 'unknown',
        ) => void;
      };
      const leg = parseOriginAccessReply(t) || 'needed';
      markTaxiAirportAccessLeg(leg);
      const clocks = readFlightTripClocks(focus.ident);
      const leave = clocks?.leaveMs;
      const city = focus.originCity || focus.originName || 'Abflugort';
      if (leg === 'already_there' && leave != null) {
        const taxiActions: QuickAction[] = [];
        const built = buildTask2TaxiDeepLink(
          {
            originLat: focus.originLat,
            originLng: focus.originLng,
            originName: focus.originName,
          },
          leave,
        );
        if (built) taxiActions.push(built);
        try {
          const { markTaxiAirportDeepLinkReady } =
            require('../../module2/router/missionFollowThrough') as {
              markTaxiAirportDeepLinkReady: () => void;
            };
          if (built) markTaxiAirportDeepLinkReady();
        } catch {
          /* soft */
        }
        stampPendingAsk(sessionFromSnapshot(focus), 'hotel');
        return {
          speech: `Alles klar — du bist schon in ${city}. Taxi mit Abholzeit ${clockFromMs(leave)} ist vorbereitet.`,
          bullets: [`Taxi · ${clockFromMs(leave)}`, city],
          quickActions: taxiActions.slice(0, 4),
          cardTitle: 'Taxi vorbestellen',
          reopenMic: false,
        };
      }
      if (leg === 'hotel') {
        stampPendingAsk(sessionFromSnapshot(focus), 'hotel');
        return {
          speech: `Check — Hotel Vornacht in ${city}. Sag mir das Hotel oder die Gegend, dann trage ich Anreise und Taxi zum Flughafen ein.`,
          bullets: [`Hotel in ${city}`, 'Dann Taxi zum Flughafen'],
          quickActions: [],
          cardTitle: 'Anreise Hotel',
          reopenMic: true,
        };
      }
      if (leg === 'train') {
        stampPendingAsk(sessionFromSnapshot(focus), null);
        return {
          speech: `Alles klar — Bahn nach ${city}. Wann fährt dein Zug, oder soll ich eine sinnvolle Verbindung suchen?`,
          bullets: [`Bahn → ${city}`, 'Dann Taxi zum Flughafen'],
          quickActions: [
            {
              type: 'SHOW_MORE',
              label: 'Verbindung suchen',
              payload: { textPrompt: `Bahnverbindung nach ${city} suchen` },
            },
          ],
          cardTitle: 'Anreise Bahn',
          reopenMic: true,
        };
      }
    } catch {
      /* soft — fall through */
    }
  }

  if (focus && prev?.pendingAsk === 'taxi_book' && isShortReplyToLastAsk(t)) {
    const clocks = readFlightTripClocks(focus.ident);
    const leave = clocks?.leaveMs;
    const airportMs = clocks?.airportMs;
    const yes = /^(ja|jo|jap|klar|bitte|mach|ok|okay|gerne|yes)\b/iu.test(t.trim());
    if (!yes) {
      stampPendingAsk(sessionFromSnapshot(focus), 'hotel');
      return askDestHotel(sessionFromSnapshot(focus));
    }
    const leaveClock = leave != null ? clockFromMs(leave) : null;
    const airportClock = airportMs != null ? clockFromMs(airportMs) : null;
    const taxiNote = (() => {
      try {
        const { useFuturePlanStore } = require('../../module2/timeline/futurePlanState') as {
          useFuturePlanStore: {
            getState: () => {
              plan: { stops: Array<{ id: string; notes?: string | null }> };
            };
          };
        };
        const leaveStop = useFuturePlanStore
          .getState()
          .plan.stops.find((s) => s.id === `ft:${focus.ident}:leave`);
        const m = leaveStop?.notes?.match(/·\s*(.+)$/);
        return m?.[1]?.trim() || null;
      } catch {
        return null;
      }
    })();
    const bits = [
      airportClock ? `Spätestens ${airportClock} am Flughafen` : null,
      leaveClock ? `Los um ${leaveClock}` : null,
      taxiNote ? `Taxi ca. ${taxiNote}` : null,
    ].filter(Boolean) as string[];
    const speech =
      bits.length > 0
        ? `${bits.join(' — ')}. Uber-Button ist bereit — da kannst du die Fahrt vorbestellen.`
        : `Alles klar — Uber-Button ist bereit zum Vorbestellen.`;
    const taxiActions: QuickAction[] = [];
    if (focus.originLat != null && focus.originLng != null) {
      try {
        const { buildUberRideAction } = require('../affiliate/affiliateService') as {
          buildUberRideAction: (
            lat: number,
            lng: number,
            name: string,
            targetPoiId?: string | number,
            extra?: {
              dropoffFormattedAddress?: string | null;
              pickupTimeLabel?: string;
              pickupDateIso?: string;
            },
          ) => QuickAction;
        };
        taxiActions.push(
          buildUberRideAction(
            focus.originLat,
            focus.originLng,
            focus.originName,
            undefined,
            leave != null
              ? {
                  dropoffFormattedAddress: focus.originName,
                  pickupTimeLabel: clockFromMs(leave),
                  pickupDateIso: dateKeyFromMs(leave),
                }
              : { dropoffFormattedAddress: focus.originName },
          ),
        );
      } catch {
        /* soft */
      }
    }
    stampPendingAsk(sessionFromSnapshot(focus), 'hotel');
    const hotel = askDestHotel(sessionFromSnapshot(focus));
    return {
      speech: `${speech} ${hotel.speech}`,
      bullets: [...bits.slice(0, 2), ...hotel.bullets].filter(Boolean).slice(0, 3) as string[],
      quickActions: [...taxiActions, ...hotel.quickActions].slice(0, 4),
      cardTitle: 'Taxi vorbestellen',
      reopenMic: true,
    };
  }

  if (
    focus &&
    prev?.pendingAsk === 'ride' &&
    isShortReplyToLastAsk(t) &&
    !isAirportRideFollowUp(t) &&
    boundLuggage == null
  ) {
    stampPendingAsk(sessionFromSnapshot(focus), 'hotel');
    return askDestHotel(sessionFromSnapshot(focus));
  }
  if (focus && isFlightBufferFollowUp(t)) {
    const dir = /\bmehr\s+puffer\b/iu.test(t)
      ? 'more'
      : /\bweniger\s+puffer|knappere?n?\s+puffer\b/iu.test(t)
        ? 'less'
        : 'keep';
    if (dir === 'keep') {
      return askDestHotel(sessionFromSnapshot(focus));
    }
    stepFlightBufferStyle(dir);
    return commitFlight({
      ident: focus.ident,
      session: sessionFromSnapshot(focus),
      userText: t,
    });
  }

  if (focus && isAirportRideFollowUp(t)) {
    const mode = /\b(taxi|uber)\b/iu.test(t)
      ? 'taxi'
      : /\btransfer\b/iu.test(t)
        ? 'transfer'
        : 'transit';
    if (mode === 'transfer') {
      try {
        const { resumeFlightAccessWish } = require('./flightTimeline') as {
          resumeFlightAccessWish: (id: string) => Promise<boolean>;
        };
        await resumeFlightAccessWish(`ft:${focus.ident}:xferwp`);
      } catch {
        /* soft */
      }
      return {
        speech:
          'Transfer mit Welcome Pickups — zu wie vielen seid ihr, und von welcher Adresse soll das Auto abholen?',
        bullets: [focus.destCity, 'Personen + Abholadresse'],
        quickActions: [
          {
            type: 'SHOW_MORE',
            label: '1 Person',
            payload: { textPrompt: 'Transfer für 1 Person' },
          },
          {
            type: 'SHOW_MORE',
            label: '2 Personen',
            payload: { textPrompt: 'Transfer für 2 Personen' },
          },
          {
            type: 'SHOW_MORE',
            label: '3 Personen',
            payload: { textPrompt: 'Transfer für 3 Personen' },
          },
          {
            type: 'SHOW_MORE',
            label: '4 Personen',
            payload: { textPrompt: 'Transfer für 4 Personen' },
          },
        ],
        cardTitle: 'Transfer Prefill',
        reopenMic: true,
      };
    }
    try {
      await retargetFlightAccess(`ft:${focus.ident}:leave`, mode);
    } catch {
      /* soft */
    }
    const clocks = readFlightTripClocks(focus.ident);
    const leave = clocks?.leaveMs;
    const dest = focus.destCity;
    const hotel = askDestHotel(sessionFromSnapshot(focus));
    stampPendingAsk(sessionFromSnapshot(focus), 'hotel');
    const rideBit = leave
      ? mode === 'taxi'
        ? `Alles klar, Taxi mit Uber — Los um ${clockFromMs(leave)}. Deep-Link steht bereit.`
        : `Alles klar, ÖPNV — Los um ${clockFromMs(leave)}. Die Verbindung steht in der Timeline.`
      : `Ich stell die Anreise auf ${mode === 'taxi' ? 'Taxi mit Uber' : 'ÖPNV'} um.`;
    const taxiActions: QuickAction[] = [];
    if (mode === 'taxi' && leave != null) {
      const built = buildTask2TaxiDeepLink(
        {
          originLat: focus.originLat,
          originLng: focus.originLng,
          originName: focus.originName,
        },
        leave,
      );
      if (built) {
        taxiActions.push(built);
        try {
          const { markTaxiAirportDeepLinkReady } =
            require('../../module2/router/missionFollowThrough') as {
              markTaxiAirportDeepLinkReady: () => void;
            };
          markTaxiAirportDeepLinkReady();
        } catch {
          /* soft */
        }
      }
    }
    // Nach Wahl keine Rivalen-Chips mehr (ÖPNV bleibt nur auf explizite Nachfrage)
    if (mode === 'taxi') {
      return {
        speech: rideBit,
        bullets: [
          'Taxi',
          leave != null ? `Los ${clockFromMs(leave)}` : dest,
        ].filter(Boolean) as string[],
        quickActions: taxiActions.slice(0, 4),
        cardTitle: 'Taxi zum Flughafen',
        reopenMic: true,
      };
    }
    return {
      speech: `${rideBit} ${hotel.speech}`,
      bullets: [
        'ÖPNV',
        leave != null ? `Los ${clockFromMs(leave)}` : dest,
        ...hotel.bullets,
      ].filter(Boolean) as string[],
      quickActions: [...taxiActions, ...hotel.quickActions].slice(0, 4),
      cardTitle: 'ÖPNV zum Flughafen',
      reopenMic: false,
    };
  }

  if (slots.flightCode) {
    return followIdent({
      ident: slots.flightCode,
      slots,
      userText: t,
      dateKeyExplicit: call1DateKey,
    });
  }

  const store = useFinnusStore.getState();
  const gps =
    store.lastGpsLat != null && store.lastGpsLng != null
      ? { lat: store.lastGpsLat, lng: store.lastGpsLng }
      : null;

  const originFromGps = gps
    ? nearestCommercialAirport(gps.lat, gps.lng)
    : airportByIata('HAM');
  const destFromHint = slots.destHint
    ? await resolveDestAirport(slots.destHint)
    : findAirportMentionedInText(t);
  const originFromHint = slots.originHint
    ? findAirportByCityHint(slots.originHint)
    : null;
  const userNamedOrigin = Boolean(slots.originHint?.trim());

  let dest = destFromHint;
  if (slots.returning && originFromHint) {
    // Rückflug: genannter Ort = Heimat/Abflug; GPS nur als Dest-Fallback wenn Sinn
    const gpsOk =
      originFromGps &&
      originFromGps.iata.toUpperCase() !== originFromHint.iata.toUpperCase()
        ? originFromGps
        : null;
    dest = gpsOk ?? destFromHint ?? null;
  }
  if (!dest && prev?.destIata) dest = airportByIata(prev.destIata);

  let origin = pickPlausibleFlightOrigin({
    originFromHint,
    originFromGps,
    prevOrigin: prev?.originIata ? airportByIata(prev.originIata) : null,
    dest,
    userNamedOrigin,
  });
  if (slots.returning && originFromHint) {
    origin = pickPlausibleFlightOrigin({
      originFromHint,
      originFromGps: null,
      prevOrigin: null,
      dest,
      userNamedOrigin: true,
    });
  }

  const destChanged =
    Boolean(dest) && Boolean(prev?.destIata) && dest!.iata !== prev!.destIata;
  if (destChanged) routeOptions = [];

  const merged = saveSlots(
    mergeTripSlots(prev, {
      nowMs: Date.now(),
      destCity: dest?.city,
      destIata: dest?.iata,
      originIata: origin?.iata,
      originName: origin?.name,
      originCity: origin?.city,
      originLat: origin?.lat,
      originLng: origin?.lng,
      clockHm: slots.clockHm,
      dateHint: slots.dateHint,
      dateKeyExplicit: call1DateKey,
      weekdayDe: slots.weekdayDe,
      monthIndex: slots.monthIndex,
      dateFlex: slots.dateFlex,
      stance: slots.stance,
      alreadyBookedExplicit: slots.alreadyBookedExplicit,
      wantsHelpBooking: slots.wantsHelpBooking,
      luggage: slots.luggage,
      flightCode: slots.flightCode,
      leaveByAsk: slots.leaveByAsk,
    }),
  );

  const dateChanged =
    Boolean(merged.dateKey) &&
    Boolean(prev?.dateKey) &&
    merged.dateKey !== prev!.dateKey;
  if (destChanged || dateChanged) {
    routeOptions = [];
    setLastFlightCommit(null);
    try {
      clearAllFlightTripStops();
    } catch {
      /* soft */
    }
  }

  // Solo-Günstig A→B: sofort Kiwi-Pitch — nie Live-Board / Leave-by / „Live-Daten fehlen“
  try {
    const { isSoloFlightAbSearch } = require('./flightTripIntent') as {
      isSoloFlightAbSearch: (s: string) => boolean;
    };
    const wishSolo =
      !slots.leaveByAsk &&
      !slots.alreadyBookedExplicit &&
      (merged.stance === 'wish' ||
        slots.stance === 'wish' ||
        isSoloFlightAbSearch(t));
    if (wishSolo && merged.originIata && merged.destIata) {
      if (!merged.dateKey) {
        try {
          const { parseEventDateWindow } = require('../concierge/eventDateWindow') as {
            parseEventDateWindow: (
              s: string,
              n?: number,
            ) => { fromIso: string; toIso?: string } | null;
          };
          const win = parseEventDateWindow(t);
          if (win?.fromIso) {
            merged.dateKey = win.fromIso;
            saveSlots(merged);
          }
        } catch {
          /* soft */
        }
      }
      stampPendingAsk(merged, null);
      return withChips(await wishPitch(merged, t), 'search');
    }
  } catch {
    /* soft */
  }

  if (
    flightOriginNeedsClarify({
      userNamedOrigin,
      origin,
      dest,
      originHint: slots.originHint,
    })
  ) {
    const hint = (slots.originHint || '').trim();
    return withChips(
      {
        speech: hint
          ? `Abflug „${hint}“ passt so nicht zum Ziel — von welchem Flughafen soll's wirklich losgehen?`
          : 'Von welchem Flughafen soll der Flieger starten?',
        bullets: ['Abflugort klären'],
        quickActions: dateChips(),
        cardTitle: 'Flug',
      },
      'date',
    );
  }

  if (!origin) {
    return withChips(
      {
        speech: userNamedOrigin
          ? 'Den Abflugort finde ich so nicht — Stadt oder Flughafen-Kürzel reicht.'
          : 'Vom nächsten Linienflughafen komme ich nicht ran. GPS kurz an.',
        bullets: ['Abflughafen'],
        quickActions: dateChips(),
        cardTitle: 'Flug',
      },
      'date',
    );
  }

  if (
    merged.destIata &&
    merged.originIata &&
    merged.dateKey &&
    identMissing(merged.selectedIdent) &&
    Boolean(merged.clockHm) &&
    canSearchLiveRoute(merged.originIata)
  ) {
    try {
      const rawHits = await searchRouteSchedule({
        originIata: merged.originIata,
        destIata: merged.destIata,
        dateKey: merged.dateKey,
        clockHm: merged.clockHm,
      });
      routeOptions = filterHits(
        rawHits,
        merged.clockHm,
        Date.now(),
        merged.dateKey,
        merged.originIata,
      );
      // Soft Nachbar-Tag nur bei Clock-Inferenz — nie bei User-„morgen/heute“.
      if (
        routeOptions.length === 0 &&
        rawHits.length === 0 &&
        !merged.dateFromUserHint
      ) {
        const altKeys = [
          offsetDateKey(-1, Date.now()),
          offsetDateKey(1, Date.now()),
        ].filter((k) => k !== merged.dateKey);
        for (const alt of altKeys) {
          const altHits = await searchRouteSchedule({
            originIata: merged.originIata,
            destIata: merged.destIata,
            dateKey: alt,
            clockHm: merged.clockHm,
          });
          const altFiltered = filterHits(
            altHits,
            merged.clockHm,
            Date.now(),
            alt,
            merged.originIata,
          );
          if (altFiltered.length > 0) {
            merged.dateKey = alt;
            merged.dateLocked = true;
            saveSlots(merged);
            routeOptions = altFiltered;
            break;
          }
        }
      }
    } catch {
      routeOptions = [];
    }
  }

  const clock = merged.clockHm;
  if (clock && identMissing(merged.selectedIdent)) {
    const originTz = airportTimeZone(merged.originIata);
    const hit =
      pickBestHitByClock(routeOptions, clock, CLOCK_SNAP_MIN, originTz) ??
      pickBestHitByClock(routeOptions, clock, 90, originTz);
    if (hit) {
      merged.selectedIdent = preferredIataIdent(hit.ident);
      if (hit.destinationCode && /^[A-Z]{3}$/i.test(hit.destinationCode)) {
        const destAp = airportByCode(hit.destinationCode);
        if (destAp) {
          merged.destIata = destAp.iata;
          merged.destCity = destAp.city;
        }
      }
      const live = hit.estimatedDeparture ?? hit.scheduledDeparture;
      if (live) merged.clockHm = clockOf(live, merged.originIata);
      saveSlots(merged);
    } else if (canSearchLiveRoute(merged.originIata)) {
      // Uhrzeit da, kein Tafel-Snap → nicht CLK erfinden / Fake-Plan bauen
      // Frische Tages-Tafel nachladen (nicht nur leeres Modul-Cache).
      try {
        if (merged.originIata && merged.destIata && merged.dateKey) {
          const fresh = await searchRouteSchedule({
            originIata: merged.originIata,
            destIata: merged.destIata,
            dateKey: merged.dateKey,
            clockHm: null,
          });
          routeOptions = filterHits(
            fresh,
            null,
            Date.now(),
            merged.dateKey,
            merged.originIata,
          );
          const retry =
            pickBestHitByClock(routeOptions, clock, CLOCK_SNAP_MIN, originTz) ??
            pickBestHitByClock(routeOptions, clock, 90, originTz);
          if (retry) {
            merged.selectedIdent = preferredIataIdent(retry.ident);
            const live = retry.estimatedDeparture ?? retry.scheduledDeparture;
            if (live) merged.clockHm = clockOf(live, merged.originIata);
            saveSlots(merged);
          } else {
            stampPendingAsk(merged, 'which');
            return withChips(askNoExactFlightMatch(merged, clock), 'time');
          }
        } else {
          stampPendingAsk(merged, 'which');
          return withChips(askNoExactFlightMatch(merged, clock), 'time');
        }
      } catch {
        stampPendingAsk(merged, 'which');
        return withChips(askNoExactFlightMatch(merged, clock), 'time');
      }
    }
  }

  const nimm = t.match(/\bnimm\s+flug\s+([A-Z0-9]{2,6}\d{1,4}[A-Z]?)\b/iu);
  if (nimm?.[1]) {
    merged.selectedIdent = nimm[1].replace(/\s+/g, '').toUpperCase();
    saveSlots(merged);
  }

  if (identMissing(merged.selectedIdent) && routeOptions.length === 1) {
    const only = routeOptions[0]!;
    merged.selectedIdent = preferredIataIdent(only.ident);
    const live = only.estimatedDeparture ?? only.scheduledDeparture;
    if (live) merged.clockHm = clockOf(live, merged.originIata);
    saveSlots(merged);
  }

  const gap = largestTripGap(merged);
  if (gap === 'dest') {
    const region =
      slots.regionHint ||
      extractFlightRegionHint(t) ||
      null;
    if (region) {
      stampPendingAsk(merged, null);
      return withChips(await wishPitchRegion(merged, region), 'search');
    }
    stampPendingAsk(merged, null);
    return withChips(askDest(merged), gap);
  }
  if (gap === 'date') {
    stampPendingAsk(merged, null);
    return withChips(askDate(merged), gap);
  }

  if (gap === 'search') {
    stampPendingAsk(merged, null);
    return withChips(await wishPitch(merged, t), gap);
  }

  if (gap === 'time') {
    if (routeOptions.length >= 2 && routeOptions.length <= 5) {
      stampPendingAsk(merged, 'which');
      return withChips(askWhichFlight(merged), gap);
    }
    stampPendingAsk(merged, 'when');
    return withChips(askWhen(merged), gap);
  }

  const ident = merged.selectedIdent;
  const hitForIdent = ident
    ? routeOptions.find((o) => identsMatch(o.ident, ident))
    : null;
  const depLabel = ident
    ? clockOf(
        hitForIdent?.estimatedDeparture ?? hitForIdent?.scheduledDeparture ?? null,
      )
    : clock ?? '';
  const identLabel =
    ident && !ident.startsWith('CLK')
      ? preferredIataIdent(ident)
      : clock ?? 'Flug';

  if (gap === 'luggage') {
    stampPendingAsk(merged, 'luggage');
    const follow = askLuggage(merged, identLabel, depLabel || clock || '');
    const pub = publicFlightIdent(identLabel);
    const city = merged.destCity ?? 'dein Ziel';
    const shown = depLabel && depLabel !== '—' ? depLabel : clock;
    if (pub && shown) {
      return {
        ...follow,
        speech: `Hab ihn — ${pub} nach ${city} um ${shown} Uhr. Bevor ich die genaue Zeit sagen kann: fliegst du mit Aufgabegepäck oder nur mit Handgepäck?`,
      };
    }
    return follow;
  }

  const commit = asCommitSession(merged);
  const clockIdent =
    clock && (!ident || ident.startsWith('CLK'))
      ? `CLK${clock.replace(':', '')}`
      : null;
  const commitIdent =
    ident && !ident.startsWith('CLK') ? ident : clockIdent;
  if (
    commitIdent?.startsWith('CLK') &&
    clock &&
    canSearchLiveRoute(merged.originIata)
  ) {
    return withChips(askNoExactFlightMatch(merged, clock), 'time');
  }
  if (commit && commitIdent && merged.luggage !== 'unknown') {
    if (!merged.clockHm && clock) {
      merged.clockHm = clock;
      saveSlots(merged);
      commit.clockHm = clock;
    }
    merged.selectedIdent = commitIdent;
    saveSlots(merged);
    commit.selectedIdent = commitIdent;
    return commitFlight({ ident: commitIdent, session: commit, userText: t });
  }
  if (routeOptions.length >= 2) {
    return withChips(askWhichFlight(merged), 'time');
  }
  return withChips(askWhen(merged), 'time');
}

