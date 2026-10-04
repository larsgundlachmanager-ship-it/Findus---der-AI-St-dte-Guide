/**
 * Kiwi/Aviasales OPEN_URL aus Flight-Wish dürfen Orchestrator/ActionBoard nicht stehlen.
 */

import type { QuickAction } from '../../types/concierge';

const FLIGHT_BOOK_URL =
  /kiwi\.com|c111\.travelpayouts\.com|aviasales|tpx\.li\/zk7udfoO|travelpayouts.*flights/i;

export function isLockedFlightBookAction(a: QuickAction): boolean {
  if (a.type !== 'OPEN_URL') return false;
  const url = a.payload?.url ?? '';
  return FLIGHT_BOOK_URL.test(url);
}

export function mergePreserveFlightBookActions(
  original: QuickAction[],
  merged: QuickAction[],
  opts?: { userText?: string | null; cardTitle?: string | null },
): QuickAction[] {
  const locked = original.filter(isLockedFlightBookAction);
  if (!locked.length) return merged;

  const flightTurn =
    /\b(flug|flüge|fluege|fliegen|flieger|kiwi|billigflug)\b/iu.test(
      `${opts?.userText ?? ''} ${opts?.cardTitle ?? ''}`,
    ) || locked.length >= 2;
  if (!flightTurn) return merged;

  const urls = new Set(
    merged.filter((a) => a.type === 'OPEN_URL').map((a) => a.payload.url),
  );
  const reinject = locked.filter((a) => !urls.has(a.payload.url));
  if (!reinject.length) return merged;

  const rest = merged.filter((a) => !isLockedFlightBookAction(a));
  return [...reinject, ...rest].slice(0, 5);
}
