/**
 * P10 weather + nav-stop smoke.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/weatherNavHarden.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { resolveWeatherLane } from './weatherLaneDiff';
import { looksLikeAddStopUtterance } from './navZwischenstopp';
import { inferCall1JobShape } from './call1JobShape';
import { finalizeCall1Execution } from './call1Dispatch';
import type { ManagerAnalysis } from './types';
import { emptyTurnFrame } from './turnFrame';

assert.equal(resolveWeatherLane('Was soll ich morgen anziehen?'), 'weather_outfit');
assert.equal(resolveWeatherLane('Regnet es heute Nachmittag?'), 'weather_rain');
assert.equal(inferCall1JobShape('Wie wird das Wetter morgen?'), 'weather_info');

assert.ok(looksLikeAddStopUtterance('Noch einen Zwischenstopp beim Bäcker'));
assert.equal(
  inferCall1JobShape('Noch einen Stopp dazwischen beim Bäcker'),
  'logistics_multi',
);

function base(partial: Partial<ManagerAnalysis>): ManagerAnalysis {
  return {
    intentSummary: 'test',
    route: 'blueprint',
    blueprintId: null,
    blueprintStage: null,
    session: 'new',
    threadMatchId: null,
    subject: null,
    bridge: 'Verstanden.',
    lanePlan: 'fast_only',
    pace: 'standard',
    bridgeMaxWords: 36,
    fastDeadlineMs: 8000,
    latencyHintSec: null,
    tasks: [],
    openLoops: [],
    nameAllowed: false,
    jobHint: null,
    chatLane: 'chat',
    frame: emptyTurnFrame(),
    ...partial,
  };
}

assert.equal(
  finalizeCall1Execution(base({}), 'Was soll ich anziehen?'),
  'chat_lane',
);
assert.equal(
  finalizeCall1Execution(base({}), 'Pizza mit Rucola bitte'),
  'pitch_module',
);

console.log('weatherNavHarden.smoke.test.ts OK');
