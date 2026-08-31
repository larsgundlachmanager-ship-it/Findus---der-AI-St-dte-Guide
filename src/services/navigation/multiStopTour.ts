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
  const ok = await startNavigationToCoords({
    name: stop.name,
    lat: stop.lat,
    lng: stop.lng,
    poiId: stop.poiId >= 0 ? stop.poiId : -1,
    stations: stop.stations,
    transitRide: stop.role === 'alight',
  });
  if (ok) await applyTourStopRuntime(stop);
  return ok;
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
  const cue = stop.speakOnStart?.trim();
  if (!cue) return;
  if (stop.role === 'alight') return;
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

  const origin = {
    lat: store.lastGpsLat ?? dest?.lat ?? incoming.lat,
    lng: store.lastGpsLng ?? dest?.lng ?? incoming.lng,
  };
  const ordered = orderStopsEfficiently(origin, [...upcoming, incoming], {
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

  const speechHint =
    ordered.length <= 1
      ? `${incoming.name} ist jetzt mit auf der Route.`
      : `${incoming.name} ist einsortiert — ${ordered.length} Stopps in der besten Reihenfolge.`;
  return { tour: next, speechHint };
}

export async function insertTourStop(
  stop: TourStop,
  opts?: { position?: 'front' | 'end'; startNow?: boolean },
): Promise<MultiStopTour | null> {
  const store = useFinnusStore.getState();
  let tour = store.multiStopTour;
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

  const position = opts?.position ?? 'front';
  const stops = [...tour.stops];
  const currentIndex = tour.currentIndex;

  if (position === 'front') {
    stops.splice(currentIndex, 0, { ...stop, done: false });
  } else {
    stops.push({ ...stop, done: false });
  }

  const next: MultiStopTour = {
    ...tour,
    kind:
      tour.kind === 'jog' || tour.kind === 'explore' || tour.kind === 'meal'
        ? tour.kind
        : 'custom',
    stops,
    currentIndex,
    estimatedDistanceM: recomputeTourDistance({
      ...tour,
      stops,
      currentIndex,
    }),
  };
  store.setMultiStopTour(next);

  if (opts?.startNow !== false && position === 'front') {
    await navigateToTourStop(stops[currentIndex]!);
    markNavOpeningSpoken();
  }
  return next;
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
    speechHint =
      p === 'must'
        ? `${spontaneous.name} ist jetzt oben — ich erinner dich rechtzeitig. Die anderen Stopps bleiben in der Queue.`
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

  const wasCurrent = abs === tour.currentIndex;
  const next = removeTourStopAt(abs);
  if (!next?.stops.length) {
    return { ok: true, cleared: true };
  }
  const remaining = next.stops
    .slice(next.currentIndex)
    .filter((s) => !s.done);
  if (!remaining.length) {
    store.setMultiStopTour(null);
    return { ok: true, cleared: true };
  }

  notifyNavRouteGeometryChanged();
  scheduleTourDistanceEnrich(next);
  try {
    const { ensureTourAheadRoutes } = require('./tourAheadRouteCache') as {
      ensureTourAheadRoutes: (s: Array<{ lat: number; lng: number }>) => void;
    };
    ensureTourAheadRoutes(remaining.map((s) => ({ lat: s.lat, lng: s.lng })));
  } catch {
    /* soft */
  }

  if (wasCurrent) {
    await navigateToTourStop(remaining[0]!);
    markNavOpeningSpoken();
  }
  return { ok: true, cleared: false, nextName: remaining[0]?.name };
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

export async function navigateToTourStopAt(index: number): Promise<boolean> {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour || index < 0 || index >= tour.stops.length) return false;
  const stop = tour.stops[index]!;
  if (stop.done) return false;
  store.setMultiStopTour({ ...tour, currentIndex: index });
  return navigateToTourStop(stop);
}
