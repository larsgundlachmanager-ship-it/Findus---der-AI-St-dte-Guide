/**
 * Rest-Pool zwischen Plan und Live-Supervisor (ohne Zyklus).
 */

import type { TourCandidate } from './types';

const restPoolByRequest = new Map<
  string,
  { rest: TourCandidate[]; denserStops: boolean }
>();

export function stashRestPool(
  requestId: string,
  rest: TourCandidate[],
  denserStops: boolean,
): void {
  restPoolByRequest.set(requestId, { rest, denserStops });
}

export function takeRestPool(requestId: string) {
  const v = restPoolByRequest.get(requestId);
  restPoolByRequest.delete(requestId);
  return v ?? null;
}
