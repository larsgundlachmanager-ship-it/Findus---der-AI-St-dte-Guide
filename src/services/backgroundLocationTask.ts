/**
 * Background-Location-Task — muss beim App-Start (global) definiert sein.
 * Importiere diese Datei früh (z. B. in App.tsx / index).
 */

import * as TaskManager from 'expo-task-manager';
import type { LocationObject } from 'expo-location';

export const FINDUS_LOCATION_TASK = 'FINDUS_BACKGROUND_LOCATION';

type BgPayload = {
  locations?: LocationObject[];
};

/** Wird von locationService gesetzt, sobald Watching startet. */
let liveHandler:
  | ((coords: {
      lat: number;
      lng: number;
      accuracy?: number | null;
    }) => void)
  | null = null;

/** Wetter im BG höchstens alle 25 Min neu planen (Regen-Push aktualisieren). */
let lastWeatherBgMs = 0;
const WEATHER_BG_MIN_MS = 25 * 60_000;
let lastTravelBgMs = 0;
const TRAVEL_BG_MIN_MS = 5 * 60_000;

export function setBackgroundLocationHandler(
  handler:
    | ((coords: {
        lat: number;
        lng: number;
        accuracy?: number | null;
      }) => void)
    | null,
): void {
  liveHandler = handler;
}

if (!TaskManager.isTaskDefined(FINDUS_LOCATION_TASK)) {
  TaskManager.defineTask(FINDUS_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[location] background task error:', error);
      return;
    }
    const locs = (data as BgPayload | undefined)?.locations;
    const last = locs?.[locs.length - 1];
    if (!last) return;

    if (liveHandler) {
      liveHandler({
        lat: last.coords.latitude,
        lng: last.coords.longitude,
        accuracy: last.coords.accuracy,
      });
    }

    const now = Date.now();
    if (now - lastTravelBgMs >= TRAVEL_BG_MIN_MS) {
      lastTravelBgMs = now;
      try {
        const { hasCommittedFlightWatches } = await import(
          './flights/flightWatchStore'
        );
        if (hasCommittedFlightWatches()) {
          const { tickFlightWatch } = await import(
            './flights/flightWatchService'
          );
          await tickFlightWatch(now);
        }
      } catch (err) {
        if (__DEV__) console.warn('[location] bg flight watch failed', err);
      }
      try {
        const { pollLiveDeparturesForWatches } = await import(
          './logistics/liveDeparturePoll'
        );
        await pollLiveDeparturesForWatches({ nowMs: now, force: true });
      } catch (err) {
        if (__DEV__) console.warn('[location] bg live departures failed', err);
      }
    }
    if (now - lastWeatherBgMs < WEATHER_BG_MIN_MS) return;
    lastWeatherBgMs = now;
    try {
      const { runWeatherTrackerCheck } = await import(
        './logistics/weatherTracker'
      );
      await runWeatherTrackerCheck({
        force: true,
        lat: last.coords.latitude,
        lng: last.coords.longitude,
      });
    } catch (err) {
      if (__DEV__) console.warn('[location] bg weather refresh failed', err);
    }
  });
}
