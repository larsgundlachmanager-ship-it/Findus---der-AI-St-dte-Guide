/**
 * Warten bis MapLibre idle + Finger weg — zwischen 3-Release-Paints.
 */

import { InteractionManager } from 'react-native';
import { isMapUserGesturing } from './mapGestureLane';

export type MapIdleOpts = {
  /** Abbruch nach ms (Default 12 s). */
  maxMs?: number;
  /** Erst weiter wenn keine aktive Geste (Default true). */
  untilFingerUp?: boolean;
  /** Extra Ruhe nach Interactions (Default 480 ms). */
  quietMs?: number;
  /** Override Geste-Probe. */
  isGesturing?: () => boolean;
};

export function waitMapIdle(opts: MapIdleOpts = {}): Promise<void> {
  const maxMs = opts.maxMs ?? 12_000;
  const untilFingerUp = opts.untilFingerUp !== false;
  const quietMs = opts.quietMs ?? 480;
  const gesturing = opts.isGesturing ?? isMapUserGesturing;
  const started = Date.now();

  return new Promise((resolve) => {
    const step = () => {
      if (Date.now() - started > maxMs) {
        resolve();
        return;
      }
      if (untilFingerUp && gesturing()) {
        setTimeout(step, 350);
        return;
      }
      InteractionManager.runAfterInteractions(() => {
        setTimeout(resolve, quietMs);
      });
    };
    step();
  });
}
