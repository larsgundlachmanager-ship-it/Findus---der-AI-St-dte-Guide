/**
 * Beside-/Smalltalk-Modus: User spricht mit einer anderen Person.
 * Findus bleibt still, bis er per Name/Wake wieder angesprochen wird.
 * In-Memory sticky (kein Persist) — kurze Hold-Zeit.
 */

const HOLD_MS = 3 * 60_000;

let activeUntilMs = 0;
let lastReason: string | null = null;

export function isBesideConversationActive(): boolean {
  return Date.now() < activeUntilMs;
}

export function getBesideConversationReason(): string | null {
  return isBesideConversationActive() ? lastReason : null;
}

export function markBesideConversation(reason = 'side_human'): void {
  activeUntilMs = Date.now() + HOLD_MS;
  lastReason = reason;
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[beside] ON', reason, `hold=${HOLD_MS / 1000}s`);
  }
}

export function clearBesideConversation(reason = 'addressed'): void {
  if (!isBesideConversationActive() && activeUntilMs === 0) return;
  activeUntilMs = 0;
  lastReason = null;
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[beside] OFF', reason);
  }
}

/** Verlängern bei weiterem Side-Chat. */
export function bumpBesideConversation(reason?: string): void {
  if (!isBesideConversationActive()) {
    markBesideConversation(reason ?? 'side_human');
    return;
  }
  activeUntilMs = Date.now() + HOLD_MS;
  if (reason) lastReason = reason;
}
