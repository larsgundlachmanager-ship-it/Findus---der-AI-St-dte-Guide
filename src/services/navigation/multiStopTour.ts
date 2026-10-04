/**
 * Multi-Stop Runtime — Queue / Advance / Weave.
 * Tour-Planung (Stopps wählen, Zeitbudget, Path) lebt nur in `src/module2/tour/`.
 */

import { haversineMeters } from '../../db/database';
import { useFinnusStore } from '../../store/useFinnusStore';
import {
  getActiveNavDestination,
  startNavigation,
  startNavigationToCoords,
} from './navigationService';
import { notifyNavRouteGeometryChanged } from './navRouteRev';
import { isHotelTourEnd, orderStopsEfficiently } from './tourOrder';
import { markNavOpeningSpoken } from './landmarkNavCoach';
import { stopSpeaking } from '../ttsService';
import {
  fetchRouteDirectionsResult,
  walkingDistanceFromSteps,
} from './googleMapsNav';

export type TourKind = 'jog' | 'explore' | 'meal' | 'custom';

/** soft = Errand unterwegs; high = spontan jetzt; must = Termin / harte Deadline */
export type StopPriority = 'soft' | 'high' | 'must';

export type TourStopRole =
  | 'walk'
  | 'board'
  | 'alight'
  | 'transfer'
  | 'dest';

export type TourStop = {
  poiId: number;
  name: string;
  lat: number;
  lng: number;
  done: boolean;
  priority?: StopPriority;
  /** Minuten vorher erinnern — null/undefined = keine Reminder-Ansage */
  remindMinBefore?: number | null;
  /** ÖPNV-Phase für Door-to-door */
  role?: TourStopRole;
  line?: string | null;
  /** Stationskette für Countdown (bei alight / ride) */
  stations?: import('./navigationTypes').NavWaypoint[];
  stationCount?: number | null;
  speakOnStart?: string | null;
  /** Bahn-/Bus-Geometrie (Gleise/Stationen), nicht Fuß-Luftlinie. */
  path?: Array<{ lat: number; lng: number }> | null;
  startMs?: number | null;
  endMs?: number | null;
  durationSec?: number | null;
  distanceM?: number | null;
  headsign?: string | null;
  platform?: string | null;
  delaySec?: number | null;
  /** RAIL/BUS/… — steuert Gleis vs. Straßen-Geometrie. */
  vehicleMode?: string | null;
  /** Abfahrt des nächsten Fahrzeugs an diesem Halt (Warten + Chip). */
  vehicleStartMs?: number | null;
  notes?: string | null;
  /** Live-Pacing: Aufholen / nächste Verbindung (Timeline). */
  liveHint?: string | null;
  mapsUrl?: string | null;
  menuUrl?: string | null;
  reserveUrl?: string | null;
  websiteUrl?: string | null;
};

export type MultiStopTour = {
  kind: TourKind;
  title: string;
  /** Ziel-Länge der Tour (Joggen), sonst null. */
  targetDistanceM: number | null;
  /** Ziel-Dauer in Minuten (optional). */
  targetDurationMin: number | null;
  estimatedDistanceM: number;
  stops: TourStop[];
  currentIndex: number;
  /** Tour-Modul Live-Meta (Supervisor) */
  liveMeta?: {
    requestId: string;
    hardArriveByMs: number | null;
    softDurationMin: number | null;
    bufferMin: number;
    plannedArriveByMs: number | null;
    startedAtMs: number;
    denserStops: boolean;
    mobility: 'walk' | 'bike' | 'transit_ok';
    leaveByMs?: number | null;
    firstTransitMs?: number | null;
  } | null;
};

/** Complex itinerary (>5 stops) → Gemini Pro via modelRouter. */
export function tourNeedsProLlm(stopCount: number): boolean {
  return stopCount > 5;
}

export function formatTourReply(tour: MultiStopTour): string {
  const n = tour.stops.length;
  if (tour.kind === 'jog' && tour.estimatedDistanceM > 0) {
    const km = (tour.estimatedDistanceM / 1000).toFixed(1);
    return `Passt — etwa ${km} km, wir starten.`;
  }
  return `Alles klar — ${n} Stopps, wir starten.`;
}

function isPinnedTourEnd(stop: TourStop): boolean {
  if (isHotelTourEnd(stop)) return true;
  try {
    const { useUserMemoryStore } = require('../../store/useUserMemoryStore') as {
      useUserMemoryStore: {
        getState: () => {
          getConfirmedHotel: () =>
            | { lat?: number | null; lng?: number | null }
            | undefined;
        };
      };
    };
    const hotel = useUserMemoryStore.getState().getConfirmedHotel();
    if (
      hotel &&
      typeof hotel.lat === 'number' &&
      typeof hotel.lng === 'number' &&
      haversineMeters(stop.lat, stop.lng, hotel.lat, hotel.lng) < 90
    ) {
      return true;
    }
  } catch {
    /* soft */
  }
  return false;
}

/** Karte + Timeline + Live-Anzeige = dieselbe Tour-Reihenfolge. */
function mirrorTourToLiveTimeline(): void {
  try {
    const {
      allowLiveNavMirror,
      upsertLiveNavFromStore,
    } = require('../../module2/timeline/syncLiveNavToPlan') as {
      allowLiveNavMirror: () => void;
      upsertLiveNavFromStore: (o?: { force?: boolean }) => void;
    };
    allowLiveNavMirror();
    upsertLiveNavFromStore({ force: true });
  } catch {
    /* soft */
  }
}

function pathLengthM(origin: { lat: number; lng: number }, stops: TourStop[]): number {
  let total = 0;
  let prev = origin;
  for (const s of stops) {
    total += haversineMeters(prev.lat, prev.lng, s.lat, s.lng);
    prev = s;
  }
  return Math.round(total);
}

async function pathLengthRoutedM(
  origin: { lat: number; lng: number },
  stops: TourStop[],
): Promise<number> {
  let total = 0;
  let prev = origin;
  for (const s of stops) {
    let leg = 0;
    try {
      const result = await fetchRouteDirectionsResult(
        { lat: prev.lat, lng: prev.lng },
        { lat: s.lat, lng: s.lng },
        'walking',
      );
      if (result?.steps?.length) {
        leg = walkingDistanceFromSteps(result.steps);
      }
    } catch {
      /* air fallback */
    }
    if (leg < 20) {
      leg = haversineMeters(prev.lat, prev.lng, s.lat, s.lng);
    }
    total += leg;
    prev = s;
  }
  return Math.round(total);
}

function scheduleTourDistanceEnrich(tour: MultiStopTour): void {
  const store = useFinnusStore.getState();
  const origin = {
    lat: store.lastGpsLat ?? tour.stops[0]?.lat ?? 0,
    lng: store.lastGpsLng ?? tour.stops[0]?.lng ?? 0,
  };
  const upcoming = tour.stops.slice(tour.currentIndex).filter((s) => !s.done);
  void pathLengthRoutedM(origin, upcoming).then((m) => {
    if (m <= 0) return;
    const cur = useFinnusStore.getState().multiStopTour;
    if (!cur || cur.title !== tour.title) return;
    if (Math.abs((cur.estimatedDistanceM ?? 0) - m) < 25) return;
    useFinnusStore.getState().setMultiStopTour({
      ...cur,
      estimatedDistanceM: m,
    });
  });
}

async function navigateToTourStop(stop: TourStop): Promise<boolean> {
  if (stop.poiId >= 0) {
    const ok = await startNavigation(stop.poiId);
    if (ok) {
      await applyTourStopRuntime(stop);
      return true;
    }
  }
  // Fuß-Etappe zur Haltestelle / Umstieg / Ziel = normale Fußnavi (gelb abbiegen).
  // Nur alight = ÖPNV-Ride ohne Fuß-Enrich entlang der Linie.
  const ride = stop.role === 'alight';
  const ok = await startNavigationToCoords({
    name: stop.name,
    lat: stop.lat,
    lng: stop.lng,
    poiId: stop.poiId >= 0 ? stop.poiId : -1,
    stations: ride ? stop.stations : undefined,
    transitRide: ride,
    forceTravelMode: ride ? undefined : 'foot',
    skipDestVerify: true,
  });
  // Fuß-Bein: Journey-Path sofort auf die Karte, bis FOSSGIS enrich nachzieht.
  // Transit-Ride: Stationskette / Journey-Pfad — nie Fuß-OSRM als Kartenlinie.
  if (ok) {
    const seedPts = ride
      ? Array.isArray(stop.stations) && stop.stations.length >= 2
        ? stop.stations
        : Array.isArray(stop.path) && stop.path.length >= 3
          ? stop.path
          : null
      : Array.isArray(stop.path) && stop.path.length >= 3
        ? stop.path
        : null;
    if (seedPts) {
      try {
        const { seedActiveNavRoute } = require('./navigationService') as {
          seedActiveNavRoute: (o: {
            waypoints: Array<{
              lat: number;
              lng: number;
              maneuver: null;
              roadName: null;
              landmark: null;
              cue: null;
              instruction: null;
            }>;
          }) => boolean;
        };
        seedActiveNavRoute({
          waypoints: seedPts.map((p) => ({
            lat: p.lat,
            lng: p.lng,
            maneuver: null,
            roadName: null,
            landmark: null,
            cue: null,
            instruction: null,
          })),
        });
      } catch {
        /* soft */
      }
    }
  }
  if (ok) await applyTourStopRuntime(stop);
  return ok;
}

function againstTravelCue(prev: TourStop | null, next: TourStop): string | null {
  if (!prev || prev.role !== 'alight') return null;
  if (next.role !== 'dest' && next.role !== 'walk' && next.role !== 'transfer') {
    return null;
  }
  try {
    const { bearingDegrees, shortestAngleDelta } = require('./bearing') as {
      bearingDegrees: (a: number, b: number, c: number, d: number) => number;
      shortestAngleDelta: (a: number, b: number) => number;
    };
    const chain =
      (Array.isArray(prev.stations) && prev.stations.length >= 2
        ? prev.stations
        : Array.isArray(prev.path) && prev.path.length >= 2
          ? prev.path
          : null) ?? null;
    if (!chain || chain.length < 2) return null;
    const a = chain[chain.length - 2]!;
    const b = chain[chain.length - 1]!;
    const vehicle = bearingDegrees(a.lat, a.lng, b.lat, b.lng);
    const foot = bearingDegrees(prev.lat, prev.lng, next.lat, next.lng);
    if (Math.abs(shortestAngleDelta(vehicle, foot)) < 120) return null;
    return 'entgegen der Fahrtrichtung';
  } catch {
    return null;
  }
}

async function applyTourStopRuntime(stop: TourStop): Promise<void> {
  try {
    const { setActiveNavStations } = await import('./navigationService');
    if (stop.stations?.length) {
      setActiveNavStations(stop.stations);
    } else if (stop.role === 'walk' || stop.role === 'dest') {
      setActiveNavStations(null);
    }
  } catch {
    /* soft */
  }
  let cue = stop.speakOnStart?.trim() || '';
  if (stop.role === 'alight') return;
  // Nach Ausstieg: optional „entgegen der Fahrtrichtung“ für den Fußweg.
  try {
    const tour = useFinnusStore.getState().multiStopTour;
    const idx = tour?.currentIndex ?? -1;
    const prev =
      tour && idx > 0 ? tour.stops[idx - 1] ?? null : null;
    const against = againstTravelCue(prev, stop);
    if (against) {
      cue = cue
        ? `${cue.replace(/\.?\s*$/, '')} — ${against}.`
        : `Fußweg ${against}.`;
    }
  } catch {
    /* soft */
  }
  if (!cue) return;
  try {
    const { wasTransitGuideSpoken, noteTransitGuideSpoken } = await import(
      './transitGuideCoach'
    );
    if (stop.role === 'dest' && wasTransitGuideSpoken('lastwalk')) return;
    if (stop.role === 'transfer' && wasTransitGuideSpoken('transfer')) return;
    if (stop.role === 'dest') noteTransitGuideSpoken('lastwalk');
    if (stop.role === 'transfer') noteTransitGuideSpoken('transfer');
    const { speakAssistantText } = await import('../ttsService');
    setTimeout(() => {
      void speakAssistantText(cue).catch(() => {});
    }, 900);
  } catch {
    /* soft */
  }
}

function recomputeTourDistance(tour: MultiStopTour): number {
  const store = useFinnusStore.getState();
  const origin = {
    lat: store.lastGpsLat ?? tour.stops[0]?.lat ?? 0,
    lng: store.lastGpsLng ?? tour.stops[0]?.lng ?? 0,
  };
  const upcoming = tour.stops.slice(tour.currentIndex).filter((s) => !s.done);
  return pathLengthM(origin, upcoming);
}

export async function startMultiStopTour(
  tour: MultiStopTour,
  opts?: { startNav?: boolean },
): Promise<{ ok: boolean; reply: string }> {
  useFinnusStore.getState().setMultiStopTour(tour);
  scheduleTourDistanceEnrich(tour);
  const stop = tour.stops[tour.currentIndex];
  if (!stop) {
    useFinnusStore.getState().setMultiStopTour(null);
    return { ok: false, reply: 'Ich konnte keine sinnvolle Route finden.' };
  }
  if (opts?.startNav === false) {
    notifyNavRouteGeometryChanged();
    return { ok: true, reply: formatTourReply(tour) };
  }
  const ok = await navigateToTourStop(stop);
  if (!ok) {
    useFinnusStore.getState().setMultiStopTour(null);
    return {
      ok: false,
      reply: 'Route steht, aber Navigation startet gerade nicht. Versuch’s nochmal.',
    };
  }
  markNavOpeningSpoken();
  return { ok: true, reply: formatTourReply(tour) };
}

/**
 * GPS schon an/ hinter einem späteren Halt → Tour vorziehen + Journey refresh.
 * Verhindert stale Prisdorf-Verbindung wenn User schon weiter ist.
 */
export async function maybeCatchUpTourProgress(opts?: {
  lat?: number | null;
  lng?: number | null;
}): Promise<boolean> {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour?.stops?.length) return false;
  const lat =
    opts?.lat ?? store.lastGpsLat ?? null;
  const lng =
    opts?.lng ?? store.lastGpsLng ?? null;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }
  const idx = tour.currentIndex;
  if (idx < 0 || idx >= tour.stops.length) return false;
  const cur = tour.stops[idx]!;
  if (cur.done) return false;

  // Nächsten noch offenen Stop finden, der GPS-nah ist (User schon weiter).
  let best = -1;
  let bestD = 95;
  for (let i = idx + 1; i < tour.stops.length; i += 1) {
    const s = tour.stops[i]!;
    if (s.done) continue;
    const d = haversineMeters(lat, lng, s.lat, s.lng);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  // Oder: am aktuellen Halt vorbei Richtung Folgestopp (distNext << distCur).
  if (best < 0 && idx + 1 < tour.stops.length) {
    const next = tour.stops[idx + 1]!;
    const dCur = haversineMeters(lat, lng, cur.lat, cur.lng);
    const dNext = haversineMeters(lat, lng, next.lat, next.lng);
    if (dCur > 160 && dNext + 80 < dCur && dNext < 220) {
      best = idx + 1;
    }
  }
  if (best <= idx) return false;

  const stops = tour.stops.map((s, i) =>
    i < best ? { ...s, done: true } : s,
  );
  const nextTour = {
    ...tour,
    stops,
    currentIndex: best,
    estimatedDistanceM: recomputeTourDistance({
      ...tour,
      stops,
      currentIndex: best,
    }),
  };
  store.setMultiStopTour(nextTour);
  mirrorTourToLiveTimeline();
  // Stale Verbindung: Leave-by / Transfer neu anfragen.
  try {
    const { requestJourneyRefresh } = require('./journeyLeaveBy') as {
      requestJourneyRefresh?: (reason?: string) => void;
    };
    requestJourneyRefresh?.('progress_past_stop');
  } catch {
    /* soft */
  }
  return navigateToTourStop(stops[best]!);
}

export async function advanceMultiStopTour(): Promise<boolean> {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour) return false;

  const stops = tour.stops.map((s, i) =>
    i === tour.currentIndex ? { ...s, done: true } : s,
  );
  const nextIndex = tour.currentIndex + 1;
  if (nextIndex >= stops.length) {
    store.setMultiStopTour({
      ...tour,
      stops,
      currentIndex: nextIndex,
    });
    // Sofort Live-ÖPNV aus Timeline — kein Doppel-ÖPNV nach „Tour fertig“.
    try {
      const { clearLiveNavFromPlan } = require('../../module2/timeline/syncLiveNavToPlan') as {
        clearLiveNavFromPlan: (o?: { abandon?: boolean }) => void;
      };
      clearLiveNavFromPlan({ abandon: true });
    } catch {
      /* soft */
    }
    setTimeout(() => {
      const cur = useFinnusStore.getState().multiStopTour;
      if (cur && cur.currentIndex >= cur.stops.length) {
        useFinnusStore.getState().setMultiStopTour(null);
      }
    }, 8_000);
    void stopSpeaking().catch(() => {});
    return false;
  }

  const next = stops[nextIndex]!;
  const nextTour = {
    ...tour,
    stops,
    currentIndex: nextIndex,
    estimatedDistanceM: recomputeTourDistance({
      ...tour,
      stops,
      currentIndex: nextIndex,
    }),
  };
  store.setMultiStopTour(nextTour);
  scheduleTourDistanceEnrich(nextTour);

  return navigateToTourStop(next);
}

export function clearMultiStopTour(): void {
  try {
    const { stopTourLiveSupervisor } = require('../../module2/tour/tourLiveSupervisor') as {
      stopTourLiveSupervisor: () => void;
    };
    stopTourLiveSupervisor();
  } catch {
    /* soft */
  }
  useFinnusStore.getState().setMultiStopTour(null);
}

export function formatTourStopsHeader(tour: MultiStopTour | null): string | null {
  if (!tour?.stops?.length) return null;
  const cur = Math.min(tour.currentIndex, tour.stops.length - 1);
  const parts = tour.stops.map((s, i) => {
    if (i < tour.currentIndex) return `✓${s.name}`;
    if (i === cur) return `→${s.name}`;
    return s.name;
  });
  return `${tour.title}: ${parts.join(' · ')}`;
}

export function ensureTourFromActiveNav(final: {
  name: string;
  lat: number;
  lng: number;
  poiId?: number;
}): MultiStopTour {
  const existing = useFinnusStore.getState().multiStopTour;
  if (existing?.stops?.length) return existing;

  const tour: MultiStopTour = {
    kind: 'custom',
    title: 'Route',
    targetDistanceM: null,
    targetDurationMin: null,
    estimatedDistanceM: 0,
    stops: [
      {
        poiId: final.poiId ?? -1,
        name: final.name,
        lat: final.lat,
        lng: final.lng,
        done: false,
      },
    ],
    currentIndex: 0,
  };
  useFinnusStore.getState().setMultiStopTour(tour);
  return tour;
}

/**
 * Neuen Stopp in die offene Tour einsortieren — kürzester Weg vom Standort,
 * nicht hinten anhängen.
 */
export async function addOptimizedTourStop(
  stop: TourStop,
  opts?: { startNow?: boolean },
): Promise<{ tour: MultiStopTour; speechHint: string } | null> {
  const store = useFinnusStore.getState();
  const dest = getActiveNavDestination();
  let tour = store.multiStopTour;
  if (!tour?.stops?.length && dest) {
    tour = ensureTourFromActiveNav({
      name: dest.name,
      lat: dest.lat,
      lng: dest.lng,
      poiId: dest.poiId,
    });
  }
  if (!tour) {
    tour = {
      kind: 'custom',
      title: 'Route',
      targetDistanceM: null,
      targetDurationMin: null,
      estimatedDistanceM: 0,
      stops: [],
      currentIndex: 0,
    };
  }

  const incoming: TourStop = { ...stop, done: false };
  const donePart = tour.stops
    .slice(0, tour.currentIndex)
    .map((s) => ({ ...s, done: true as const }));
  const upcoming = tour.stops
    .slice(tour.currentIndex)
    .filter((s) => !s.done)
    .filter((s) => !sameStop(s, incoming));

  const extras = collectSoftVisitStops(incoming).filter(
    (s) => !upcoming.some((u) => sameStop(u, s)) && !sameStop(s, incoming),
  );

  const origin = {
    lat: store.lastGpsLat ?? dest?.lat ?? incoming.lat,
    lng: store.lastGpsLng ?? dest?.lng ?? incoming.lng,
  };
  const ordered = orderStopsEfficiently(origin, [...upcoming, incoming, ...extras], {
    pinLast: isPinnedTourEnd,
  });
  const currentIndex = donePart.length;
  const next: MultiStopTour = {
    ...tour,
    kind:
      tour.kind === 'jog' || tour.kind === 'explore' || tour.kind === 'meal'
        ? tour.kind
        : 'custom',
    title: tour.stops.length <= 1 ? 'Tour' : tour.title,
    stops: [...donePart, ...ordered],
    currentIndex,
    estimatedDistanceM: recomputeTourDistance({
      ...tour,
      stops: [...donePart, ...ordered],
      currentIndex,
    }),
  };
  store.setMultiStopTour(next);
  store.setStopQueueVisible(true);
  notifyNavRouteGeometryChanged();
  mirrorTourToLiveTimeline();
  try {
    const { ensureTourAheadRoutes } = require('./tourAheadRouteCache') as {
      ensureTourAheadRoutes: (
        s: Array<{ lat: number; lng: number; role?: string | null }>,
      ) => void;
    };
    const originPt = {
      lat: origin.lat,
      lng: origin.lng,
      role: 'walk' as const,
    };
    ensureTourAheadRoutes([
      originPt,
      ...ordered.map((s) => ({ lat: s.lat, lng: s.lng, role: s.role ?? 'walk' })),
    ]);
  } catch {
    /* soft */
  }

  const focus = ordered[0];
  const startNow = opts?.startNow !== false;
  const destChanged =
    focus &&
    dest &&
    !sameStop(
      {
        poiId: dest.poiId,
        name: dest.name,
        lat: dest.lat,
        lng: dest.lng,
        done: false,
      },
      focus,
    );
  if (startNow && focus && (!dest || destChanged)) {
    await navigateToTourStop(focus);
    markNavOpeningSpoken();
  } else {
    // Gleicher erster Stopp: Tour/Ahead trotzdem neu auf die Karte.
    notifyNavRouteGeometryChanged();
  }

  try {
    useFinnusStore.getState().setNavRouteLoading(false);
    useFinnusStore.getState().setIsGenerating(false);
  } catch {
    /* soft */
  }

  // Speech = Live-Tour-Reihenfolge (gleiche SSOT wie Karte/Timeline).
  const orderLabel = ordered.map((s) => s.name).filter(Boolean).join(' → ');
  const speechHint =
    ordered.length <= 1
      ? `${incoming.name} ist jetzt mit auf der Route.`
      : `${incoming.name} ist einsortiert: ${orderLabel}.`;
  return { tour: next, speechHint };
}

export async function insertTourStop(
  stop: TourStop,
  opts?: { position?: 'front' | 'end'; startNow?: boolean },
): Promise<MultiStopTour | null> {
  const store = useFinnusStore.getState();
  const dest = getActiveNavDestination();
  let tour = store.multiStopTour;
  // Laufende Einzelnavi → Tour anlegen, sonst hängt „Stopp hinzu“ in der Luft.
  if (!tour?.stops?.length && dest) {
    tour = ensureTourFromActiveNav({
      name: dest.name,
      lat: dest.lat,
      lng: dest.lng,
      poiId: dest.poiId,
    });
  }
  if (!tour) {
    tour = {
      kind: 'custom',
      title: 'Route',
      targetDistanceM: null,
      targetDurationMin: null,
      estimatedDistanceM: 0,
      stops: [],
      currentIndex: 0,
    };
  }

  const incoming: TourStop = { ...stop, done: false };
  // Duplikat: nicht nochmal — sonst Timeline 3 / Karte 2 durch Re-Add-Chaos.
  if (tour.stops.some((s) => !s.done && sameStop(s, incoming))) {
    store.setStopQueueVisible(true);
    notifyNavRouteGeometryChanged();
    return tour;
  }

  const position = opts?.position ?? 'front';
  const stops = [...tour.stops];
  const currentIndex = tour.currentIndex;

  if (position === 'front') {
    stops.splice(currentIndex, 0, incoming);
  } else {
    stops.push(incoming);
  }

  const next: MultiStopTour = {
    ...tour,
    kind:
      tour.kind === 'jog' || tour.kind === 'explore' || tour.kind === 'meal'
        ? tour.kind
        : 'custom',
    title: tour.stops.length <= 1 ? 'Tour' : tour.title,
    stops,
    currentIndex,
    estimatedDistanceM: recomputeTourDistance({
      ...tour,
      stops,
      currentIndex,
    }),
  };
  store.setMultiStopTour(next);
  store.setStopQueueVisible(true);
  notifyNavRouteGeometryChanged();
  mirrorTourToLiveTimeline();

  if (opts?.startNow !== false && position === 'front') {
    await navigateToTourStop(stops[currentIndex]!);
    markNavOpeningSpoken();
  }
  return next;
}

/**
 * Stopp hinten anhängen — keine Neu-Sortierung.
 * Fallback wenn Optimize nicht greift; Map/Speech nutzen addOptimizedTourStop.
 */
export async function appendTourStop(
  stop: TourStop,
  opts?: { startNow?: boolean },
): Promise<{ tour: MultiStopTour; speechHint: string } | null> {
  const next = await insertTourStop(stop, {
    position: 'end',
    startNow: opts?.startNow === true,
  });
  if (!next) return null;
  const upcoming = next.stops.filter((s) => !s.done).length;
  const speechHint =
    upcoming <= 1
      ? `${stop.name} ist jetzt mit auf der Route.`
      : `${stop.name} kommt hinten dazu — ${upcoming} Stopps auf der Route.`;
  return { tour: next, speechHint };
}

/** Max. Umweg, damit ein Tour-Stop „auf dem Weg“ zu Spontan-Ziel gilt. */
const ON_ROUTE_DETOUR_M = 140;
const ON_ROUTE_DETOUR_FRAC = 0.22;

function sameStop(a: TourStop, b: Pick<TourStop, 'name' | 'lat' | 'lng' | 'poiId'>): boolean {
  if (a.poiId >= 0 && b.poiId >= 0 && a.poiId === b.poiId) return true;
  const an = a.name.trim().toLowerCase();
  const bn = b.name.trim().toLowerCase();
  if (an && bn && an === bn) return true;
  return (
    haversineMeters(a.lat, a.lng, b.lat, b.lng) < 45 &&
    an.length > 0 &&
    (an.includes(bn) || bn.includes(an))
  );
}

function stripVisitTitle(name: string): string {
  return String(name || '')
    .replace(/^\d+\s*·\s*/, '')
    .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*/u, '')
    .trim();
}

/** Offene Plan-Besuche ohne feste Uhr in die Tour-Optimierung ziehen. */
function collectSoftVisitStops(incoming: TourStop): TourStop[] {
  try {
    const { useFuturePlanStore } = require('../../module2/timeline/futurePlanState') as {
      useFuturePlanStore: {
        getState: () => {
          plan: {
            stops: Array<{
              id: string;
              title: string;
              lat?: number;
              lng?: number;
              kind?: string;
              groupId?: string | null;
              hardAnchor?: boolean;
              userFixedTime?: boolean;
              plannedStartMs?: number | null;
              plannedEndMs?: number | null;
            }>;
          };
        };
      };
    };
    const { isLiveNavLegId } = require('../../module2/timeline/liveTourSchedule') as {
      isLiveNavLegId: (id: string | null | undefined) => boolean;
    };
    const now = Date.now();
    const out: TourStop[] = [];
    for (const s of useFuturePlanStore.getState().plan.stops) {
      if (s.kind === 'nav_leg') continue;
      if (isLiveNavLegId(s.id)) continue;
      if (s.groupId === 'live_journey') continue;
      if (
        s.id.startsWith('choice_') ||
        s.id.startsWith('ft:') ||
        s.id.startsWith('wake_')
      ) {
        continue;
      }
      if (s.hardAnchor || s.userFixedTime) continue;
      if (typeof s.lat !== 'number' || typeof s.lng !== 'number') continue;
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
      if (s.plannedStartMs != null && s.plannedStartMs > now + 6 * 3600_000) {
        continue;
      }
      if (s.plannedEndMs != null && s.plannedEndMs < now - 10 * 60_000) {
        continue;
      }
      const name = stripVisitTitle(s.title);
      if (!name) continue;
      out.push({
        poiId: -1,
        name,
        lat: s.lat,
        lng: s.lng,
        done: false,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function isOnWayTo(
  user: { lat: number; lng: number },
  via: TourStop,
  dest: { lat: number; lng: number },
): boolean {
  const direct = haversineMeters(user.lat, user.lng, dest.lat, dest.lng);
  const viaDist =
    haversineMeters(user.lat, user.lng, via.lat, via.lng) +
    haversineMeters(via.lat, via.lng, dest.lat, dest.lng);
  const detour = viaDist - direct;
  if (detour > Math.max(ON_ROUTE_DETOUR_M, direct * ON_ROUTE_DETOUR_FRAC)) {
    return false;
  }
  const toVia = haversineMeters(user.lat, user.lng, via.lat, via.lng);
  return toVia <= direct + 40;
}

/**
 * Spontan-Ziel in laufende Tour einweben — Rest bleibt.
 */
export async function weaveSpontaneousStop(
  stop: TourStop,
  opts?: { startNow?: boolean },
): Promise<{ tour: MultiStopTour; speechHint: string } | null> {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour?.stops?.length) return null;

  const userLat = store.lastGpsLat;
  const userLng = store.lastGpsLng;
  if (
    userLat == null ||
    userLng == null ||
    !Number.isFinite(userLat) ||
    !Number.isFinite(userLng)
  ) {
    const inserted = await insertTourStop(
      { ...stop, priority: stop.priority ?? 'high', done: false },
      { position: 'front', startNow: opts?.startNow !== false },
    );
    if (!inserted) return null;
    return {
      tour: inserted,
      speechHint: `${stop.name} ist jetzt als Nächstes dran — die Tour bleibt.`,
    };
  }

  const user = { lat: userLat, lng: userLng };
  const donePart = tour.stops
    .slice(0, tour.currentIndex)
    .map((s) => ({ ...s, done: true as const }));
  const upcoming = tour.stops
    .slice(tour.currentIndex)
    .filter((s) => !s.done)
    .filter((s) => !sameStop(s, stop));

  const spontaneous: TourStop = {
    ...stop,
    done: false,
    priority: stop.priority ?? 'high',
    remindMinBefore:
      stop.remindMinBefore !== undefined
        ? stop.remindMinBefore
        : stop.priority === 'must'
          ? 5
          : null,
  };

  const onRoute = upcoming
    .filter((s) => isOnWayTo(user, s, spontaneous))
    .sort(
      (a, b) =>
        haversineMeters(user.lat, user.lng, a.lat, a.lng) -
        haversineMeters(user.lat, user.lng, b.lat, b.lng),
    );
  const onRouteKeys = new Set(onRoute.map((s) => `${s.poiId}|${s.name}|${s.lat}`));
  const rest = upcoming.filter(
    (s) => !onRouteKeys.has(`${s.poiId}|${s.name}|${s.lat}`),
  );

  const wovenUpcoming = [...onRoute, spontaneous, ...rest];
  const stops = [...donePart, ...wovenUpcoming];
  const currentIndex = donePart.length;

  const next: MultiStopTour = {
    ...tour,
    stops,
    currentIndex,
    estimatedDistanceM: recomputeTourDistance({
      ...tour,
      stops,
      currentIndex,
    }),
  };
  store.setMultiStopTour(next);
  store.setStopQueueVisible(true);

  if (opts?.startNow !== false) {
    const focus = stops[currentIndex];
    if (focus) {
      await navigateToTourStop(focus);
      markNavOpeningSpoken();
    }
  }

  let speechHint: string;
  let underway = false;
  try {
    const { getSmoothedSpeedMs } = require('./transportMode') as {
      getSmoothedSpeedMs: () => number | null;
    };
    const speedMs = getSmoothedSpeedMs();
    underway =
      typeof speedMs === 'number' && Number.isFinite(speedMs) && speedMs >= 0.45;
  } catch {
    underway = false;
  }
  if (onRoute.length > 0 && underway) {
    const viaNames = onRoute.map((s) => s.name).slice(0, 2).join(' und ');
    speechHint =
      onRoute.length === 1
        ? `${viaNames} liegt auf dem Weg — den haken wir kurz ab, dann ${spontaneous.name}. Tour bleibt.`
        : `Auf dem Weg liegen noch ${viaNames} — danach ${spontaneous.name}. Der Rest der Tour bleibt.`;
  } else if (onRoute.length > 0) {
    // Noch nicht losgelaufen: Queue umsortieren, aber nicht „auf dem Weg“ labern
    speechHint = `${spontaneous.name} ist als Nächstes geplant. Die Tour bleibt — unterwegs sag ich Bescheid, was dazwischen liegt.`;
  } else {
    const p = spontaneous.priority ?? 'high';
    const finalName =
      rest.find((s) => s.role === 'dest')?.name ||
      rest[rest.length - 1]?.name ||
      '';
    speechHint =
      p === 'must'
        ? finalName
          ? `${spontaneous.name} ist jetzt oben — danach geht’s weiter zu ${finalName}.`
          : `${spontaneous.name} ist jetzt oben — ich erinner dich rechtzeitig. Die anderen Stopps bleiben in der Queue.`
        : finalName
          ? `${spontaneous.name} ist jetzt als Nächstes dran — danach weiter zu ${finalName}.`
          : `${spontaneous.name} ist jetzt als Nächstes dran. Die Tour mit ${rest.length} weiteren Stopps bleibt.`;
  }

  return { tour: next, speechHint };
}

export function hasActiveTourQueue(): boolean {
  const tour = useFinnusStore.getState().multiStopTour;
  if (!tour?.stops?.length) return false;
  return tour.stops.slice(tour.currentIndex).some((s) => !s.done);
}

export function softStopReminderLine(stop: TourStop): string | null {
  const mins = stop.remindMinBefore;
  if (mins == null || mins <= 0) return null;
  const p = stop.priority ?? 'soft';
  if (p === 'must') {
    return `In etwa ${mins} Minuten solltest du Richtung ${stop.name} — nur kurz Bescheid.`;
  }
  if (p === 'high') {
    return `Wenn’s passt: gleich wäre ${stop.name} dran.`;
  }
  return `Nebenbei: ${stop.name} kommt bald — kein Stress.`;
}

export function removeTourStopAt(index: number): MultiStopTour | null {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour || index < 0 || index >= tour.stops.length) return tour;

  const stops = tour.stops.filter((_, i) => i !== index);
  if (!stops.length) {
    store.setMultiStopTour(null);
    return null;
  }

  let currentIndex = tour.currentIndex;
  if (index < currentIndex) currentIndex -= 1;
  if (currentIndex >= stops.length) currentIndex = stops.length - 1;

  const next: MultiStopTour = {
    ...tour,
    stops,
    currentIndex,
    estimatedDistanceM: recomputeTourDistance({
      ...tour,
      stops,
      currentIndex,
    }),
  };
  store.setMultiStopTour(next);
  mirrorTourToLiveTimeline();
  return next;
}

/**
 * Offenen Tour-Stop streichen. War es das aktuelle Ziel, sofort zum Nächsten
 * navigieren und die Rest-Route neu berechnen — Tour bleibt.
 */
export async function skipUpcomingTourStop(opts: {
  upcomingIndex: number;
}): Promise<{ ok: boolean; cleared: boolean; nextName?: string }> {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour?.stops.length) return { ok: false, cleared: false };

  const upcomingAbs: number[] = [];
  tour.stops.forEach((s, i) => {
    if (i >= tour.currentIndex && !s.done) upcomingAbs.push(i);
  });
  const abs = upcomingAbs[opts.upcomingIndex];
  if (abs == null) return { ok: false, cleared: false };

  const removed = tour.stops[abs]!;
  const wasCurrent = abs === tour.currentIndex;
  const next = removeTourStopAt(abs);
  if (!next?.stops.length) {
    return { ok: true, cleared: true };
  }
  // Alte Stop-Pfade würden die Via weiterhin auf der Karte zeichnen.
  const cleaned: MultiStopTour = {
    ...next,
    stops: next.stops.map((s, i) =>
      i >= next.currentIndex && !s.done ? { ...s, path: null } : s,
    ),
  };
  store.setMultiStopTour(cleaned);

  const remaining = cleaned.stops
    .slice(cleaned.currentIndex)
    .filter((s) => !s.done);
  if (!remaining.length) {
    store.setMultiStopTour(null);
    return { ok: true, cleared: true };
  }

  try {
    const {
      clearTourAheadRouteCache,
      ensureTourAheadRoutes,
    } = require('./tourAheadRouteCache') as {
      clearTourAheadRouteCache: () => void;
      ensureTourAheadRoutes: (s: Array<{ lat: number; lng: number }>) => void;
    };
    clearTourAheadRouteCache();
    const origin = {
      lat: store.lastGpsLat ?? remaining[0]!.lat,
      lng: store.lastGpsLng ?? remaining[0]!.lng,
    };
    ensureTourAheadRoutes([
      origin,
      ...remaining.map((s) => ({ lat: s.lat, lng: s.lng })),
    ]);
  } catch {
    /* soft */
  }

  scheduleTourDistanceEnrich(cleaned);
  notifyNavRouteGeometryChanged();

  const dest = getActiveNavDestination();
  const head = remaining[0]!;
  const destIsRemoved =
    !!dest &&
    haversineMeters(dest.lat, dest.lng, removed.lat, removed.lng) < 90;
  const destMismatchTour =
    !!dest && haversineMeters(dest.lat, dest.lng, head.lat, head.lng) > 120;
  if (wasCurrent || destIsRemoved || destMismatchTour) {
    await navigateToTourStop(head);
    markNavOpeningSpoken();
    notifyNavRouteGeometryChanged();
  }
  return { ok: true, cleared: false, nextName: head.name };
}

export function reorderTourStops(
  fromIndex: number,
  toIndex: number,
): MultiStopTour | null {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour) return null;
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= tour.stops.length ||
    toIndex >= tour.stops.length ||
    fromIndex === toIndex
  ) {
    return tour;
  }

  const stops = [...tour.stops];
  const [moved] = stops.splice(fromIndex, 1);
  stops.splice(toIndex, 0, moved!);

  const wasActive = tour.stops[tour.currentIndex];
  let currentIndex = stops.findIndex(
    (s) =>
      s.name === wasActive?.name &&
      s.lat === wasActive?.lat &&
      s.lng === wasActive?.lng &&
      !s.done,
  );
  if (currentIndex < 0) {
    currentIndex = Math.min(tour.currentIndex, stops.length - 1);
  }

  const next: MultiStopTour = {
    ...tour,
    stops,
    currentIndex,
    estimatedDistanceM: recomputeTourDistance({
      ...tour,
      stops,
      currentIndex,
    }),
  };
  store.setMultiStopTour(next);
  notifyNavRouteGeometryChanged();
  mirrorTourToLiveTimeline();
  return next;
}

/** Offene Tour-Stopps (ab currentIndex) per Drag umsortieren. */
export function reorderUpcomingTourStops(
  fromUpcoming: number,
  toUpcoming: number,
): MultiStopTour | null {
  const tour = useFinnusStore.getState().multiStopTour;
  if (!tour) return null;
  const base = tour.currentIndex;
  return reorderTourStops(base + fromUpcoming, base + toUpcoming);
}

/**
 * Timeline-Drag: Besuch-Reihenfolge = Tour-Reihenfolge (ohne Löschen).
 */
export function applyUpcomingVisitOrder(
  visits: Array<{ lat: number; lng: number; name: string }>,
): MultiStopTour | null {
  const store = useFinnusStore.getState();
  const dest = getActiveNavDestination();
  let tour = store.multiStopTour;
  if (!tour?.stops?.length && dest) {
    tour = ensureTourFromActiveNav({
      name: dest.name,
      lat: dest.lat,
      lng: dest.lng,
      poiId: dest.poiId,
    });
  }
  if (!tour) return null;

  const donePart = tour.stops
    .slice(0, tour.currentIndex)
    .map((s) => ({ ...s, done: true as const }));
  const upcoming = tour.stops
    .slice(tour.currentIndex)
    .filter((s) => !s.done);
  const hasTransit = upcoming.some(
    (s) => s.role === 'alight' || s.role === 'board',
  );
  if (hasTransit) return tour;

  const used = new Set<number>();
  const ordered: TourStop[] = [];
  for (const v of visits) {
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) continue;
    const name = stripVisitTitle(v.name);
    let idx = upcoming.findIndex(
      (s, i) =>
        !used.has(i) &&
        sameStop(s, {
          name,
          lat: v.lat,
          lng: v.lng,
          poiId: s.poiId,
        }),
    );
    if (idx < 0) {
      idx = upcoming.findIndex(
        (s, i) =>
          !used.has(i) && haversineMeters(s.lat, s.lng, v.lat, v.lng) < 70,
      );
    }
    if (idx >= 0) {
      used.add(idx);
      ordered.push(upcoming[idx]!);
    } else if (name) {
      ordered.push({
        poiId: -1,
        name,
        lat: v.lat,
        lng: v.lng,
        done: false,
      });
    }
  }
  for (let i = 0; i < upcoming.length; i++) {
    if (!used.has(i)) ordered.push(upcoming[i]!);
  }
  if (ordered.length < 1) return tour;

  const currentIndex = donePart.length;
  const next: MultiStopTour = {
    ...tour,
    stops: [...donePart, ...ordered],
    currentIndex,
    estimatedDistanceM: recomputeTourDistance({
      ...tour,
      stops: [...donePart, ...ordered],
      currentIndex,
    }),
  };
  store.setMultiStopTour(next);
  notifyNavRouteGeometryChanged();
  mirrorTourToLiveTimeline();
  const focus = ordered[0];
  if (
    focus &&
    dest &&
    !sameStop(
      {
        poiId: dest.poiId,
        name: dest.name,
        lat: dest.lat,
        lng: dest.lng,
        done: false,
      },
      focus,
    )
  ) {
    void navigateToTourStop(focus);
  }
  return next;
}

export async function navigateToTourStopAt(index: number): Promise<boolean> {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour || index < 0 || index >= tour.stops.length) return false;
  const stop = tour.stops[index]!;
  if (stop.done) return false;
  store.setMultiStopTour({ ...tour, currentIndex: index });
  return navigateToTourStop(stop);
}

/**
 * Zwischenstopp unter aktiver Nav — Intent + insertTourStop (P10 harden).
 */
export async function insertZwischenstoppForActiveNav(
  stop: TourStop,
  userText?: string | null,
): Promise<{ tour: MultiStopTour; speechHint: string } | null> {
  const text = String(userText || stop.name || '').replace(/\s+/g, ' ').trim();
  const dest = getActiveNavDestination();
  try {
    const { isOnRouteZwischenstoppIntent } = require('./onRouteZwischenstopp') as {
      isOnRouteZwischenstoppIntent: (s: string, nav: boolean) => boolean;
    };
    if (text && !isOnRouteZwischenstoppIntent(text, Boolean(dest))) {
      return null;
    }
  } catch {
    if (!dest) return null;
  }
  const appended = await appendTourStop(stop, { startNow: true });
  if (!appended) return null;
  return appended;
}
