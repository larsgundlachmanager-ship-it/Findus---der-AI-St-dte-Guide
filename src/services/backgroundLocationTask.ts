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
    if (!last || !liveHandler) return;
    liveHandler({
      lat: last.coords.latitude,
      lng: last.coords.longitude,
      accuracy: last.coords.accuracy,
    });
  });
}
