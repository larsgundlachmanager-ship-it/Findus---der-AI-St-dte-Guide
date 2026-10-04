/**
 * Run: npx --yes tsx src/services/weather/rainWarnSessionGate.smoke.test.ts
 */

import {
  RAIN_WARN_AFTER_START_MS,
  RAIN_WARN_MIN_DRY_AFTER_MS,
  RAIN_WARN_MIN_INTERVAL_MS,
  canIssueProactiveRainWarning,
  earliestProactiveRainWarnAtMs,
  markProactiveRainWarningIssued,
  markRainDontCareUntilMorning,
  markRainWarnSessionStart,
  nextMorning6AmMs,
  noteRainDryState,
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
    earliestProactiveRainWarnAtMs(t0) === t0 + RAIN_WARN_AFTER_START_MS,
    'zweiter Start ändert die Session nicht',
  );

  const warnAt = t0 + RAIN_WARN_AFTER_START_MS;
  markProactiveRainWarningIssued(warnAt);
  assert(
    !canIssueProactiveRainWarning(warnAt + 60_000),
    'direkt nach Warnung gesperrt',
  );
  assert(
    !canIssueProactiveRainWarning(warnAt + RAIN_WARN_MIN_INTERVAL_MS),
    '3h allein reicht nicht ohne Trockenphase',
  );
  noteRainDryState({ rainingNow: false, nowMs: warnAt + 10_000 });
  assert(
    !canIssueProactiveRainWarning(
      warnAt + RAIN_WARN_MIN_INTERVAL_MS - 1_000,
    ),
    'unter 3h noch gesperrt',
  );
  const after3hDry =
    warnAt +
    Math.max(RAIN_WARN_MIN_INTERVAL_MS, 10_000 + RAIN_WARN_MIN_DRY_AFTER_MS);
  assert(
    canIssueProactiveRainWarning(after3hDry),
    'nach 3h + ≥1,5h trocken wieder erlaubt',
  );

  resetRainWarnSessionForTests();
  markRainWarnSessionStart(t0);
  const noon = new Date(2026, 8, 13, 12, 0, 0, 0).getTime();
  markRainDontCareUntilMorning(noon);
  const sixNext = nextMorning6AmMs(noon);
  assert(sixNext > noon, 'egal → nächster Morgen 6 Uhr');
  assert(!canIssueProactiveRainWarning(noon + 60_000), 'egal sperrt');
  assert(
    canIssueProactiveRainWarning(sixNext),
    'ab 6 Uhr wieder erlaubt (Session schon alt)',
  );

  // Outdoor-Gate Datei vorhanden
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const outdoor = readFileSync(
    join(process.cwd(), 'src/services/weather/rainWarnOutdoorGate.ts'),
    'utf8',
  );
  assert(outdoor.includes('isUserOutdoorsForRainWarn'), 'outdoor gate');
  assert(outdoor.includes('requireContain'), 'Gebäude-Contain');

  const tracker = readFileSync(
    join(process.cwd(), 'src/services/logistics/weatherTracker.ts'),
    'utf8',
  );
  assert(tracker.includes("cardTitle: 'Regenwarnung'"), 'Titel Regenwarnung');
  assert(tracker.includes('Regen in ${mins} Minuten'), 'Bullet Regen in X');
  assert(tracker.includes('Dauer: ungefähr'), 'Bullet Dauer');
  assert(tracker.includes("label: 'Indoor suchen'"), 'Action Indoor suchen');

  const stage = readFileSync(
    join(process.cwd(), 'src/components/liveStage/LiveStage.tsx'),
    'utf8',
  );
  assert(stage.includes('showDismiss={!hasBullets}'), 'kein Doppel-✕');

  console.log('rainWarnSessionGate.smoke.test.ts OK');
}

run();
