/**
 * Hands-free ÖPNV-Coach: Halt / Einfahrt / Fahrt / Ausstieg / Umstieg.
 * Nur Speech — keine Karten- oder Timeline-Änderungen.
 *
 * Halt-Ansagen beziehen sich immer auf den Einstieg (Gleis/Linie), nie auf
 * das Ausstiegsgleis. Onboard erst nach echtem Einsteigen (Phase in_transit).
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import { speakAssistantText } from '../ttsService';
import { distanceMeters } from './bearing';
import type { NavPhase, TransportMode } from './navigationTypes';
import type { TourStop } from './multiStopTour';
import {
  alightNowSpeech,
  haltArrivedSpeech,
  lastWalkSpeech,
  onboardSpeech,
  remainingStopsSpeech,
  transferWalkSpeech,
  vehicleSoonSpeech,
  alightSoonSpeech,
  type TransitGuideFacts,
  type TransitVehicleKind,
} from './transitGuideSpeech';

const HALT_NEAR_M = 48;
const VEHICLE_SOON_SEC = 70;
const CUE_GAP_MS = 8_000;

let spoken = new Set<string>();
let lastSpeakAt = 0;
let lastPhase: NavPhase | null = null;

export function resetTransitGuideCoach(): void {
  spoken = new Set();
  lastSpeakAt = 0;
  lastPhase = null;
}

export function wasTransitGuideSpoken(key: string): boolean {
  return spoken.has(key);
}

export function noteTransitGuideSpoken(key: string): void {
  spoken.add(key);
}

function vehicleOf(stop: TourStop | null, mode: TransportMode): TransitVehicleKind {
  const vm = String(stop?.vehicleMode || '').toUpperCase();
  if (vm === 'BUS' || mode === 'transit_bus') return 'Bus';
  if (
    vm === 'RAIL' ||
    vm === 'SUBWAY' ||
    vm === 'TRAM' ||
    vm === 'TRANSIT' ||
    mode === 'transit_train'
  ) {
    return 'Bahn';
  }
  return 'ÖPNV';
}

function isBoardishRole(role: TourStop['role'] | undefined): boolean {
  return role === 'walk' || role === 'transfer' || role === 'board';
}

function boardingHalt(tour: {
  stops: TourStop[];
  currentIndex: number;
}): TourStop | null {
  const i = tour.currentIndex ?? 0;
  const cur = tour.stops[i] ?? null;
  if (cur && isBoardishRole(cur.role)) return cur;
  for (let k = i - 1; k >= 0; k -= 1) {
    const s = tour.stops[k];
    if (s && isBoardishRole(s.role)) return s;
  }
  return null;
}

function upcomingAlight(tour: {
  stops: TourStop[];
  currentIndex: number;
}): TourStop | null {
  const i = tour.currentIndex ?? 0;
  return tour.stops.find((s, idx) => idx >= i && s.role === 'alight') ?? null;
}

function waitSecFrom(ms: number | null | undefined, nowMs: number): number | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return (ms - nowMs) / 1000;
}

function rideMinFrom(stop: TourStop | null): number | null {
  if (!stop) return null;
  if (typeof stop.durationSec === 'number' && stop.durationSec > 30) {
    return Math.max(1, Math.round(stop.durationSec / 60));
  }
  if (stop.startMs != null && stop.endMs != null && stop.endMs > stop.startMs) {
    return Math.max(1, Math.round((stop.endMs - stop.startMs) / 60_000));
  }
  return null;
}

function factsFromTour(opts: {
  remainingStops: number | null;
  destWalkM: number | null;
  destName: string | null;
  mode: TransportMode;
  nowMs: number;
}): TransitGuideFacts | null {
  const tour = useFinnusStore.getState().multiStopTour;
  if (!tour?.stops?.length) return null;
  const board = boardingHalt(tour);
  const alight = upcomingAlight(tour);
  const src = board ?? alight ?? tour.stops[tour.currentIndex] ?? null;
  if (!src) return null;
  const depMs = board?.vehicleStartMs ?? alight?.startMs ?? src.startMs ?? null;
  const waitSec = waitSecFrom(depMs, opts.nowMs);
  const waitMin =
    waitSec == null ? null : Math.max(0, Math.round(waitSec / 60));
  return {
    line: board?.line ?? alight?.line ?? src.line ?? null,
    headsign: board?.headsign ?? alight?.headsign ?? src.headsign ?? null,
    platform: board?.platform ?? null,
    haltName: board?.name ?? src.name ?? null,
    alightName: alight?.name ?? null,
    waitMin,
    remainingStops: opts.remainingStops ?? alight?.stationCount ?? null,
    rideMin: rideMinFrom(alight),
    destWalkM: opts.destWalkM,
    destName: opts.destName,
    vehicle: vehicleOf(alight ?? src, opts.mode),
  };
}

async function speakKey(key: string, text: string): Promise<void> {
  if (!text.trim()) return;
  if (spoken.has(key)) return;
  const now = Date.now();
  if (now - lastSpeakAt < CUE_GAP_MS) return;
  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isGenerating) return;
  spoken.add(key);
  lastSpeakAt = now;
  try {
    await speakAssistantText(text.trim());
  } catch {
    spoken.delete(key);
  }
}

export function remainingStopsCueText(
  n: number,
  facts: TransitGuideFacts,
): string {
  return remainingStopsSpeech(n, facts);
}

export function alightSoonCueText(
  facts: TransitGuideFacts,
  leadMin: number,
): string {
  return alightSoonSpeech(facts, leadMin);
}

export function alightNowCueText(facts: TransitGuideFacts): string {
  return alightNowSpeech(facts);
}

export async function onTransitGuidePhaseChange(opts: {
  prev: NavPhase | null;
  next: NavPhase;
  remainingStops: number | null;
  destWalkM: number;
  destName: string;
  mode: TransportMode;
}): Promise<void> {
  const facts = factsFromTour({
    remainingStops: opts.remainingStops,
    destWalkM: opts.destWalkM,
    destName: opts.destName,
    mode: opts.mode,
    nowMs: Date.now(),
  });
  if (!facts) return;
  if (opts.next === 'in_transit' && opts.prev !== 'in_transit') {
    const n = opts.remainingStops;
    if (n != null && n >= 1) {
      noteTransitGuideSpoken(`stops:${n}`);
    }
    await speakKey('onboard', onboardSpeech(facts));
  }
  if (
    opts.next === 'post_transit_walk' &&
    opts.prev !== 'post_transit_walk'
  ) {
    const tour = useFinnusStore.getState().multiStopTour;
    const cur = tour?.stops[tour.currentIndex];
    const next = tour?.stops[(tour?.currentIndex ?? 0) + 1];
    const isTransfer =
      cur?.role === 'transfer' ||
      next?.role === 'alight' ||
      next?.role === 'transfer' ||
      Boolean(next?.line && next.role !== 'dest');
    if (isTransfer && next && next.role !== 'dest') {
      await speakKey(
        'transfer',
        transferWalkSpeech({
          ...facts,
          line: next.line ?? facts.line,
          headsign: next.headsign ?? facts.headsign,
          platform: next.platform ?? facts.platform,
          haltName: next.name,
        }),
      );
    } else {
      await speakKey('lastwalk', lastWalkSpeech(facts));
    }
  }
}

export function tickTransitGuide(opts: {
  navPhase: NavPhase | null;
  remainingStations: number | null;
  distanceToDestinationM: number;
  speedMs: number | null;
  userLat: number;
  userLng: number;
  destName: string;
  transportMode: TransportMode;
}): void {
  const now = Date.now();
  const phase = opts.navPhase;
  if (phase && phase !== lastPhase) {
    const prev = lastPhase;
    lastPhase = phase;
    void onTransitGuidePhaseChange({
      prev,
      next: phase,
      remainingStops: opts.remainingStations,
      destWalkM: opts.distanceToDestinationM,
      destName: opts.destName,
      mode: opts.transportMode,
    });
  } else if (phase) {
    lastPhase = phase;
  }

  const tour = useFinnusStore.getState().multiStopTour;
  if (!tour?.stops?.length) return;
  const board = boardingHalt(tour);
  const facts = factsFromTour({
    remainingStops: opts.remainingStations,
    destWalkM: opts.distanceToDestinationM,
    destName: opts.destName,
    mode: opts.transportMode,
    nowMs: now,
  });
  if (!facts || !board) return;

  const waiting =
    phase === 'walk_to_stop' || phase === 'walk' || phase === 'idle';
  if (!waiting) return;

  const dHalt = distanceMeters(opts.userLat, opts.userLng, board.lat, board.lng);
  const depMs = board.vehicleStartMs ?? upcomingAlight(tour)?.startMs ?? null;
  const waitSec = waitSecFrom(depMs, now);

  if (dHalt <= HALT_NEAR_M && (facts.line || facts.platform)) {
    void speakKey('halt', haltArrivedSpeech(facts));
  }

  if (
    spoken.has('halt') &&
    waitSec != null &&
    waitSec <= VEHICLE_SOON_SEC &&
    waitSec >= -20 &&
    dHalt <= HALT_NEAR_M + 25
  ) {
    void speakKey('soon', vehicleSoonSpeech(facts));
  }
}
