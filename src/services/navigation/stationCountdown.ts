/**
 * ÖPNV-Stations-Takt: nach Losfahren Resthalte+Minuten, dann nur so oft wie der Takt hergibt.
 * Ausstieg: nächste Station beim Verlassen des vorletzten Halts; ~1 Min (S/Bus) bzw. ~5 Min (ICE).
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import { speakAssistantText } from '../ttsService';
import { triggerHapticPulse } from './haptics';
import type { NavPhase, TransportMode } from './navigationTypes';
import { isTransitMode } from './transportMode';
import {
  alightSoonCueText,
  noteTransitGuideSpoken,
  remainingStopsCueText,
  wasTransitGuideSpoken,
} from './transitGuideCoach';
import type { TransitGuideFacts, TransitVehicleKind } from './transitGuideSpeech';
import {
  alightLeadSec,
  shouldSpeakAlightSoon,
  shouldSpeakRemainingStop,
  type RideCadenceInput,
} from './transitRideCadence';

const announced = new Set<number>();
let lastCueAtMs = 0;
let alightNowSpoken = false;
let lastRemaining: number | null = null;
let boardedStops: number | null = null;
let nextStopSpokenAtMs: number | null = null;
const CUE_COOLDOWN_MS = 12_000;

export function resetStationCountdownAnnouncements(): void {
  announced.clear();
  lastCueAtMs = 0;
  alightNowSpoken = false;
  lastRemaining = null;
  boardedStops = null;
  nextStopSpokenAtMs = null;
}

function vehicleKind(raw: string | null | undefined): TransitVehicleKind {
  const vm = String(raw || '').toUpperCase();
  if (vm === 'BUS') return 'Bus';
  if (vm === 'RAIL' || vm === 'SUBWAY' || vm === 'TRAM' || vm === 'TRANSIT') {
    return 'Bahn';
  }
  return 'ÖPNV';
}

function rideMinFromAlight(): number | null {
  const tour = useFinnusStore.getState().multiStopTour;
  const alight =
    tour?.stops.find((s) => s.role === 'alight' && !s.done) ??
    tour?.stops[tour.currentIndex] ??
    null;
  if (!alight) return null;
  if (typeof alight.durationSec === 'number' && alight.durationSec > 30) {
    return Math.max(1, Math.round(alight.durationSec / 60));
  }
  if (alight.startMs != null && alight.endMs != null && alight.endMs > alight.startMs) {
    const left = Math.max(0, alight.endMs - Date.now());
    return Math.max(1, Math.round(left / 60_000));
  }
  return null;
}

function factsForCountdown(targetName: string): TransitGuideFacts {
  const tour = useFinnusStore.getState().multiStopTour;
  const alight =
    tour?.stops.find((s) => s.role === 'alight' && !s.done) ??
    tour?.stops[tour.currentIndex] ??
    null;
  return {
    line: alight?.line ?? null,
    headsign: alight?.headsign ?? null,
    platform: alight?.platform ?? null,
    haltName: alight?.name ?? null,
    alightName: alight?.name || targetName || null,
    waitMin: null,
    remainingStops: lastRemaining,
    rideMin: rideMinFromAlight(),
    destWalkM: null,
    destName: targetName || null,
    vehicle: vehicleKind(alight?.vehicleMode),
  };
}

function cadenceInput(facts: TransitGuideFacts): RideCadenceInput {
  return {
    line: facts.line,
    vehicle: facts.vehicle,
    remainingStops: facts.remainingStops,
    rideMin: facts.rideMin,
    boardedStops,
  };
}

function riding(phase: NavPhase | null | undefined): boolean {
  return phase === 'in_transit';
}

export async function onRemainingStationsChanged(
  remaining: number,
  opts: {
    transportMode: TransportMode;
    targetName: string;
    navPhase?: NavPhase | null;
  },
): Promise<void> {
  if (!isTransitMode(opts.transportMode)) return;
  if (!riding(opts.navPhase ?? null)) return;

  if (lastRemaining != null && remaining > lastRemaining) {
    alightNowSpoken = false;
    nextStopSpokenAtMs = null;
    boardedStops = remaining;
  }
  lastRemaining = remaining;
  if (boardedStops == null) boardedStops = remaining;

  const facts = factsForCountdown(opts.targetName);
  const cadence = cadenceInput(facts);
  if (!shouldSpeakRemainingStop(remaining, cadence)) return;
  if (announced.has(remaining)) return;
  if (wasTransitGuideSpoken(`stops:${remaining}`)) {
    announced.add(remaining);
    if (remaining === 1) nextStopSpokenAtMs = Date.now();
    return;
  }

  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isGenerating) return;
  if (Date.now() - lastCueAtMs < CUE_COOLDOWN_MS) return;

  announced.add(remaining);
  noteTransitGuideSpoken(`stops:${remaining}`);
  lastCueAtMs = Date.now();
  if (remaining === 1) {
    nextStopSpokenAtMs = Date.now();
    triggerHapticPulse('double');
  }

  try {
    await speakAssistantText(remainingStopsCueText(remaining, facts));
  } catch (err) {
    console.warn('[stationCountdown] speak failed:', err);
  }
}

export async function maybeSpeakAlightNow(opts: {
  transportMode: TransportMode;
  remainingStations: number | null;
  distanceToDestinationM: number | null;
  speedMs: number | null;
  navPhase?: NavPhase | null;
}): Promise<void> {
  if (!isTransitMode(opts.transportMode)) return;
  if (!riding(opts.navPhase ?? null)) return;
  if (opts.remainingStations == null || opts.remainingStations > 1) return;
  if (alightNowSpoken) return;

  const facts = factsForCountdown(
    useFinnusStore.getState().navTargetName || '',
  );
  const cadence = cadenceInput(facts);
  const dist = opts.distanceToDestinationM ?? 9999;
  const speed =
    typeof opts.speedMs === 'number' && opts.speedMs > 1.5
      ? opts.speedMs
      : isLongHaulFallback(cadence.line)
        ? 40
        : 12;
  const etaSec = dist / speed;
  const leadSec = alightLeadSec({ ...cadence, etaSec });
  const due = shouldSpeakAlightSoon({
    remainingStops: opts.remainingStations,
    etaSec,
    leadSec,
    nextStopSpokenAtMs,
    nowMs: Date.now(),
    boardedStops,
  });
  if (!due) return;
  if (Date.now() - lastCueAtMs < 8_000) return;

  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isGenerating) return;

  alightNowSpoken = true;
  lastCueAtMs = Date.now();
  triggerHapticPulse('double');
  try {
    const leadMin = Math.max(1, Math.round(leadSec / 60));
    await speakAssistantText(alightSoonCueText(facts, leadMin));
  } catch {
    /* soft */
  }
}

function isLongHaulFallback(line: string | null): boolean {
  return /^(ICE|IC|EC|ECE|RJ|NJ|EN|TGV)\b/i.test((line || '').trim());
}
