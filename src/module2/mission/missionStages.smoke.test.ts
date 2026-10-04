/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/mission/missionStages.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  missionKindsUseStubbornLoop,
  runMissionStages,
  shouldRunMissionExpand,
  type MissionRanked,
} from './runMissionStages';
import { shouldRunDiscoveryHarvest } from '../pitch/discoveryHarvest';
import type { PitchCandidate, PitchRequest } from '../pitch/types';
import { finalizeCall1Execution } from '../router/call1Dispatch';

assert.equal(missionKindsUseStubbornLoop('food'), true);
assert.equal(missionKindsUseStubbornLoop('sight'), true);
assert.equal(missionKindsUseStubbornLoop('hotel'), true);
assert.equal(missionKindsUseStubbornLoop('generic'), true);
assert.equal(missionKindsUseStubbornLoop('cinema'), false);

assert.equal(
  shouldRunDiscoveryHarvest({
    kind: 'sight',
    topLen: 0,
    softFail: true,
  }),
  true,
  'sight harvest',
);
assert.equal(
  shouldRunDiscoveryHarvest({
    kind: 'generic',
    topLen: 0,
    softFail: true,
  }),
  true,
  'generic harvest',
);
assert.equal(
  shouldRunDiscoveryHarvest({
    kind: 'cinema',
    topLen: 0,
    softFail: true,
  }),
  false,
  'cinema no harvest here',
);

assert.equal(
  shouldRunMissionExpand({
    kind: 'food',
    softFail: false,
    topLen: 1,
  }),
  true,
  'ein Perfect → weiter expanden bis Dual',
);
assert.equal(
  shouldRunMissionExpand({
    kind: 'food',
    softFail: false,
    topLen: 2,
  }),
  false,
  'zwei Perfect → kein Expand',
);

function baseReq(kind: PitchRequest['kind']): PitchRequest {
  return {
    requestId: 't1',
    title: 'Basketball',
    context: 'Wo kann ich Basketball spielen?',
    kind,
    searchMode: 'here_now',
    visitAtMs: Date.now(),
    wishes: [
      {
        text: 'basketballplatz',
        hardness: 'must',
        kind: 'amenity',
        weight: 40,
      },
    ],
    prefs: {},
    anchor: { lat: 53.55, lng: 9.99 },
    uiLayout: 'live_split',
    forbidSoftFill: true,
    searchStages: ['pack', 'neighbor', 'metro', 'web', 'verify'],
  };
}

async function main() {
  {
    let calls = 0;
    const staged = await runMissionStages({
      req: baseReq('generic'),
      ranked: {
        top: [],
        softFail: true,
        reason: 'empty',
        criteriaChecklist: [],
      },
      pool: [],
      rank: async () => {
        calls += 1;
        const cand: PitchCandidate = {
          name: `Court-${calls}`,
          lat: 53.55,
          lng: 9.99,
          rating: 4.5,
          source: 'places',
          softTags: ['basketball'],
        };
        if (calls < 2) {
          return {
            ranked: {
              top: [],
              softFail: true,
              reason: 'thin',
              criteriaChecklist: [],
            },
            pool: [],
          };
        }
        return {
          ranked: {
            top: [cand],
            shortlist: [cand],
            softFail: false,
            reason: 'ok',
            criteriaChecklist: [],
          },
          pool: [cand],
        };
      },
    });
    assert.ok(staged.ranked.top.length >= 1, 'stubborn loop finds options');
    assert.ok(
      staged.stagesRun.includes('broaden') ||
        staged.stagesRun.some((s) => s.startsWith('expand_')),
      `stages ran: ${staged.stagesRun.join(',')}`,
    );
    assert.ok(staged.stagesRun.includes('verify'), 'ends with verify');
  }

  {
    const soft: MissionRanked = {
      top: [
        {
          name: 'Soft Court',
          lat: 53.55,
          lng: 9.99,
          rating: 3,
          source: 'places',
          softTags: [],
        },
      ],
      softFail: true,
      reason: 'soft',
      criteriaChecklist: [{ key: 'court_basketball', status: 'soft_miss' }],
    };
    const staged = await runMissionStages({
      req: {
        ...baseReq('generic'),
        forbidSoftFill: true,
        liveExpandRadiusM: 100_000,
      },
      ranked: soft,
      pool: soft.top,
      rank: async () => ({
        ranked: soft,
        pool: soft.top,
      }),
    });
    assert.equal(
      staged.ranked.top.length,
      0,
      'forbidSoftFill empties soft pool',
    );
    assert.ok(
      staged.stagesRun.includes('forbid_soft_fill'),
      'forbid soft fill stage',
    );
  }

  {
    const base = {
      intentSummary: 'test',
      route: 'blueprint' as const,
      blueprintId: null,
      blueprintStage: null,
      session: 'new' as const,
      threadMatchId: null,
      subject: null,
      bridge: 'Ok.',
      lanePlan: 'fast_only' as const,
      pace: 'standard' as const,
      bridgeMaxWords: 36,
      fastDeadlineMs: 8000,
      latencyHintSec: null,
      tasks: [],
      openLoops: [],
      nameAllowed: false,
      jobHint: null,
      chatLane: 'chat' as const,
    };
    assert.equal(
      finalizeCall1Execution({ ...base }, 'Wo kann ich Basketball spielen?'),
      'pitch_module',
      'basketball → pitch not chat',
    );
    assert.equal(
      finalizeCall1Execution({ ...base }, 'Wie alt ist der Papst?'),
      'chat_lane',
      'fact stays chat',
    );
  }

  console.log('missionStages.smoke.test.ts ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
