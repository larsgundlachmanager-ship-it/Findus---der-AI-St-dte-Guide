/**
 * Abort für den aktiven Modul-2 / Concierge-Turn (Barge-in).
 */

let active: AbortController | null = null;
let turnSeq = 0;

/** Vorherigen Turn abbrechen; neuen Signal-Controller starten. */
export function beginModule2TurnAbort(): AbortSignal {
  if (active && !active.signal.aborted) {
    try {
      active.abort();
    } catch {
      /* soft */
    }
  }
  active = new AbortController();
  turnSeq += 1;
  return active.signal;
}

/** Hart abbrechen (Live-Chat Barge-in / neuer Cut). */
export function abortActiveModule2Turn(reason = 'barge_in'): void {
  if (!active) return;
  try {
    active.abort();
  } catch {
    /* soft */
  }
  if (__DEV__) {
    console.log('[m2-abort]', reason, `seq=${turnSeq}`);
  }
  active = null;
}

export function getActiveModule2AbortSignal(): AbortSignal | null {
  return active?.signal ?? null;
}

export function getModule2TurnSeq(): number {
  return turnSeq;
}
