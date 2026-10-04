/**
 * Letzte ÖPNV-Journey für „Route starten“-Button.
 * Beim Merken sofort Timeline mit Fuß-/Fahr-Beinen + Ziel (SSOT).
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
  // Speech/Button nennen die Verbindung → Timeline mit Orten + Beinen
  try {
    const { upsertSpokenJourneyToTimeline } = require('../../module2/timeline/plannedJourneyGroup') as {
      upsertSpokenJourneyToTimeline: (o: {
        itinerary: JourneyItinerary;
        destName: string;
        destLat: number;
        destLng: number;
      }) => boolean;
    };
    upsertSpokenJourneyToTimeline(opts);
  } catch (err) {
    console.warn('[journeyCache] timeline mirror failed', err);
  }
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
