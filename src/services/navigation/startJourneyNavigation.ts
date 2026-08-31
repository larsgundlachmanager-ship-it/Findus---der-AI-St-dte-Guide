/**
 * ÖPNV-Journey → Multi-Stop-Tour + Timeline (zu Fuß → Bahn → Umstieg → Ziel).
 */

import type { JourneyItinerary, JourneyLeg } from '../transit/journeyPlanner';
import {
  pathFromJourneyLeg,
  isTransitJourneyMode,
} from '../transit/journeyPath';
import { formatDistanceKmOrM, formatDurationMinutesDe } from './travelEta';
import { geocodePlaceName } from './googleMapsNav';
import { searchDbLocations } from '../transit/dbRestJourneys';
import { snapTransitHalt } from '../transit/osmTransitGeom';
import {
  startMultiStopTour,
  type MultiStopTour,
  type TourStop,
  type TourStopRole,
} from './multiStopTour';
import { addPlanStop } from '../../module2/timeline/planLiveEdits';
import { useFinnusStore } from '../../store/useFinnusStore';
import type { NavWaypoint } from './navigationTypes';
import { formatJourneyForConcierge } from '../transit/formatJourneyCard';
import { tidyHaltName, concreteHaltLabel } from '../transit/haltName';
import { STATION_ARRIVE_BEFORE_MIN } from '../transit/stationArriveBuffer';
import {
  collapseJourneyTourStops,
  foldTinyTransfers,
} from './journeyTourStops';
import {
  lastWalkSpeech,
  transferWalkSpeech,
} from './transitGuideSpeech';

function asDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (Number.isFinite(d.getTime())) return d;
  }
  return null;
}

function clock(d: Date | null | undefined): string {
  const date = asDate(d) ?? new Date();
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function tidyPlaceName(raw: string, fallback: string): string {
  const n = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!n || /^(end|ziel|destination|stop|halt)$/i.test(n)) return fallback;
  return n;
}

function stationPlaceName(
  raw: string,
  mode?: string | null,
  extra?: { line?: string | null; headsign?: string | null; role?: string | null },
): string {
  return concreteHaltLabel({
    name: raw,
    mode,
    line: extra?.line,
    headsign: extra?.headsign,
    role: extra?.role,
  });
}

function notesForLeg(leg: JourneyLeg): string {
  const start = asDate(leg.startTime);
  const end = asDate(leg.endTime);
  const mins = Math.max(
    1,
    Math.round(
      Number.isFinite(leg.durationSec)
        ? leg.durationSec / 60
        : start && end
          ? (end.getTime() - start.getTime()) / 60_000
          : 1,
    ),
  );
  const bits: string[] = [];
  if (start && end) bits.push(`${clock(start)}–${clock(end)}`);
  if (isTransitJourneyMode(leg.mode)) {
    if (leg.line) bits.push(leg.line);
    if (leg.headsign) bits.push(`nach ${leg.headsign}`);
    const plat = (leg.fromPlatform || '').trim();
    if (plat) bits.push(`Gleis ${plat}`);
    if (typeof leg.delaySec === 'number' && leg.delaySec >= 60) {
      bits.push(`+${Math.round(leg.delaySec / 60)} Min`);
    }
    const n = leg.stationCount;
    if (n != null && n >= 1) {
      bits.push(n === 1 ? '1 Halt' : `${n} Halte`);
    }
  } else if (leg.distanceM != null && Number.isFinite(leg.distanceM)) {
    bits.push(formatDistanceKmOrM(leg.distanceM));
  }
  bits.push(formatDurationMinutesDe(mins, 'short'));
  return bits.join(' · ');
}

function haltSearchQuery(name: string): string {
  const n = tidyHaltName(name) || name;
  if (/\b(bahnhof|hbf|haltepunkt|haltestelle|station)\b/iu.test(n)) return n;
  return `Bahnhof ${n}`;
}

async function resolveHaltPoint(opts: {
  lat: number | null | undefined;
  lng: number | null | undefined;
  name: string;
  bias: { lat: number; lng: number };
  platform?: string | null;
  mode?: JourneyLeg['mode'] | null;
}): Promise<{ lat: number; lng: number; name: string } | null> {
  const label = tidyHaltName(opts.name) || opts.name;
  let lat = opts.lat;
  let lng = opts.lng;
  if (
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    try {
      const hits = await searchDbLocations(haltSearchQuery(opts.name), {
        lat: opts.bias.lat,
        lng: opts.bias.lng,
        results: 5,
      });
      const hit = hits[0];
      if (hit) {
        lat = hit.lat;
        lng = hit.lng;
      }
    } catch {
      /* soft */
    }
  }
  if (
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    try {
      const g = await geocodePlaceName(haltSearchQuery(opts.name), {
        biasLat: opts.bias.lat,
        biasLng: opts.bias.lng,
      });
      if (g) {
        lat = g.lat;
        lng = g.lng;
      }
    } catch {
      /* soft */
    }
  }
  if (
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }
  // OSM-Bahnsteig-Snap nicht blockierend — Feed/DB-GPS reicht zum Start.
  return { lat, lng, name: label };
}

async function snapJourneyHaltsInBackground(initial: TourStop[]): Promise<void> {
  const snaps = await Promise.all(
    initial.map(async (s, i) => {
      if (
        s.role !== 'walk' &&
        s.role !== 'alight' &&
        s.role !== 'transfer' &&
        s.role !== 'board'
      ) {
        return null;
      }
      const kind = s.vehicleMode === 'BUS' ? 'bus' : 'rail';
      try {
        const snapped = await snapTransitHalt({
          name: s.name,
          lat: s.lat,
          lng: s.lng,
          platform: s.platform,
          kind,
        });
        if (!snapped) return null;
        const dLat = snapped.lat - s.lat;
        const dLng = snapped.lng - s.lng;
        const m = Math.hypot(
          dLat * 111_320,
          dLng * 111_320 * Math.cos((s.lat * Math.PI) / 180),
        );
        const maxM = kind === 'bus' ? 180 : 4000;
        if (m > maxM || m < 4) return null;
        return { i, lat: snapped.lat, lng: snapped.lng };
      } catch {
        return null;
      }
    }),
  );
  const tour = useFinnusStore.getState().multiStopTour;
  if (!tour?.stops?.length) return;
  let changed = false;
  const nextStops = tour.stops.slice();
  for (const snap of snaps) {
    if (!snap) continue;
    const cur = nextStops[snap.i];
    if (!cur || cur.done) continue;
    nextStops[snap.i] = { ...cur, lat: snap.lat, lng: snap.lng };
    changed = true;
  }
  if (!changed) return;
  try {
    const { clearTourAheadRouteCache } = require('./tourAheadRouteCache') as {
      clearTourAheadRouteCache: () => void;
    };
    clearTourAheadRouteCache();
  } catch {
    /* soft */
  }
  useFinnusStore.getState().setMultiStopTour({ ...tour, stops: nextStops });
  try {
    const { notifyNavRouteGeometryChanged } = require('./navRouteRev') as {
      notifyNavRouteGeometryChanged: () => void;
    };
    notifyNavRouteGeometryChanged();
  } catch {
    /* soft */
  }
}

async function resolveLegPoint(
  lat: number | null | undefined,
  lng: number | null | undefined,
  name: string,
  bias: { lat: number; lng: number },
): Promise<{ lat: number; lng: number; name: string } | null> {
  if (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    return { lat, lng, name: tidyHaltName(name) || name };
  }
  try {
    const g = await geocodePlaceName(name, {
      biasLat: bias.lat,
      biasLng: bias.lng,
    });
    if (g) {
      return { lat: g.lat, lng: g.lng, name: tidyHaltName(name) || name };
    }
  } catch {
    /* soft */
  }
  return null;
}

/** Zwischenhalte + Ausstieg → Stationskette für Countdown. */
export function stationsFromTransitLeg(leg: JourneyLeg): NavWaypoint[] {
  const out: NavWaypoint[] = [];
  for (const s of leg.intermediateStops ?? []) {
    if (s.lat == null || s.lng == null) continue;
    out.push({
      lat: s.lat,
      lng: s.lng,
      maneuver: null,
      roadName: null,
      landmark: null,
      cue: null,
      instruction: null,
      isStation: true,
      stationName: s.name,
    });
  }
  if (
    leg.toLat != null &&
    leg.toLng != null &&
    Number.isFinite(leg.toLat) &&
    Number.isFinite(leg.toLng)
  ) {
    out.push({
      lat: leg.toLat,
      lng: leg.toLng,
      maneuver: null,
      roadName: null,
      landmark: null,
      cue: null,
      instruction: null,
      isStation: true,
      stationName: leg.toName,
    });
  }
  return out;
}

/**
 * Baut Tour-Stops aus Journey-Beinen + Finalziel.
 * walk → board Halt · ride → alight · transfer · walk → dest
 */
export async function buildTourStopsFromJourney(opts: {
  itinerary: JourneyItinerary;
  destName: string;
  destLat: number;
  destLng: number;
  originLat: number;
  originLng: number;
}): Promise<TourStop[]> {
  const bias = { lat: opts.originLat, lng: opts.originLng };
  const stops: TourStop[] = [];
  const seen = new Set<string>();

  const push = (s: TourStop) => {
    const key = `${s.name.toLowerCase()}|${s.lat.toFixed(4)}|${s.lng.toFixed(4)}|${s.role ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    stops.push(s);
  };

  let pendingTransfer = false;
  const legs = opts.itinerary.legs ?? [];
  for (let li = 0; li < legs.length; li += 1) {
    const leg = legs[li]!;
    if (leg.mode === 'WALK' || leg.mode === 'BIKE') {
        const nextTransit = legs.slice(li + 1).find((l) => isTransitJourneyMode(l.mode));
        const toName = tidyPlaceName(leg.toName, opts.destName);
        const to = nextTransit
          ? await resolveHaltPoint({
              lat: nextTransit.fromLat,
              lng: nextTransit.fromLng,
              name: nextTransit.fromName || toName,
              bias,
              platform: nextTransit.fromPlatform,
              mode: nextTransit.mode,
            })
          : await resolveLegPoint(leg.toLat, leg.toLng, toName, bias);
      if (to) {
        const role: TourStopRole = pendingTransfer ? 'transfer' : 'walk';
        const nearDest =
          !nextTransit &&
          Math.abs(to.lat - opts.destLat) < 1e-4 &&
          Math.abs(to.lng - opts.destLng) < 1e-4;
        const stopName = nearDest
          ? opts.destName
          : nextTransit
            ? stationPlaceName(to.name, nextTransit.mode, {
                line: nextTransit.line,
                headsign: nextTransit.headsign,
                role: 'board',
              })
            : toName;
        push({
          poiId: -1,
          name: stopName,
          lat: to.lat,
          lng: to.lng,
          done: false,
          role: nearDest ? 'dest' : role,
          line: nextTransit?.line ?? null,
          headsign: nextTransit?.headsign ?? null,
          platform: nextTransit?.fromPlatform ?? null,
          delaySec: nextTransit?.delaySec ?? null,
          vehicleMode: nextTransit?.mode ?? null,
          vehicleStartMs: nextTransit
            ? asDate(nextTransit.startTime)?.getTime() ?? null
            : null,
          startMs: asDate(leg.startTime)?.getTime() ?? null,
          endMs: asDate(leg.endTime)?.getTime() ?? null,
          durationSec: leg.durationSec,
          distanceM: leg.distanceM,
          notes: notesForLeg(leg),
          path: pathFromJourneyLeg(leg),
          speakOnStart:
            role === 'transfer'
              ? transferWalkSpeech({
                  line: nextTransit?.line ?? null,
                  headsign: nextTransit?.headsign ?? null,
                  platform: nextTransit?.fromPlatform ?? null,
                  haltName: to.name,
                  alightName: nextTransit?.toName ?? null,
                  waitMin: null,
                  remainingStops: nextTransit?.stationCount ?? null,
                  rideMin: null,
                  destWalkM: null,
                  destName: opts.destName,
                  vehicle:
                    nextTransit?.mode === 'BUS'
                      ? 'Bus'
                      : nextTransit?.mode === 'FERRY'
                        ? 'ÖPNV'
                        : 'Bahn',
                })
              : nearDest
                ? lastWalkSpeech({
                    line: null,
                    headsign: null,
                    platform: null,
                    haltName: null,
                    alightName: null,
                    waitMin: null,
                    remainingStops: null,
                    rideMin: null,
                    destWalkM: leg.distanceM,
                    destName: opts.destName,
                    vehicle: 'ÖPNV',
                  })
                : `Zu Fuß zur Haltestelle ${to.name}.`,
        });
      }
      pendingTransfer = false;
      continue;
    }

    // Transit: Ziel = Ausstieg; Stationskette für Live-Countdown
    const to = await resolveHaltPoint({
      lat: leg.toLat,
      lng: leg.toLng,
      name: leg.toName,
      bias,
      platform: leg.toPlatform ?? null,
      mode: leg.mode,
    });
    if (to) {
      const stations = stationsFromTransitLeg(leg);
      // Falls Ausstieg ohne Coords in intermediates: Ziel ans Ende
      if (
        stations.length &&
        (Math.abs(stations[stations.length - 1]!.lat - to.lat) > 1e-4 ||
          Math.abs(stations[stations.length - 1]!.lng - to.lng) > 1e-4)
      ) {
        stations.push({
          lat: to.lat,
          lng: to.lng,
          maneuver: null,
          roadName: null,
          landmark: null,
          cue: null,
          instruction: null,
          isStation: true,
          stationName: to.name,
        });
      }
      push({
        poiId: -1,
        name: stationPlaceName(to.name, leg.mode, {
          line: leg.line,
          headsign: leg.headsign,
          role: 'alight',
        }),
        lat: to.lat,
        lng: to.lng,
        done: false,
        role: 'alight',
        line: leg.line,
        headsign: leg.headsign,
        platform: leg.toPlatform ?? null,
        delaySec: leg.delaySec ?? null,
        vehicleMode: leg.mode,
        stations: stations.length ? stations : undefined,
        stationCount: leg.stationCount ?? (stations.length || null),
        startMs: asDate(leg.startTime)?.getTime() ?? null,
        endMs: asDate(leg.endTime)?.getTime() ?? null,
        durationSec: leg.durationSec,
        distanceM: leg.distanceM,
        notes: notesForLeg(leg),
        path: pathFromJourneyLeg(leg),
      });
      pendingTransfer = true;
    }
  }

  const lastStop = stops[stops.length - 1];
  const destAlready =
    lastStop &&
    Math.abs(lastStop.lat - opts.destLat) < 1e-4 &&
    Math.abs(lastStop.lng - opts.destLng) < 1e-4;
  if (!destAlready) {
    push({
      poiId: -1,
      name: opts.destName,
      lat: opts.destLat,
      lng: opts.destLng,
      done: false,
      role: 'dest',
      startMs: asDate(opts.itinerary.endTime)?.getTime() ?? null,
      notes: `Ankunft ~${clock(asDate(opts.itinerary.endTime))}`,
      speakOnStart: lastWalkSpeech({
        line: null,
        headsign: null,
        platform: null,
        haltName: null,
        alightName: null,
        waitMin: null,
        remainingStops: null,
        rideMin: null,
        destWalkM:
          lastStop?.role === 'walk' ||
          lastStop?.role === 'transfer' ||
          lastStop?.role === 'dest'
            ? lastStop.distanceM ?? null
            : null,
        destName: opts.destName,
        vehicle: 'ÖPNV',
      }),
    });
  }

  if (!stops.length) {
    push({
      poiId: -1,
      name: opts.destName,
      lat: opts.destLat,
      lng: opts.destLng,
      done: false,
      role: 'dest',
    });
  }

  for (let i = 0; i < stops.length - 1; i += 1) {
    const cur = stops[i]!;
    const nxt = stops[i + 1]!;
    if (
      (cur.role === 'walk' || cur.role === 'transfer' || cur.role === 'board') &&
      nxt.role === 'alight'
    ) {
      cur.line = cur.line || nxt.line;
      cur.headsign = cur.headsign || nxt.headsign;
      cur.delaySec = cur.delaySec ?? nxt.delaySec;
      cur.vehicleMode = cur.vehicleMode || nxt.vehicleMode;
      cur.vehicleStartMs = nxt.startMs ?? null;
    }
    if (cur.role === 'alight' && nxt.role === 'alight') {
      cur.headsign = cur.headsign || nxt.headsign;
      cur.vehicleStartMs = nxt.startMs ?? null;
    }
  }

  const collapsed = collapseJourneyTourStops(
    foldTinyTransfers(stops).slice(0, 10),
    { lat: opts.destLat, lng: opts.destLng, name: opts.destName },
  );
  return collapsed;
}

/** Timeline-Einträge: ÖPNV-Akkordeon + Ziel-Stopp. */
export function addJourneyToTimeline(opts: {
  itinerary: JourneyItinerary;
  destName: string;
  destLat: number;
  destLng: number;
  /** Kalender kurz öffnen, damit die Route sichtbar ist */
  openCalendar?: boolean;
}): void {
  const destTitle = String(opts.destName || 'Ziel').trim() || 'Ziel';
  const navId = 'live_journey';
  let journeyDetail: string | null = null;
  try {
    const card = formatJourneyForConcierge(opts.itinerary, destTitle);
    journeyDetail = (card.bullets ?? []).filter(Boolean).join('\n') || null;
  } catch {
    journeyDetail = null;
  }

  try {
    const { buildPlannedJourneyStops } = require('../../module2/timeline/plannedJourneyGroup') as {
      buildPlannedJourneyStops: (o: {
        navId: string;
        destTitle: string;
        itinerary: JourneyItinerary;
      }) => Array<{
        id: string;
        title: string;
        lat?: number;
        lng?: number;
        plannedStartMs: number;
        plannedEndMs: number;
        transport: 'walk' | 'bike' | 'transit';
        kind: 'nav_leg';
        notes?: string;
        emoji?: string;
        groupId?: string | null;
        groupLabel?: string | null;
      }>;
    };
    const steps = buildPlannedJourneyStops({
      navId,
      destTitle,
      itinerary: opts.itinerary,
    });
    steps.forEach((step, i) => {
      addPlanStop({
        id: step.id,
        title: step.title,
        lat: step.lat,
        lng: step.lng,
        plannedStartMs: step.plannedStartMs,
        plannedEndMs: step.plannedEndMs,
        kind: 'nav_leg',
        transport: step.transport,
        notes: step.notes,
        bufferMin: 0,
        emoji: step.emoji,
        groupId: navId,
        groupLabel: step.groupLabel ?? `ÖPNV nach ${destTitle}`.slice(0, 48),
        journeyDetail: i === 0 ? journeyDetail : null,
      });
    });
  } catch {
    /* fallback: einzelnes Dest */
  }

  const it = opts.itinerary;
  const legs = Array.isArray(it.legs) ? it.legs : [];
  const end =
    asDate(it.endTime) ??
    asDate(legs[legs.length - 1]?.endTime) ??
    new Date(Date.now() + Math.max(1, it.durationSec || 0) * 1000);
  try {
    addPlanStop({
      title: destTitle,
      lat: opts.destLat,
      lng: opts.destLng,
      plannedStartMs: end.getTime(),
      plannedEndMs: end.getTime() + 45 * 60_000,
      kind: 'stop',
      transport: 'walk',
      notes: `Ankunft ~${clock(end)}`,
      bufferMin: 5,
      groupId: navId,
      groupLabel: `ÖPNV nach ${destTitle}`.slice(0, 48),
      openCalendar: opts.openCalendar === true,
    });
  } catch {
    /* soft */
  }
}

/**
 * Startet Navigation zum ersten Bein (meist Bahnhof) + Multi-Stop-Liste.
 * Origin immer Live-GPS.
 */
export async function startJourneyNavigation(opts: {
  itinerary: JourneyItinerary;
  destName: string;
  destLat: number;
  destLng: number;
  /** Auch wenn schon eine Fuß-Nav zum Ziel läuft: Journey-Beine in Timeline */
  forceTimeline?: boolean;
  /** Nächste Bahn ist knapper als Fußweg + Bahnhofspuffer. */
  tight?: boolean;
  /** Alte Verbindung ersetzen — Timeline bleibt zu. */
  replace?: boolean;
}): Promise<{ ok: boolean; reply: string }> {
  const destName = String(opts.destName || 'Ziel').trim() || 'Ziel';
  const store = useFinnusStore.getState();
  const originLat = store.lastGpsLat;
  const originLng = store.lastGpsLng;
  if (originLat == null || originLng == null) {
    return {
      ok: false,
      reply: 'GPS fehlt gerade — kurz ins Freie und nochmal starten.',
    };
  }

  if (
    !opts.itinerary ||
    !Array.isArray(opts.itinerary.legs) ||
    opts.itinerary.legs.length < 1
  ) {
    return {
      ok: false,
      reply: 'Keine ÖPNV-Verbindung gefunden.',
    };
  }

  const endMs =
    asDate(opts.itinerary.endTime)?.getTime() ??
    Date.now() + Math.max(60, opts.itinerary.durationSec || 0) * 1000;
  const arriveKey = `${destName.toLowerCase()}|${Math.round(endMs / 60_000)}`;
  const recent = globalThis as {
    __findusLastJourneyKey?: string;
    __findusLastJourneyAt?: number;
  };
  if (
    recent.__findusLastJourneyKey === arriveKey &&
    Date.now() - (recent.__findusLastJourneyAt ?? 0) < 3 * 60_000 &&
    store.navActive &&
    !opts.forceTimeline &&
    !opts.replace
  ) {
    return {
      ok: true,
      reply: `Route zu ${destName} läuft schon — ich packe sie nicht nochmal neu.`,
    };
  }

  recent.__findusLastJourneyKey = arriveKey;
  recent.__findusLastJourneyAt = Date.now();

  let stops;
  try {
    stops = await buildTourStopsFromJourney({
      itinerary: opts.itinerary,
      destName,
      destLat: opts.destLat,
      destLng: opts.destLng,
      originLat,
      originLng,
    });
  } catch {
    return {
      ok: false,
      reply: 'ÖPNV-Route konnte nicht aufgebaut werden.',
    };
  }

  if (!stops.length) {
    return {
      ok: false,
      reply: 'ÖPNV-Route ohne sinnvolle Halte — bitte nochmal tippen.',
    };
  }

  try {
    const { clearTourAheadRouteCache } = require('./tourAheadRouteCache') as {
      clearTourAheadRouteCache: () => void;
    };
    clearTourAheadRouteCache();
  } catch {
    /* soft */
  }

  const leave = (() => {
    try {
      const { leaveByFromItinerary } = require('./journeyLeaveBy') as {
        leaveByFromItinerary: typeof import('./journeyLeaveBy').leaveByFromItinerary;
      };
      return leaveByFromItinerary(opts.itinerary, {
        lat: originLat,
        lng: originLng,
      });
    } catch {
      return null;
    }
  })();

  let cardSpeech = `Alles klar, wir fahren mit dem ÖPNV zu ${destName}.`;
  try {
    if (leave) {
      const { formatJourneyCommitSpeech } = require('./journeyLeaveBy') as {
        formatJourneyCommitSpeech: typeof import('./journeyLeaveBy').formatJourneyCommitSpeech;
      };
      cardSpeech = formatJourneyCommitSpeech({
        destName,
        leaveInMin: leave.leaveInMin,
        leaveByMs: leave.leaveByMs,
        depMs: leave.depMs,
        arriveMs: leave.arriveMs,
        walkMin: leave.walkMin,
        line: leave.line,
        station: leave.station,
        tight: opts.tight === true,
      });
    } else {
      const card = formatJourneyForConcierge(opts.itinerary, destName);
      if (card?.speech?.trim()) cardSpeech = card.speech.trim();
    }
  } catch {
    /* soft */
  }

  const defer =
    leave != null &&
    (() => {
      try {
        const { shouldDeferJourneyNav } = require('./journeyLeaveBy') as {
          shouldDeferJourneyNav: (n: number) => boolean;
        };
        return shouldDeferJourneyNav(leave.leaveInMin);
      } catch {
        return false;
      }
    })();

  const tour: MultiStopTour = {
    kind: 'custom',
    title: `Fahrt nach ${destName}`,
    targetDistanceM: null,
    targetDurationMin: Math.max(
      1,
      Math.round((opts.itinerary.durationSec || 0) / 60) ||
        Math.round((endMs - Date.now()) / 60_000),
    ),
    estimatedDistanceM: 0,
    stops,
    currentIndex: 0,
    liveMeta: {
      requestId: `journey_${Date.now()}`,
      hardArriveByMs: leave?.arriveMs ?? endMs,
      softDurationMin: null,
      bufferMin: STATION_ARRIVE_BEFORE_MIN,
      plannedArriveByMs: leave?.arriveMs ?? endMs,
      startedAtMs: Date.now(),
      denserStops: false,
      mobility: 'transit_ok',
      leaveByMs: leave?.leaveByMs ?? null,
      firstTransitMs: leave?.depMs ?? null,
    },
  };

  const started = await startMultiStopTour(tour, { startNav: !defer });
  if (!started.ok) return started;
  void snapJourneyHaltsInBackground(stops);

  try {
    const { allowLiveNavMirror, upsertLiveNavFromStore } = require('../../module2/timeline/syncLiveNavToPlan') as {
      allowLiveNavMirror: () => void;
      upsertLiveNavFromStore: (o?: { force?: boolean }) => void;
    };
    allowLiveNavMirror();
    upsertLiveNavFromStore({ force: true });
  } catch {
    /* soft */
  }

  try {
    addJourneyToTimeline({
      itinerary: opts.itinerary,
      destName,
      destLat: opts.destLat,
      destLng: opts.destLng,
    });
  } catch {
    /* Timeline darf Nav nicht crashen */
  }

  if (leave) {
    try {
      const { startJourneyLeaveWatch } = require('./journeyLeaveBy') as {
        startJourneyLeaveWatch: typeof import('./journeyLeaveBy').startJourneyLeaveWatch;
      };
      const halt = stops[0] ?? { lat: originLat, lng: originLng };
      startJourneyLeaveWatch({
        leaveByMs: leave.leaveByMs,
        firstStop: { lat: halt.lat, lng: halt.lng },
        destName,
        destLat: opts.destLat,
        destLng: opts.destLng,
        line: leave.line,
        depMs: leave.depMs,
        muteLeaveSpeech: !defer,
      });
    } catch {
      /* soft */
    }
  }

  return {
    ok: true,
    reply: cardSpeech.length > 360 ? `${cardSpeech.slice(0, 340).trim()}…` : cardSpeech,
  };
}
