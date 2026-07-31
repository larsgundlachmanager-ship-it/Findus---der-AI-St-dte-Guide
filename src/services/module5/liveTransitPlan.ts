/**
 * Modul 5 × DB live: Verbindung wählen, die vor arriveBy ankommt (mit Puffer).
 */

import { planJourney, type JourneyItinerary } from '../transit/journeyPlanner';
import { lookupTrainDeparture } from '../transit/dbRestJourneys';
import { clockLabel } from '../../types/dayPlan';
import { floorMsTo5Min, leaveByFromArrive, walkMinutesPlan } from './bufferMath';

export type LiveTransitPick = {
  itinerary: JourneyItinerary;
  departMs: number;
  arriveMs: number;
  leaveHomeMs: number;
  walkToStopMin: number;
  lineLabel: string;
  delaySec: number | null;
  notes: string[];
  source: string;
};

/**
 * Wählt die späteste Verbindung, die noch ≥ minBufferMin vor Ziel-Deadline ankommt.
 */
export async function pickLiveTransitBeforeDeadline(opts: {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  arriveByMs: number;
  minBufferMin?: number;
}): Promise<LiveTransitPick | null> {
  const minBuffer = (opts.minBufferMin ?? 10) * 60_000;
  const targetArrive = opts.arriveByMs - minBuffer;

  const plan = await planJourney({
    from: { lat: opts.fromLat, lng: opts.fromLng },
    to: { lat: opts.toLat, lng: opts.toLng },
    travelMode: 'transit',
    arriveBy: new Date(targetArrive),
    numItineraries: 6,
  });
  if (!plan.itineraries.length) return null;

  // Sort: arrive as late as possible but before targetArrive
  const ok = plan.itineraries
    .filter((it) => it.endTime.getTime() <= targetArrive)
    .sort((a, b) => b.endTime.getTime() - a.endTime.getTime());
  const pick = ok[0] ?? plan.itineraries[0];
  if (!pick) return null;

  const walkSec = pick.walkToStopSec ?? 0;
  const walkMin = Math.max(
    5,
    Math.ceil(walkSec / 60) ||
      walkMinutesPlan(400), // Fallback kurze Station
  );
  const departMs = pick.startTime.getTime();
  const arriveMs = pick.endTime.getTime();
  // Am Bahnhof 5 Min früher (kleiner Halt) — leaveBy vom Walk-Start
  const atStopMs = floorMsTo5Min(departMs - 5 * 60_000);
  const leaveHomeMs = leaveByFromArrive(atStopMs, walkMin);

  const delaySec = pick.firstTransitDelaySec;
  const notes: string[] = [
    `Live ${plan.source}: ${pick.firstTransitLine ?? 'ÖPNV'} ` +
      `${clockLabel(departMs)} → Ankunft ${clockLabel(arriveMs)}` +
      (delaySec != null && delaySec > 60
        ? ` (+${Math.round(delaySec / 60)} Min Verspätung)`
        : ''),
  ];
  if (arriveMs > targetArrive) {
    notes.push(
      'Achtung: Ankunft knapp / nach Wunsch-Puffer — frühere Verbindung prüfen.',
    );
  }

  return {
    itinerary: pick,
    departMs,
    arriveMs,
    leaveHomeMs,
    walkToStopMin: walkMin,
    lineLabel: pick.firstTransitLine ?? 'ÖPNV',
    delaySec,
    notes,
    source: plan.source,
  };
}

/** Verspätungs-Check für geplante Deadline (ICE etc.). */
export async function checkDeadlineTrainDelay(opts: {
  stationName: string;
  trainHint?: string | null;
  plannedMs: number;
  biasLat?: number;
  biasLng?: number;
}): Promise<string | null> {
  const hit = await lookupTrainDeparture({
    stationQuery: opts.stationName,
    trainHint: opts.trainHint,
    aroundMs: opts.plannedMs,
    biasLat: opts.biasLat,
    biasLng: opts.biasLng,
  });
  if (!hit) return null;
  if (hit.cancelled) {
    return `${hit.line} fällt aus (${hit.stationName}). Verbindung neu planen.`;
  }
  if (hit.delaySec != null && hit.delaySec >= 120) {
    const min = Math.round(hit.delaySec / 60);
    return `${hit.line} ca. +${min} Min Verspätung (Live${
      hit.platform ? `, Gleis ${hit.platform}` : ''
    }).`;
  }
  return null;
}
