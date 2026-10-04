/**
 * ÖPNV-Stations-Takt: nach Losfahren Resthalte, Countdown nur bei 3 Stationen.
 * Ausstieg: nächste Station beim Verlassen des vorletzten Halts;
 * Zeit-Cue ~60 s — nur bei ≤1 Halt Rest; kurzer Hop → Merge.
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
  shouldMergeNextAndAlight,
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
/** Kurzer Hop: nächste Station = Ausstieg schon zusammen gesprochen. */
let mergedNextAlight = false;
const CUE_COOLDOWN_MS = 12_000;

export function resetStationCountdownAnnouncements(): void {
  announced.clear();
  lastCueAtMs = 0;
  alightNowSpoken = false;
  lastRemaining = null;
  boardedStops = null;
  nextStopSpokenAtMs = null;
  mergedNextAlight = false;
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
  // Mode-Dip walk in Bahn: Phase in_transit reicht.
  if (!riding(opts.navPhase ?? null)) return;

  if (lastRemaining != null && remaining > lastRemaining) {
    alightNowSpoken = false;
    nextStopSpokenAtMs = null;
    mergedNextAlight = false;
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
  if (
    store.isListening ||
    store.isPlayingAudio ||
    store.isAudiblySpeaking ||
    store.isGenerating
  ) return;
  if (Date.now() - lastCueAtMs < CUE_COOLDOWN_MS) return;

  announced.add(remaining);
  noteTransitGuideSpoken(`stops:${remaining}`);
  lastCueAtMs = Date.now();
  if (remaining === 1) {
    nextStopSpokenAtMs = Date.now();
    triggerHapticPulse('double');
    const leadSec = alightLeadSec(cadence);
    const merge = shouldMergeNextAndAlight({
      remainingStops: 1,
      rideMin: facts.rideMin,
      leadSec,
    });
    if (merge) {
      mergedNextAlight = true;
      // Kurzer Hop: eine zusammengesetzte Ansage reicht — kein Extra-60s-Cue.
      alightNowSpoken = true;
    }
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
  /** Distanz zum Ausstieg (Tour-Alight), falls bekannt. */
  distanceToAlightM?: number | null;
}): Promise<void> {
  if (!riding(opts.navPhase ?? null) && !isTransitMode(opts.transportMode)) {
    return;
  }
  if (!riding(opts.navPhase ?? null)) return;
  if (opts.remainingStations == null || opts.remainingStations > 1) return;
  if (alightNowSpoken) return;

  const facts = factsForCountdown(
    useFinnusStore.getState().navTargetName || '',
  );
  const cadence = cadenceInput(facts);
  const distAlight =
    opts.distanceToAlightM != null && Number.isFinite(opts.distanceToAlightM)
      ? opts.distanceToAlightM
      : opts.distanceToDestinationM ?? 9999;
  const dist = distAlight;
  const speed =
    typeof opts.speedMs === 'number' && opts.speedMs > 1.5
      ? opts.speedMs
      : isLongHaulFallback(cadence.line)
        ? 40
        : 12;
  const etaSec = dist / Math.max(0.5, speed);
  const leadSec = alightLeadSec({ ...cadence, etaSec });
  // Nah am Halt / letzter Halt: immer „Jetzt aussteigen“ — nicht nur Zeit-Vorlauf.
  const nearStop =
    opts.remainingStations <= 1 &&
    (dist <= 120 || etaSec <= 45 || opts.remainingStations === 0);
  const dueSoon = shouldSpeakAlightSoon({
    remainingStops: opts.remainingStations,
    etaSec,
    leadSec,
    nextStopSpokenAtMs,
    nowMs: Date.now(),
    boardedStops,
    mergedNextAlight,
  });
  if (!nearStop && !dueSoon) return;
  if (Date.now() - lastCueAtMs < 5_000) return;

  const store = useFinnusStore.getState();
  if (
    store.isListening ||
    store.isPlayingAudio ||
    store.isAudiblySpeaking ||
    store.isGenerating
  ) return;

  alightNowSpoken = true;
  lastCueAtMs = Date.now();
  triggerHapticPulse('double');
  try {
    // ~60 s vorher oder am Halt: immer Stationsname + jetzt aussteigen.
    if (nearStop || etaSec <= leadSec + 5 || mergedNextAlight) {
      const { alightNowCueText } = await import('./transitGuideCoach');
      await speakAssistantText(alightNowCueText(facts));
    } else {
      await speakAssistantText(alightSoonCueText(facts, 1));
    }
  } catch {
    alightNowSpoken = false;
  }
}

function isLongHaulFallback(line: string | null): boolean {
  return /^(ICE|IC|EC|ECE|RJ|NJ|EN|TGV)\b/i.test((line || '').trim());
}
