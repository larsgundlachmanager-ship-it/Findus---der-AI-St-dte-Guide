/**
 * Named go-to (Tennis Club etc.): Sofort-Nav, kein Open-Quest, STT-Stadt.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/namedPlaceInstantNav.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { isExplicitNavIntent } from '../intent/poiInfoVsNav';
import { spokenCityFromQuery, fuzzyResolveCityName } from './fuzzyCityResolve';
import { resolveLocalAnchor } from '../../module2/context/shortTermContext';
import {
  looksLikeOpenQuest,
  clearFollowThroughGoal,
} from '../../module2/router/missionFollowThrough';
import { reconcileExecutionWithOrchestrator } from '../../module2/router/call1WorkOrchestrator';
import type { Call1OrchestratorResult } from '../../module2/router/call1WorkOrchestrator';

clearFollowThroughGoal();

const NAV_SAMPLES = [
  'Navigier mich zum Tennis Club Prisdorf',
  'Navigiere mich zum Tennis-Club Prisdorf',
  'Zum Tennis Club Prisdorf',
  'Fahr zum Tennisclub Prisdorf',
  'Bring mich zum Tennis Club prisodrf',
];

for (const s of NAV_SAMPLES) {
  assert.equal(
    looksLikeOpenQuest(s),
    false,
    `open quest must not steal: ${s}`,
  );
  assert.ok(isExplicitNavIntent(s), `explicit nav: ${s}`);
  const anchor = resolveLocalAnchor(s);
  assert.ok(anchor && /tennis/i.test(anchor.name), `local anchor: ${s}`);
  assert.ok(
    typeof anchor!.lat === 'number' && typeof anchor!.lng === 'number',
    'anchor coords',
  );
}

assert.equal(
  spokenCityFromQuery('navigier mich zum tennis club prisodrf'),
  'Prisdorf',
  'STT prisodrf → Prisdorf',
);
assert.equal(fuzzyResolveCityName('prisodrf'), 'Prisdorf');

const fakeOrch = {
  brief: {
    askBack: null,
    bridgeComplete: false,
    work: [
      {
        id: 'ft_open_quest_pitch',
        worker: 'pitch',
        brief: 'quest',
        proximity: 'here_now',
        executeWhen: 'now',
      },
    ],
    runnableWork: [
      {
        id: 'ft_open_quest_pitch',
        worker: 'pitch',
        brief: 'quest',
        proximity: 'here_now',
        executeWhen: 'now',
      },
    ],
    curatedContext: null,
    selfQuestions: [],
    openWorld: null,
  },
  skipHeavyExecution: false,
  primaryExecution: 'pitch_module',
} as unknown as Call1OrchestratorResult;

assert.equal(
  reconcileExecutionWithOrchestrator(
    'nav_execute',
    fakeOrch,
    'Navigier mich zum Tennis Club Prisdorf',
  ),
  'nav_execute',
  'pitch work must not steal explicit tennis nav',
);

assert.equal(
  looksLikeOpenQuest('Ey digga Reifen is platt wa'),
  true,
  'situation quest still works',
);

assert.equal(
  isExplicitNavIntent('Wann hat der Tennis Club auf?'),
  false,
  'info question is not nav',
);

console.log('namedPlaceInstantNav.smoke.test.ts OK');
