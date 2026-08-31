/**
 * Run: npx --yes tsx src/services/weather/rainWarnSessionGate.smoke.test.ts
 */

import {
  RAIN_WARN_AFTER_START_MS,
  canIssueProactiveRainWarning,
  earliestProactiveRainWarnAtMs,
  markRainWarnSessionStart,
  resetRainWarnSessionForTests,
} from './rainWarnSessionGate';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function run(): void {
  resetRainWarnSessionForTests();
  const t0 = 1_700_000_000_000;
  markRainWarnSessionStart(t0);
  assert(
    !canIssueProactiveRainWarning(t0 + 60_000),
    'nach 1 Min noch keine Warnung',
  );
  assert(
    !canIssueProactiveRainWarning(t0 + RAIN_WARN_AFTER_START_MS - 1),
    'knapp vor 5 Min noch keine Warnung',
  );
  assert(
    canIssueProactiveRainWarning(t0 + RAIN_WARN_AFTER_START_MS),
    'ab 5 Min Warnung erlaubt',
  );
  assert(
    earliestProactiveRainWarnAtMs(t0) === t0 + RAIN_WARN_AFTER_START_MS,
    'frühester Zeitpunkt = Start + 5 Min',
  );
  markRainWarnSessionStart(t0 + 99_000);
  assert(
    earliestProactiveRainWarnAtMs() === t0 + RAIN_WARN_AFTER_START_MS,
    'zweiter Start ändert die Session nicht',
  );
  console.log('rainWarnSessionGate.smoke.test.ts OK');
}

run();
