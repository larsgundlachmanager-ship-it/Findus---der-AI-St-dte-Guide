/**
 * Erste Regenwarnung (Voice, HUD, Push) erst nach einer Ruhephase
 * nach App-Start — nicht direkt beim Öffnen.
 * Live-Wetter-Fetch zusätzlich: siehe weatherFetchGate (30 Min + GPS in Stadt).
 */

export const RAIN_WARN_AFTER_START_MS = 5 * 60_000;

let sessionStartedAtMs = 0;

export function markRainWarnSessionStart(nowMs = Date.now()): void {
  if (sessionStartedAtMs === 0) sessionStartedAtMs = nowMs;
}

export function weatherSessionStartedAtMs(): number {
  if (sessionStartedAtMs === 0) markRainWarnSessionStart();
  return sessionStartedAtMs;
}

export function canIssueProactiveRainWarning(nowMs = Date.now()): boolean {
  if (sessionStartedAtMs === 0) markRainWarnSessionStart(nowMs);
  return nowMs - sessionStartedAtMs >= RAIN_WARN_AFTER_START_MS;
}

export function earliestProactiveRainWarnAtMs(nowMs = Date.now()): number {
  if (sessionStartedAtMs === 0) markRainWarnSessionStart(nowMs);
  return sessionStartedAtMs + RAIN_WARN_AFTER_START_MS;
}

/** Tests. */
export function resetRainWarnSessionForTests(): void {
  sessionStartedAtMs = 0;
}
