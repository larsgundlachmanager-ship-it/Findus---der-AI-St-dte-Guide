/**
 * Open-Quiet: nach Cold-Start / Resume aus Background 5 Min keine
 * ungefragten Automationen (Akku, Welcome, Leave-by-Voice, Ambient …).
 * User-Initiiertes (Mic, Buttons, Nav nach Tap) bleibt erlaubt.
 * Modul-1-Hauptort (GPS vor dem Ort) ist ausgenommen — siehe canSpeakExploreEvent('main').
 */

export const OPEN_QUIET_MS = 5 * 60_000;

type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

let openQuietUntilMs = 0;
let openQuietBooted = false;

/** Startet / verlängert die Open-Quiet-Fenster (idempotent verlängernd). */
export function noteAppOpenedQuiet(atMs = Date.now()): void {
  openQuietUntilMs = Math.max(openQuietUntilMs, atMs + OPEN_QUIET_MS);
}

export function isOpenQuietActive(nowMs = Date.now()): boolean {
  return nowMs < openQuietUntilMs;
}

export function getOpenQuietRemainingMs(nowMs = Date.now()): number {
  return Math.max(0, openQuietUntilMs - nowMs);
}

/** AppState: Cold-Start + Resume aus Background → 5 Min Quiet. */
export function bootstrapOpenQuietGate(): void {
  if (openQuietBooted) return;
  openQuietBooted = true;
  noteAppOpenedQuiet(Date.now());
  try {
    // Lazy: Smoke-Tests ohne RN-Bundle
    const { AppState } = require('react-native') as {
      AppState: {
        currentState: AppStateStatus;
        addEventListener: (
          type: 'change',
          cb: (next: AppStateStatus) => void,
        ) => { remove: () => void };
      };
    };
    let last: AppStateStatus = AppState.currentState;
    AppState.addEventListener('change', (next) => {
      const prev = last;
      last = next;
      // Nur echter Background→Foreground (nicht Control-Center / inactive)
      if (next === 'active' && prev === 'background') {
        noteAppOpenedQuiet(Date.now());
      }
    });
  } catch {
    /* Node / Test — Quiet bleibt über noteAppOpenedQuiet / Cold-Start */
  }
}

/** Test-only: Quiet-Fenster zurücksetzen. */
export function resetOpenQuietGateForTests(): void {
  openQuietUntilMs = 0;
  openQuietBooted = false;
}
