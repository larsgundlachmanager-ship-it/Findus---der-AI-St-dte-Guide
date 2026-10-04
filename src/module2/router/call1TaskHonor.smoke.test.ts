/**
 * Call-1 Task-Honor smokes.
 * Run: npx --yes tsx src/module2/router/call1TaskHonor.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { resolveCall1TaskHonor } from './call1TaskHonor';
import type { ManagerAnalysis, ManagerTask } from './types';

function task(partial: Partial<ManagerTask> & Pick<ManagerTask, 'id' | 'lane' | 'brief'>): ManagerTask {
  return {
    priority: 'fast',
    affectsSpeech: true,
    ...partial,
  };
}

function analysis(partial: Partial<ManagerAnalysis> = {}): ManagerAnalysis {
  return {
    intentSummary: 'test',
    route: 'blueprint',
    blueprintId: null,
    blueprintStage: null,
    session: 'new',
    threadMatchId: null,
    subject: null,
    bridge: null,
    lanePlan: 'fast_only',
    pace: 'standard',
    bridgeMaxWords: 36,
    fastDeadlineMs: 8000,
    latencyHintSec: null,
    tasks: [],
    openLoops: [],
    nameAllowed: false,
    jobHint: null,
    ...partial,
  };
}

{
  const dining = task({
    id: 'd1',
    lane: 'dining',
    brief: 'AYCE ohne Asiatisch heute Abend',
  });
  const taxi = task({
    id: 't1',
    lane: 'other',
    brief: 'Taxi zum Theater nach dem Essen',
  });
  const a = analysis({
    jobHint: 'taxi_rideshare',
    tasks: [dining, taxi],
    mustHaves: ['cuisine_not_asian', 'avoid_cuisine_asian'],
  });

  const hDining = resolveCall1TaskHonor({
    task: dining,
    userText:
      'All you can eat ohne Asiatisch und danach ein Taxi zum Theater',
    analysis: a,
  });
  assert.equal(hDining.honoredCall1, true, 'dining honors call1');
  assert.equal(hDining.jobHint, 'dining_open', 'dining lane beats global taxi hint');
  assert.match(hDining.laneUserText, /CONSTRAINTS:.*cuisine_not_asian/i);
  assert.match(hDining.laneUserText, /CONTEXT_UTTERANCE/);
  assert.doesNotMatch(
    hDining.classifyText,
    /Taxi zum Theater/i,
    'classify uses brief not full compound',
  );

  const hTaxi = resolveCall1TaskHonor({
    task: taxi,
    userText:
      'All you can eat ohne Asiatisch und danach ein Taxi zum Theater',
    analysis: a,
  });
  assert.equal(hTaxi.honoredCall1, true, 'taxi task honors brief');
  assert.match(hTaxi.laneUserText, /Taxi zum Theater/);
}

{
  const weak = resolveCall1TaskHonor({
    task: task({ id: 'x', lane: 'other', brief: 'ok' }),
    userText: 'Was geht heute?',
    analysis: analysis({ jobHint: null }),
  });
  assert.equal(weak.honoredCall1, false, 'short brief → fallback');
}

console.log('call1TaskHonor.smoke.test.ts ok');
