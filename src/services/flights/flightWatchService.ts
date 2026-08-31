/**
 * Live-Watch für gebuchte Linienflüge (mehrere parallel).
 * Keine Nachtruhe — Gate, Band, Verspätung, Ausfall. Just-Do-It beim Ausfall.
 * CLK-Stubs werden per Strecke+Uhr zur echten Nummer aufgelöst.
 */

import type { GeminiConciergeResponse, QuickAction } from '../../types/concierge';
import {
  fetchFlightByFaId,
  fetchFlightByIdent,
  flightLiveDeparture,
  hasFlightAwareKey,
  searchRouteSchedule,
  type FlightStatus,
  type RouteScheduleHit,
} from './FlightTrackingService';
import { readFlightTripClocks, upsertFlightTripTimeline, clearFlightTripStops } from './flightTimeline';
import { compareAirportAccess } from './airportAccessCompare';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getFlightBufferStyle, pacingMinsForStyle } from './flightBufferProfile';
import { identsMatch, preferredIataIdent } from './flightIdent';
import { airportLageplanLink } from './airportIndoorMap';
import {
  buildBagWatchSpeech,
  buildCancelWatchActions,
  buildCancelWatchSpeech,
  buildDelayWatchSpeech,
  buildGateWatchSpeech,
  buildTerminalWatchSpeech,
  flightLooksCancelled,
  inferFlightWatchPhase,
  shouldSpeakLeaveShift,
  shouldSpeakWatchBag,
  shouldSpeakWatchDelay,
  shouldSpeakWatchGate,
  shouldSpeakWatchTerminal,
  shouldPushWatchGate,
  isPreDepartureAlertLive,
  classifyBoardStatus,
  shouldAnnounceBoarding,
  shouldScheduleBoardingPush,
  buildBoardingWatchSpeech,
  watchClock,
} from './flightWatchEvents';
import { lookupAirlineHotline } from './airlineHotline';
import { dateKeyFromMs, offsetDateKey } from '../../utils/dateKeys';
import {
  buildKiwiSearchPageUrl,
  buildKiwiTravelpayoutsUrl,
} from '../affiliate/travelpayoutsPartners';
import { CLOCK_SNAP_MIN, pickBestHitByClock } from './flightScheduleMatch';
import { airportTimeZone } from './airportIata';
import { flightWatchShouldPoll, flightWatchShouldPollAero } from './aeroApiBudget';
import {
  enrichFlightFromOriginBoard,
  hasPublicOriginBoard,
} from './originAirportBoard';
import { hydrateAirportBoardCatalog } from './airportBoardCatalog';
import {
  type ActiveFlightWatch,
  getFocusFlightWatch,
  hasCommittedFlightWatches,
  hydrateFlightWatches,
  listFlightWatches,
  persistFlightWatchesNow,
  pruneFlightWatches,
  replaceFlightWatch,
  resetFlightWatchesForTests,
  upsertFlightWatch,
} from './flightWatchStore';

export type { ActiveFlightWatch };
export {
  getFocusFlightWatch as getActiveFlightWatch,
  hasCommittedFlightWatches,
  hydrateFlightWatches,
  listFlightWatches,
  resetFlightWatchesForTests as resetFlightWatchForTests,
};

const DELAY_SPEAK_MIN = 20;

export function registerFlightWatch(opts: {
  ident: string;
  destLabel: string;
  airportName: string;
  airportLat: number;
  airportLng: number;
  luggage: 'carry' | 'checked' | 'unknown';
  flight: FlightStatus;
  originIata?: string | null;
  destIata?: string | null;
  dateKey?: string | null;
  clockHm?: string | null;
  previousIdent?: string | null;
}): void {
  const ident = preferredIataIdent(opts.ident.replace(/\s+/g, '').toUpperCase());
  const watch: ActiveFlightWatch = {
    ident,
    destLabel: opts.destLabel,
    airportName: opts.airportName,
    airportLat: opts.airportLat,
    airportLng: opts.airportLng,
    originIata: opts.originIata ?? null,
    destIata: opts.destIata ?? null,
    dateKey: opts.dateKey ?? null,
    clockHm: opts.clockHm ?? null,
    luggage: opts.luggage,
    lastFlight: opts.flight,
    lastSpokenDelayMin: Math.max(0, opts.flight.delayMin ?? 0),
    lastGate: opts.flight.departureGate,
    lastTerminal: opts.flight.departureTerminal,
    lastSpokenTerminal: null,
    lastBag: opts.flight.baggageClaim,
    lastLeaveMs: readFlightTripClocks(ident)?.leaveMs ?? null,
    lastInboundLateMin: 0,
    lastPollMs: 0,
    lastFidsPollMs: 0,
    lastAeroPollMs: 0,
    lastClkResolveMs: 0,
    announcedCancel: flightLooksCancelled(opts.flight),
    announcedBoarding: false,
    announcedLastCall: false,
    announcedSecurityWait: false,
  };
  upsertFlightWatch(watch, { previousIdent: opts.previousIdent ?? null });
  void syncBoardingAlert(watch);
  // Sofort Tafel nachziehen — Commit kann vor Gate-Publish gelaufen sein;
  // und 1.2MB-HAM-Fetch darf den Commit nicht blockieren wenn schon angestoßen.
  void (async () => {
    try {
      const enriched = await enrichFlightFromOriginBoard(opts.flight, {
        originIata: opts.originIata,
        dateKey: opts.dateKey,
        destIata: opts.destIata,
      });
      const changed =
        enriched.departureGate !== opts.flight.departureGate ||
        enriched.checkinDesk !== opts.flight.checkinDesk ||
        enriched.departureTerminal !== opts.flight.departureTerminal;
      if (!changed) return;
      const live = listFlightWatches().find((w) =>
        identsMatch(w.ident, ident),
      );
      if (!live) return;
      live.lastFlight = enriched;
      live.lastGate = enriched.departureGate;
      live.lastTerminal = enriched.departureTerminal;
      live.lastFidsPollMs = Date.now();
      await refreshTimeline(live, enriched);
      persistFlightWatchesNow();
    } catch {
      /* soft */
    }
  })();
}

export function clearFlightWatch(): void {
  resetFlightWatchesForTests();
}

function metersToAirport(watch: ActiveFlightWatch, lat: number, lng: number): number {
  const dLat = (watch.airportLat - lat) * 111_000;
  const dLng =
    (watch.airportLng - lng) * 111_000 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function watchPollCtx(watch: ActiveFlightWatch) {
  const store = useFinnusStore.getState();
  const lat = store.lastGpsLat;
  const lng = store.lastGpsLng;
  const distM =
    lat != null && lng != null ? metersToAirport(watch, lat, lng) : null;
  const nearAirport = distM != null && distM <= 5_000;
  const leaveMs =
    watch.lastLeaveMs ?? readFlightTripClocks(watch.ident)?.leaveMs ?? null;
  return { leaveMs, nearAirport, distM };
}

function inferTravelKind(
  speech: string,
  bullets: string[],
): 'delay' | 'gate' | 'boarding' | 'cancel' | 'flight' {
  const blob = `${speech} ${bullets.join(' ')}`.toLowerCase();
  if (/fällt aus|ausfall|cancel/.test(blob)) return 'cancel';
  if (/boarding|letzter aufruf/.test(blob)) return 'boarding';
  if (/gate/.test(blob)) return 'gate';
  if (/verspät/.test(blob)) return 'delay';
  return 'flight';
}

async function syncBoardingAlert(watch: ActiveFlightWatch): Promise<void> {
  const id = `travel:boarding:${watch.ident}`;
  const dep = flightLiveDeparture(watch.lastFlight);
  const fireAt = shouldScheduleBoardingPush({
    nowMs: Date.now(),
    liveDepMs: dep?.getTime() ?? null,
    actualOut: Boolean(watch.lastFlight.actualDeparture),
    cancelled: watch.announcedCancel,
    announcedBoarding: Boolean(watch.announcedBoarding),
    boardingWindowMin: pacingMinsForStyle(getFlightBufferStyle())
      .boardingWindowMin,
  });
  if (fireAt == null) {
    try {
      const { cancelTravelAlert } = await import(
        '../notifications/travelAlertNotifications'
      );
      await cancelTravelAlert(id);
    } catch {
      /* soft */
    }
    return;
  }
  const ident = watch.ident.startsWith('CLK')
    ? watch.clockHm || watch.destLabel
    : watch.ident;
  const gate = watch.lastFlight.departureGate;
  const speech = buildBoardingWatchSpeech({
    ident,
    gate,
    lastCall: false,
  });
  try {
    const { scheduleTravelAlertAt } = await import(
      '../notifications/travelAlertNotifications'
    );
    await scheduleTravelAlertAt({
      id,
      kind: 'boarding',
      title: `Flug ${ident} ${watch.destLabel}`.trim(),
      body: gate ? `Boarding · Gate ${gate}` : 'Boarding hat begonnen',
      fullText: speech,
      fireAtMs: fireAt,
      ident: watch.ident,
    });
  } catch (err) {
    if (__DEV__) console.warn('[flightWatch] boarding schedule failed', err);
  }
}

async function presentWatch(
  watch: ActiveFlightWatch,
  speech: string,
  bullets: string[],
  quickActions: QuickAction[] = [],
): Promise<void> {
  const ident = watch.ident.startsWith('CLK')
    ? watch.clockHm || watch.destLabel
    : watch.ident;
  const kind = inferTravelKind(speech, bullets);
  try {
    const { notifyTravelAlert, appIsForeground } = await import(
      '../notifications/travelAlertNotifications'
    );
    await notifyTravelAlert({
      id: `travel:${kind}:${watch.ident}`,
      kind,
      title: `Flug ${ident} ${watch.destLabel}`.trim(),
      body: bullets[0] || speech.slice(0, 90),
      fullText: speech,
      ident: watch.ident,
    });
    if (!appIsForeground()) return;
  } catch (err) {
    console.warn('[flightWatch] travel push failed', err);
  }
  try {
    const { presentConciergeResponse } = await import(
      '../concierge/presentConcierge'
    );
    const response: GeminiConciergeResponse = {
      speechText: speech,
      cardTitle: `Flug ${ident} ${watch.destLabel}`.trim(),
      visualBullets: bullets.slice(0, 3),
      quickActions,
    };
    await presentConciergeResponse(response, {
      skipAutoNav: true,
      alreadyGuarded: true,
    });
  } catch (err) {
    console.warn('[flightWatch] present failed', err);
  }
}

async function refreshTimeline(
  watch: ActiveFlightWatch,
  flight: FlightStatus,
  extra?: { securityWaitMin?: number },
): Promise<void> {
  if (flight.ident.startsWith('CLK')) return;
  const store = useFinnusStore.getState();
  const from =
    store.lastGpsLat != null && store.lastGpsLng != null
      ? { lat: store.lastGpsLat, lng: store.lastGpsLng }
      : null;
  const mins = pacingMinsForStyle(getFlightBufferStyle());
  const securityWaitMin = extra?.securityWaitMin ?? mins.securityWaitMin;
  const { buildAirportArrivalPlan, computeAirportArrivalTarget, AIRPORT_BUFFER_DEFAULTS } =
    await import('./FlightTrackingService');
  let plan = await buildAirportArrivalPlan({
    flightCode: flight.ident,
    from,
    airportCoords: { lat: watch.airportLat, lng: watch.airportLng },
    securityWaitMin,
    boardingWindowMin: mins.boardingWindowMin,
    dateKey: watch.dateKey ?? undefined,
    destIata: watch.destIata ?? undefined,
    originIata: watch.originIata,
    seedFlight: flight,
  });
  // Ohne AeroAPI: Plan aus Watch-Flight + Tafel-Enrich
  if (!plan) {
    const target = computeAirportArrivalTarget(flight, {
      boardingWindowMin: mins.boardingWindowMin,
      securityWaitMin,
      terminalWalkMin: AIRPORT_BUFFER_DEFAULTS.terminalWalkMin,
    });
    if (!target) return;
    plan = {
      flight,
      boardingWindowMin: mins.boardingWindowMin,
      securityWaitMin,
      terminalWalkMin: AIRPORT_BUFFER_DEFAULTS.terminalWalkMin,
      airportArrivalTarget: target,
      suggestedTransitLeave: null,
      transitItinerary: null,
      speechPreFlight: '',
      speechPostLanding: null,
    };
  }
  // Board-Felder (Gate/Check-in) aus Watch behalten falls Aero dünn ist
  plan.flight = {
    ...plan.flight,
    departureGate: flight.departureGate || plan.flight.departureGate,
    departureTerminal:
      flight.departureTerminal || plan.flight.departureTerminal,
    checkinDesk: flight.checkinDesk || plan.flight.checkinDesk,
    baggageClaim: flight.baggageClaim || plan.flight.baggageClaim,
  };
  // Nochmal Origin-Tafel — Gate-Wechsel / Check-in nachziehen
  try {
    plan.flight = await enrichFlightFromOriginBoard(plan.flight, {
      originIata: watch.originIata,
      dateKey: watch.dateKey,
      destIata: watch.destIata,
    });
  } catch {
    /* soft */
  }
  if (extra?.securityWaitMin != null) {
    plan.securityWaitMin = extra.securityWaitMin;
  }
  let access = {
    transitLeaveMs: plan.suggestedTransitLeave?.getTime() ?? null,
    transitMin: plan.transitItinerary
      ? Math.round(plan.transitItinerary.durationSec / 60)
      : null,
    taxiMin: 25,
    journeyDetail: null as string | null,
    recommend: 'either' as const,
    transit: plan.transitItinerary,
  };
  if (from) {
    const cmp = await compareAirportAccess({
      from,
      airport: {
        lat: watch.airportLat,
        lng: watch.airportLng,
        name: watch.airportName,
      },
      arriveBy: plan.airportArrivalTarget,
    });
    access = {
      transitLeaveMs: cmp.transitLeaveMs,
      transitMin: cmp.transitMin,
      taxiMin: cmp.taxiMin,
      journeyDetail: cmp.journeyDetail,
      recommend: cmp.recommend,
      transit: cmp.transit,
    };
  }
  upsertFlightTripTimeline({
    ident: flight.ident,
    destLabel: watch.destLabel,
    airportName: watch.airportName,
    airportLat: watch.airportLat,
    airportLng: watch.airportLng,
    plan,
    access,
    luggage: watch.luggage,
    originIata: watch.originIata,
    gateBufferMin: mins.gateBufferMin,
    checkinMin: mins.checkinMin,
    arriveToDeskMin: mins.arriveToDeskMin,
    previousIdent: watch.ident.startsWith('CLK') ? watch.ident : null,
  });
}

function nextDateKey(dateKey: string): string {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const dt = new Date(y!, (mo ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
  dt.setDate(dt.getDate() + 1);
  return dateKeyFromMs(dt.getTime());
}

async function findReplacement(
  watch: ActiveFlightWatch,
  afterMs: number,
): Promise<RouteScheduleHit | null> {
  if (!watch.originIata || !watch.destIata) return null;
  const days = [
    watch.dateKey,
    watch.dateKey ? nextDateKey(watch.dateKey) : offsetDateKey(1),
  ].filter((k, i, arr): k is string => Boolean(k) && arr.indexOf(k) === i);

  for (const dateKey of days) {
    let hits: RouteScheduleHit[] = [];
    try {
      hits = await searchRouteSchedule({
        originIata: watch.originIata,
        destIata: watch.destIata,
        dateKey,
        afterMs,
      });
    } catch {
      hits = [];
    }
    const next = hits
      .filter((h) => !identsMatch(h.ident, watch.ident))
      .map((h) => ({
        hit: h,
        t: (h.estimatedDeparture ?? h.scheduledDeparture)?.getTime() ?? 0,
      }))
      .filter((x) => x.t > afterMs + 8 * 60_000)
      .sort((a, b) => a.t - b.t)[0];
    if (next) return next.hit;
  }
  return null;
}

function kiwiForWatch(watch: ActiveFlightWatch): string | null {
  if (!watch.originIata || !watch.destIata || !watch.dateKey) return null;
  const page = buildKiwiSearchPageUrl({
    fromIata: watch.originIata,
    toIata: watch.destIata,
    dateKey: watch.dateKey,
  });
  return buildKiwiTravelpayoutsUrl(page, { subId: 'flightwatch' });
}

export async function resolveIdentFromSchedule(opts: {
  originIata: string;
  destIata: string;
  dateKey: string;
  clockHm: string;
}): Promise<RouteScheduleHit | null> {
  try {
    const hits = await searchRouteSchedule({
      originIata: opts.originIata,
      destIata: opts.destIata,
      dateKey: opts.dateKey,
      clockHm: opts.clockHm,
    });
    return pickBestHitByClock(
      hits,
      opts.clockHm,
      CLOCK_SNAP_MIN,
      airportTimeZone(opts.originIata),
    );
  } catch {
    return null;
  }
}

async function fetchWatched(watch: ActiveFlightWatch): Promise<FlightStatus | null> {
  if (watch.ident.startsWith('CLK')) return null;
  const faId = watch.lastFlight.faFlightId;
  if (faId) {
    try {
      const byId = await fetchFlightByFaId(faId);
      if (byId) return byId;
    } catch {
      /* ident fallback */
    }
  }
  return fetchFlightByIdent(watch.ident, {
    dateKey: watch.dateKey ?? undefined,
    destIata: watch.destIata ?? undefined,
    faFlightId: faId,
    includeCancelled: true,
  });
}

async function maybeResolveClk(
  watch: ActiveFlightWatch,
): Promise<ActiveFlightWatch> {
  if (!watch.ident.startsWith('CLK')) return watch;
  if (!watch.originIata || !watch.destIata || !watch.dateKey || !watch.clockHm) {
    return watch;
  }
  const hit = await resolveIdentFromSchedule({
    originIata: watch.originIata,
    destIata: watch.destIata,
    dateKey: watch.dateKey,
    clockHm: watch.clockHm,
  });
  if (!hit) return watch;
  const ident = preferredIataIdent(hit.ident);
  const nextDep = hit.estimatedDeparture ?? hit.scheduledDeparture;
  const next: ActiveFlightWatch = {
    ...watch,
    ident,
    lastFlight: {
      ...watch.lastFlight,
      ident,
      scheduledDeparture: hit.scheduledDeparture ?? nextDep,
      estimatedDeparture: nextDep,
    },
    lastPollMs: 0,
  };
  try {
    clearFlightTripStops(watch.ident);
  } catch {
    /* soft */
  }
  replaceFlightWatch(watch, next);
  return next;
}

async function tickOneWatch(
  watch: ActiveFlightWatch,
  nowMs: number,
  many: boolean,
): Promise<void> {
  const dep = flightLiveDeparture(watch.lastFlight);
  const ctx = watchPollCtx(watch);
  const departed = Boolean(watch.lastFlight.actualDeparture);
  const arrived = Boolean(watch.lastFlight.actualArrival);
  const hasBoard = hasPublicOriginBoard(watch.originIata);
  const canDiscover =
    Boolean(watch.originIata) &&
    Boolean(watch.ident) &&
    !watch.ident.startsWith('CLK');
  const wantFids =
    (hasBoard || canDiscover) &&
    flightWatchShouldPoll({
      dep,
      now: nowMs,
      lastPollMs: watch.lastFidsPollMs ?? 0,
      departed: false,
      arrived: false,
    });
  const wantAero =
    hasFlightAwareKey() &&
    flightWatchShouldPollAero({
      dep,
      now: nowMs,
      lastPollMs: watch.lastAeroPollMs ?? 0,
      departed,
      arrived,
      hasOriginBoard: hasBoard,
    });
  if (!wantFids && !wantAero) {
    return;
  }
  watch.lastPollMs = nowMs;
  if (wantFids) watch.lastFidsPollMs = nowMs;
  if (wantAero) watch.lastAeroPollMs = nowMs;
  watch = await maybeResolveClk(watch);

  let fresh: FlightStatus | null = watch.lastFlight;
  if (wantFids) {
    fresh = await enrichFlightFromOriginBoard(fresh, {
      originIata: watch.originIata,
      dateKey: watch.dateKey,
      destIata: watch.destIata,
    });
  }
  if (wantAero) {
    const aero = await fetchWatched(watch);
    if (aero) {
      fresh = {
        ...aero,
        departureGate: fresh.departureGate || aero.departureGate,
        departureTerminal: fresh.departureTerminal || aero.departureTerminal,
        checkinDesk: fresh.checkinDesk || aero.checkinDesk,
        cancelled: fresh.cancelled || aero.cancelled,
      };
    }
  }
  if (!fresh) {
    persistFlightWatchesNow();
    return;
  }

  const liveDep = flightLiveDeparture(fresh);
  const untilMs = (liveDep?.getTime() ?? nowMs) - nowMs;
  const leavePassed =
    ctx.leaveMs != null && nowMs >= ctx.leaveMs - 8 * 60_000;
  const phase = inferFlightWatchPhase({
    untilMs,
    distM: ctx.distM ?? null,
    nearAirport: ctx.nearAirport,
    leavePassed,
    departed: Boolean(fresh.actualDeparture),
    arrived: Boolean(fresh.actualArrival),
  });
  const depLive = isPreDepartureAlertLive({
    nowMs,
    liveDepMs: liveDep?.getTime() ?? null,
    actualOut: Boolean(fresh.actualDeparture),
    cancelled: flightLooksCancelled(fresh),
    status: fresh.status,
  });

  const prev = watch.lastFlight;
  const messages: string[] = [];
  const bullets: string[] = [];
  let actions: QuickAction[] = [];
  let cancelledNow = false;
  const identShown = preferredIataIdent(fresh.ident || watch.ident);

  if (flightLooksCancelled(fresh) && !watch.announcedCancel) {
    cancelledNow = true;
    watch.announcedCancel = true;
    const after =
      flightLiveDeparture(prev)?.getTime() ??
      flightLiveDeparture(fresh)?.getTime() ??
      nowMs;
    const alt = await findReplacement(watch, after);
    const altIdent = alt ? preferredIataIdent(alt.ident) : null;
    const altClock = alt
      ? watchClock(alt.estimatedDeparture ?? alt.scheduledDeparture)
      : null;
    const hotline = lookupAirlineHotline(fresh.ident || watch.ident);
    const spoken = buildCancelWatchSpeech({
      ident: identShown,
      destLabel: watch.destLabel,
      altIdent,
      altClock,
      airlineName: hotline?.name ?? null,
    });
    messages.push(spoken.speech);
    bullets.push(...spoken.bullets);
    actions = buildCancelWatchActions({
      cancelledIdent: fresh.ident || watch.ident,
      altIdent,
      altClock,
      kiwiUrl: kiwiForWatch(watch),
    });
  }

  if (fresh.diverted && !prev.diverted && !cancelledNow) {
    const where =
      fresh.destinationName || fresh.destinationCode || 'einem anderen Flughafen';
    messages.push(`${identShown} wird nach ${where} umgeleitet.`);
    bullets.push('Umleitung');
    const hotline = lookupAirlineHotline(fresh.ident || watch.ident);
    if (hotline) {
      actions.push({
        type: 'DIAL_PHONE',
        label: `📞 ${hotline.name}`,
        payload: { phoneNumber: hotline.e164 },
      });
    }
  }

  const delay = Math.max(0, fresh.delayMin ?? 0);
  let timelineFresh = false;
  const delayHard =
    !cancelledNow &&
    delay >= DELAY_SPEAK_MIN &&
    delay - watch.lastSpokenDelayMin >= DELAY_SPEAK_MIN;
  if (delayHard && depLive && shouldSpeakWatchDelay(phase, untilMs)) {
    const prevLeave = watch.lastLeaveMs ?? readFlightTripClocks(watch.ident)?.leaveMs ?? null;
    await refreshTimeline(watch, fresh);
    timelineFresh = true;
    const clocks = readFlightTripClocks(fresh.ident || watch.ident);
    const nextLeave = clocks?.leaveMs ?? 0;
    const speakLeave = shouldSpeakLeaveShift({
      prevLeaveMs: prevLeave,
      nextLeaveMs: nextLeave,
      nowMs,
    });
    messages.push(
      buildDelayWatchSpeech({
        ident: identShown,
        delayMin: delay,
        depMs: flightLiveDeparture(fresh)?.getTime() ?? null,
        leaveMs: nextLeave || null,
        speakLeave,
      }),
    );
    bullets.push(`+${delay} Min Verspätung`);
    watch.lastSpokenDelayMin = delay;
    if (clocks?.leaveMs) watch.lastLeaveMs = clocks.leaveMs;
  } else if (delayHard) {
    watch.lastSpokenDelayMin = delay;
  }

  if (
    !cancelledNow &&
    phase !== 'landed' &&
    shouldSpeakWatchTerminal(phase) &&
    fresh.departureTerminal &&
    fresh.departureTerminal !== watch.lastSpokenTerminal
  ) {
    messages.push(
      buildTerminalWatchSpeech({
        ident: identShown,
        terminal: fresh.departureTerminal,
        prevTerminal: watch.lastSpokenTerminal,
      }) + (many ? ` (${watch.destLabel})` : ''),
    );
    bullets.push(`Terminal ${fresh.departureTerminal}`);
    watch.lastSpokenTerminal = fresh.departureTerminal;
  }

  if (
    !cancelledNow &&
    depLive &&
    shouldPushWatchGate(phase, untilMs) &&
    fresh.departureGate
  ) {
    const gateChanged = Boolean(
      prev.departureGate && fresh.departureGate !== prev.departureGate,
    );
    const firstAirsideGate =
      !prev.departureGate && fresh.departureGate !== watch.lastGate;
    if (gateChanged || firstAirsideGate) {
      messages.push(
        buildGateWatchSpeech({
          ident: identShown,
          gate: fresh.departureGate,
          prevGate: gateChanged ? prev.departureGate : null,
        }) + (many ? ` (${watch.destLabel})` : ''),
      );
      bullets.push(`Gate ${fresh.departureGate}`);
      const mapLink = airportLageplanLink({
        originIata: watch.originIata ?? '',
        gate: fresh.departureGate,
      });
      if (mapLink) {
        actions.push({
          type: 'OPEN_URL',
          label: mapLink.label,
          payload: { url: mapLink.url },
        });
      }
    }
  }

  const boardKind = classifyBoardStatus(fresh.status);
  const boardingWindowMs =
    pacingMinsForStyle(getFlightBufferStyle()).boardingWindowMin * 60_000;
  if (
    !cancelledNow &&
    depLive &&
    shouldAnnounceBoarding({
      boardKind,
      untilMs,
      boardingWindowMs,
      phase,
      announcedBoarding: Boolean(watch.announcedBoarding),
      announcedLastCall: Boolean(watch.announcedLastCall),
    })
  ) {
    const lastCall = boardKind === 'last_call';
    messages.push(
      buildBoardingWatchSpeech({
        ident: identShown,
        gate: fresh.departureGate,
        lastCall,
      }),
    );
    bullets.push(lastCall ? 'Letzter Aufruf' : 'Boarding');
    if (fresh.departureGate) bullets.push(`Gate ${fresh.departureGate}`);
    watch.announcedBoarding = true;
    if (lastCall) watch.announcedLastCall = true;
  }

  if (
    !cancelledNow &&
    shouldSpeakWatchBag(phase) &&
    watch.luggage === 'checked' &&
    fresh.baggageClaim &&
    fresh.baggageClaim !== watch.lastBag
  ) {
    messages.push(
      buildBagWatchSpeech({
        destLabel: watch.destLabel,
        bag: fresh.baggageClaim,
      }),
    );
    bullets.push(`Band ${fresh.baggageClaim}`);
    watch.lastBag = fresh.baggageClaim;
  }

  // ~2 h vor Security: einmal Live-Wartezeit (HAM), Timeline updaten
  if (
    !cancelledNow &&
    !watch.announcedSecurityWait &&
    depLive &&
    /^HAM$/i.test(watch.originIata || '')
  ) {
    try {
      const mins = pacingMinsForStyle(getFlightBufferStyle());
      const liveDepMs = flightLiveDeparture(fresh)?.getTime();
      if (liveDepMs != null) {
        const { computeFlightPacing } = require('./flightPacing') as {
          computeFlightPacing: (o: {
            depMs: number;
            boardingWindowMin: number;
            securityWaitMin: number;
            luggage: 'carry' | 'checked' | 'unknown';
            gateBufferMin?: number;
            checkinMin?: number;
            arriveToDeskMin?: number;
          }) => { securityMs: number };
        };
        const pacing = computeFlightPacing({
          depMs: liveDepMs,
          boardingWindowMin: mins.boardingWindowMin,
          securityWaitMin: mins.securityWaitMin,
          luggage: watch.luggage,
          gateBufferMin: mins.gateBufferMin,
          checkinMin: mins.checkinMin,
          arriveToDeskMin: mins.arriveToDeskMin,
        });
        const untilSec = pacing.securityMs - nowMs;
        if (untilSec <= 2 * 60 * 60_000 && untilSec >= -15 * 60_000) {
          const { fetchHamSecurityWaitMin } = await import('./originAirportBoard');
          const live = await fetchHamSecurityWaitMin();
          if (live != null && live >= 1) {
            watch.announcedSecurityWait = true;
            messages.push(
              `Sicherheitskontrolle am Flughafen gerade etwa ${live} Minuten.`,
            );
            bullets.push(`Security ca. ${live} Min`);
            if (!timelineFresh) {
              await refreshTimeline(watch, fresh, { securityWaitMin: live });
              timelineFresh = true;
            }
          }
        }
      }
    } catch {
      /* soft */
    }
  }

  if (
    fresh.inboundFaFlightId &&
    !cancelledNow &&
    depLive &&
    phase !== 'landed' &&
    shouldSpeakWatchDelay(phase, untilMs)
  ) {
    try {
      const inbound = await fetchFlightByFaId(fresh.inboundFaFlightId);
      const inDelay = Math.max(0, inbound?.delayMin ?? 0);
      if (
        inbound &&
        !inbound.actualArrival &&
        inDelay >= DELAY_SPEAK_MIN &&
        inDelay - watch.lastInboundLateMin >= DELAY_SPEAK_MIN
      ) {
        messages.push(
          `Der Zubringer nach ${watch.destLabel} ist noch unterwegs (+${inDelay} Min) — extra Puffer.`,
        );
        bullets.push(`Zubringer +${inDelay} Min`);
        watch.lastInboundLateMin = inDelay;
      }
    } catch {
      /* optional */
    }
  }

  watch.lastFlight = fresh;
  watch.lastGate = fresh.departureGate;
  watch.lastTerminal = fresh.departureTerminal;
  if (!fresh.ident.startsWith('CLK')) {
    watch.ident = preferredIataIdent(fresh.ident);
  }

  const silentTimeline =
    !cancelledNow &&
    ((fresh.delayMin ?? 0) !== (prev.delayMin ?? 0) ||
      fresh.departureGate !== prev.departureGate ||
      fresh.departureTerminal !== prev.departureTerminal ||
      fresh.checkinDesk !== prev.checkinDesk ||
      fresh.baggageClaim !== prev.baggageClaim ||
      fresh.cancelled !== prev.cancelled);

  if (messages.length) {
    if (!cancelledNow && !timelineFresh) {
      await refreshTimeline(watch, fresh);
      const clocks = readFlightTripClocks(watch.ident);
      if (clocks?.leaveMs) watch.lastLeaveMs = clocks.leaveMs;
    }
    await presentWatch(watch, messages.join(' '), bullets, actions);
  } else if (silentTimeline) {
    await refreshTimeline(watch, fresh);
    const clocks = readFlightTripClocks(watch.ident);
    if (clocks?.leaveMs) watch.lastLeaveMs = clocks.leaveMs;
  }
  persistFlightWatchesNow();
  void syncBoardingAlert(watch);
}

/**
 * Background tick — alle gemerkten Flüge. Keine Nachtruhe.
 */
export async function tickFlightWatch(nowMs = Date.now()): Promise<void> {
  await hydrateFlightWatches();
  await hydrateAirportBoardCatalog();
  pruneFlightWatches(nowMs);
  const all = listFlightWatches();
  if (!all.length) return;
  const many = all.length > 1;
  for (const w of all) {
    try {
      await tickOneWatch(w, nowMs, many);
    } catch (err) {
      console.warn('[flightWatch] tick one failed', w.ident, err);
    }
  }
}
