/**
 * Letzte ÖPNV-Journey für „Route starten“-Button (kein Date-Serialisieren nötig).
 */

import type { JourneyItinerary } from '../transit/journeyPlanner';

let lastJourney: {
  itinerary: JourneyItinerary;
  destName: string;
  destLat: number;
  destLng: number;
} | null = null;

export function rememberJourneyForStart(opts: {
  itinerary: JourneyItinerary;
  destName: string;
  destLat: number;
  destLng: number;
}): void {
  lastJourney = opts;
}

/** Peek ohne zu löschen — für Button-Tap. */
export function peekRememberedJourney(): typeof lastJourney {
  return lastJourney;
}

export function takeRememberedJourney(): typeof lastJourney {
  const j = lastJourney;
  lastJourney = null;
  return j;
}

export function clearRememberedJourney(): void {
  lastJourney = null;
}
